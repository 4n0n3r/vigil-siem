from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query

from app.models import (
    BatchIngestRequest,
    BatchIngestResponse,
    IngestRequest,
    IngestResponse,
    SearchEvent,
    SearchResponse,
    StoredEvent,
)
from app import store
from app.sigma import loader, evaluator
from app.db import pg_alerts

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/events", response_model=IngestResponse, status_code=200)
async def ingest_event(body: IngestRequest) -> IngestResponse:
    """Ingest a single event into the store and run Sigma evaluation."""
    event_id = str(uuid.uuid4())
    timestamp = body.timestamp if body.timestamp is not None else datetime.now(timezone.utc)

    stored = StoredEvent(
        id=event_id,
        source=body.source,
        event=body.event,
        timestamp=timestamp,
    )
    added = await store.add_event(stored)

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

    rules = loader.get_enabled_rules()

    def _eval() -> list[dict]:
        matched = []
        for rule in rules:
            try:
                if evaluator.evaluate(rule["parsed_detection"], stored.event):
                    matched.append(rule)
            except Exception:  # noqa: BLE001
                pass
        return matched

    matched_rules = await asyncio.to_thread(_eval)

    alert_ids: list[str] = []
    for rule in matched_rules:
        alert_id = await pg_alerts.save_alert(rule, stored)
        if alert_id:
            alert_ids.append(alert_id)

    return IngestResponse(
        id=event_id,
        source=body.source,
        timestamp=timestamp,
        status="ingested",
        alert_ids=alert_ids,
    )


@router.post("/events/batch", response_model=BatchIngestResponse, status_code=200)
async def ingest_batch(body: BatchIngestRequest) -> BatchIngestResponse:
    """Ingest a batch of events and run Sigma evaluation on each."""
    ids: list[str] = []
    errors: list[str] = []
    stored_events: list[StoredEvent] = []

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
            )
            if await store.add_event(stored):
                stored_events.append(stored)
                ids.append(event_id)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    # CPU-bound Sigma evaluation runs in a thread pool so the event loop
    # stays free to serve search and other requests concurrently.
    rules = loader.get_enabled_rules()

    def _eval_batch() -> list[tuple[dict, StoredEvent]]:
        matches: list[tuple[dict, StoredEvent]] = []
        for stored in stored_events:
            for rule in rules:
                try:
                    if evaluator.evaluate(rule["parsed_detection"], stored.event):
                        matches.append((rule, stored))
                except Exception:  # noqa: BLE001
                    pass
        return matches

    matches = await asyncio.to_thread(_eval_batch)

    # Save alerts back on the event loop (async IO).
    total_alerts = 0
    for rule, stored in matches:
        alert_id = await pg_alerts.save_alert(rule, stored)
        if alert_id:
            total_alerts += 1

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
) -> SearchResponse:
    """Search stored events with optional time-range and substring filters."""
    t0 = time.monotonic()

    results = await store.search_events(
        query=query,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
    )

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
