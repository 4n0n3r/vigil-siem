from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from app.models import (
    ErrorResponse,
    BatchIngestRequest,
    BatchIngestResponse,
    IngestRequest,
    IngestResponse,
    SearchEvent,
    SearchResponse,
    StoredEvent,
)
from app import store
from app.sigma import loader, evaluator, correlation
from app.db import pg_alerts, pg_endpoints, pg_suppressions

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/events", response_model=IngestResponse, status_code=200)
async def ingest_event(request: Request, body: IngestRequest) -> IngestResponse:
    """Ingest a single event into the store and run Sigma evaluation."""
    event_id = str(uuid.uuid4())
    timestamp = body.timestamp if body.timestamp is not None else datetime.now(timezone.utc)
    endpoint_id = getattr(request.state, "endpoint_id", None) or ""

    stored = StoredEvent(
        id=event_id,
        source=body.source,
        event=body.event,
        timestamp=timestamp,
        endpoint_id=endpoint_id,
    )
    try:
        added = await store.add_event(stored)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=ErrorResponse(
                error_code="STORAGE_UNAVAILABLE",
                message=str(exc),
                hint="Set CLICKHOUSE_DSN to a reachable ClickHouse instance and restart the API.",
            ).model_dump(),
        ) from exc

    # Run CPU-bound Sigma evaluation in a thread so the event loop stays free.
    # Skip entirely for duplicate events that were not stored.
    if not added:
        return IngestResponse(
            id=event_id,
            source=body.source,
            timestamp=timestamp,
            status="duplicate",
            alert_ids=[],
        )

    rules        = loader.get_enabled_rules()
    suppressions = await pg_suppressions.get_active_suppressions()

    def _eval() -> list[dict]:
        matched = []
        eval_event   = {"source": stored.source, **stored.event}
        event_channel = stored.event.get("channel", "").lower()

        # P0: pre-filter rules by channel before running the full detection block.
        for rule in rules:
            ch_filter = rule.get("channel_filter", [])
            if ch_filter and event_channel and event_channel not in ch_filter:
                continue  # wrong channel — skip
            try:
                if evaluator.evaluate(rule["parsed_detection"], eval_event):
                    matched.append(rule)
            except Exception:  # noqa: BLE001
                pass
        return matched

    matched_rules = await asyncio.to_thread(_eval)

    alert_ids: list[str] = []
    for rule in matched_rules:
        # P1: check suppressions (global or endpoint-scoped) before persisting.
        if pg_suppressions.is_suppressed(stored.event, suppressions, rule_name=rule["name"], endpoint_id=endpoint_id):
            await pg_suppressions.record_suppression_hit(stored.event, suppressions, rule_name=rule["name"], endpoint_id=endpoint_id)
            continue

        # P2: correlation gate — if rule has vigil_correlation config, only fire
        # when enough failure events precede this success event from the same IP.
        corr_cfg = rule.get("vigil_correlation")
        if corr_cfg:
            ip = correlation.extract_source_ip(
                stored.event.get("message") or stored.event.get("MESSAGE", "")
            )
            if not ip:
                continue
            fail_count = await store.count_events_in_window(
                pattern=corr_cfg.get("failure_pattern", "Failed password"),
                ip=ip,
                window_minutes=int(corr_cfg.get("window_minutes", 10)),
            )
            if fail_count < int(corr_cfg.get("min_failures", 3)):
                continue

        alert_id = await pg_alerts.save_alert(rule, stored)
        if alert_id:
            alert_ids.append(alert_id)

    # Update endpoint last_seen.
    if endpoint_id:
        await pg_endpoints.heartbeat(endpoint_id)

    return IngestResponse(
        id=event_id,
        source=body.source,
        timestamp=timestamp,
        status="ingested",
        alert_ids=alert_ids,
    )


@router.post("/events/batch", response_model=BatchIngestResponse, status_code=200)
async def ingest_batch(request: Request, body: BatchIngestRequest) -> BatchIngestResponse:
    """Ingest a batch of events and run Sigma evaluation on each."""
    ids: list[str] = []
    errors: list[str] = []
    stored_events: list[StoredEvent] = []
    endpoint_id = getattr(request.state, "endpoint_id", None) or ""

    # Fast pass: assign IDs and persist events (IO).
    # Duplicates (add_event returns False) are skipped from Sigma evaluation.
    for item in body.events:
        try:
            event_id = str(uuid.uuid4())
            timestamp = item.timestamp if item.timestamp is not None else datetime.now(timezone.utc)
            stored = StoredEvent(
                id=event_id,
                source=item.source,
                event=item.event,
                timestamp=timestamp,
                endpoint_id=endpoint_id,
            )
            if await store.add_event(stored):
                stored_events.append(stored)
                ids.append(event_id)
        except RuntimeError as exc:
            # Storage unavailable — fail the whole batch rather than silently losing data.
            raise HTTPException(
                status_code=503,
                detail=ErrorResponse(
                    error_code="STORAGE_UNAVAILABLE",
                    message=str(exc),
                    hint="Set CLICKHOUSE_DSN to a reachable ClickHouse instance and restart the API.",
                ).model_dump(),
            ) from exc
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    # CPU-bound Sigma evaluation runs in a thread pool so the event loop
    # stays free to serve search and other requests concurrently.
    rules        = loader.get_enabled_rules()
    suppressions = await pg_suppressions.get_active_suppressions()

    def _eval_batch() -> list[tuple[dict, StoredEvent]]:
        matches: list[tuple[dict, StoredEvent]] = []
        for stored in stored_events:
            eval_event    = {"source": stored.source, **stored.event}
            event_channel = stored.event.get("channel", "").lower()

            # P0: channel-aware pre-filter.
            for rule in rules:
                ch_filter = rule.get("channel_filter", [])
                if ch_filter and event_channel and event_channel not in ch_filter:
                    continue  # wrong channel — skip
                try:
                    if evaluator.evaluate(rule["parsed_detection"], eval_event):
                        matches.append((rule, stored))
                except Exception:  # noqa: BLE001
                    pass
        return matches

    matches = await asyncio.to_thread(_eval_batch)

    # Save alerts back on the event loop (async IO).
    total_alerts = 0
    for rule, stored in matches:
        # P1: suppression check before persisting.
        if pg_suppressions.is_suppressed(stored.event, suppressions, rule_name=rule["name"], endpoint_id=endpoint_id):
            await pg_suppressions.record_suppression_hit(stored.event, suppressions, rule_name=rule["name"], endpoint_id=endpoint_id)
            continue

        # P2: correlation gate (same logic as single-event path).
        corr_cfg = rule.get("vigil_correlation")
        if corr_cfg:
            ip = correlation.extract_source_ip(
                stored.event.get("message") or stored.event.get("MESSAGE", "")
            )
            if not ip:
                continue
            fail_count = await store.count_events_in_window(
                pattern=corr_cfg.get("failure_pattern", "Failed password"),
                ip=ip,
                window_minutes=int(corr_cfg.get("window_minutes", 10)),
            )
            if fail_count < int(corr_cfg.get("min_failures", 3)):
                continue

        alert_id = await pg_alerts.save_alert(rule, stored)
        if alert_id:
            total_alerts += 1

    # Update endpoint last_seen after batch flush.
    if endpoint_id:
        await pg_endpoints.heartbeat(endpoint_id)

    return BatchIngestResponse(
        ingested=len(ids),
        ids=ids,
        errors=errors,
        alerts_generated=total_alerts,
    )


@router.get("/events/search", response_model=SearchResponse)
async def search_events(
    query: Optional[str] = Query(default=None, description="Substring filter against the full event payload"),
    from_time: Optional[datetime] = Query(default=None, alias="from_time"),
    to_time: Optional[datetime] = Query(default=None, alias="to_time"),
    limit: int = Query(default=100, ge=1, le=10_000),
    endpoint_id: Optional[str] = Query(default=None),
) -> SearchResponse:
    """Search stored events with optional time-range and substring filters."""
    t0 = time.monotonic()

    try:
        results = await store.search_events(
            query=query,
            from_time=from_time,
            to_time=to_time,
            limit=limit,
            endpoint_id=endpoint_id,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=ErrorResponse(
                error_code="STORAGE_UNAVAILABLE",
                message=str(exc),
                hint="Set CLICKHOUSE_DSN to a reachable ClickHouse instance and restart the API.",
            ).model_dump(),
        ) from exc

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    return SearchResponse(
        events=[
            SearchEvent(
                id=ev.id,
                source=ev.source,
                event=ev.event,
                timestamp=ev.timestamp,
            )
            for ev in results
        ],
        total=len(results),
        query_time_ms=elapsed_ms,
    )
