"""
Event store — Phase 2.

Primary backend: ClickHouse Cloud (via clickhouse_connect).
Fallback: in-memory list (same behaviour as Phase 1).

All public functions are async.  Callers must await them.
ClickHouse calls are synchronous under the hood and are wrapped in
asyncio.to_thread() to avoid blocking the event loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.models import StoredEvent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory fallback storage
# ---------------------------------------------------------------------------

_fallback_events: list[StoredEvent] = []


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def add_event(event: StoredEvent) -> None:
    """Persist a single event — ClickHouse if available, else fallback list."""
    client = _get_ch_client()
    if client is not None:
        try:
            await asyncio.to_thread(_ch_insert, client, event)
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                '{"event": "ch_insert_failed", "error": "%s", "fallback": true}',
                str(exc).replace('"', "'"),
            )
    _fallback_events.append(event)


async def search_events(
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
) -> list[StoredEvent]:
    """Search events — ClickHouse if available, else fallback list."""
    client = _get_ch_client()
    if client is not None:
        try:
            return await asyncio.to_thread(_ch_search, client, query, from_time, to_time, limit)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                '{"event": "ch_search_failed", "error": "%s", "fallback": true}',
                str(exc).replace('"', "'"),
            )
    return _fallback_search(query, from_time, to_time, limit)


async def count_last_24h() -> int:
    """Count events ingested in the last 24 hours."""
    client = _get_ch_client()
    if client is not None:
        try:
            return await asyncio.to_thread(_ch_count_24h, client)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                '{"event": "ch_count_failed", "error": "%s", "fallback": true}',
                str(exc).replace('"', "'"),
            )
    return _fallback_count_24h()


# ---------------------------------------------------------------------------
# ClickHouse helpers (sync — called via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _get_ch_client():
    from app.db import clickhouse  # noqa: PLC0415
    return clickhouse.get_client()


def _ch_insert(client, event: StoredEvent) -> None:
    client.insert(
        "vigil_events",
        [[
            event.id,
            event.source,
            json.dumps(event.event),
            event.timestamp,
        ]],
        column_names=["id", "source", "event", "timestamp"],
    )


def _ch_search(
    client,
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
) -> list[StoredEvent]:
    conditions = []
    params: dict = {}

    if from_time is not None:
        conditions.append("timestamp >= {from_time:DateTime64}")
        params["from_time"] = _ensure_tz(from_time)
    if to_time is not None:
        conditions.append("timestamp <= {to_time:DateTime64}")
        params["to_time"] = _ensure_tz(to_time)
    if query:
        conditions.append(
            "(JSONExtractString(event, 'action') LIKE {query_like:String}"
            " OR event LIKE {query_like:String})"
        )
        params["query_like"] = f"%{query}%"

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    sql = f"""
        SELECT id, source, event, timestamp
        FROM vigil_events
        {where_clause}
        ORDER BY timestamp DESC
        LIMIT {{limit:UInt64}}
    """
    params["limit"] = limit

    result = client.query(sql, parameters=params)

    events: list[StoredEvent] = []
    for row in result.result_rows:
        row_id, source, event_json, ts = row
        try:
            event_dict = json.loads(event_json)
        except Exception:  # noqa: BLE001
            event_dict = {"_raw": event_json}
        events.append(
            StoredEvent(
                id=row_id,
                source=source,
                event=event_dict,
                timestamp=ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts)),
            )
        )
    return events


def _ch_count_24h(client) -> int:
    result = client.query(
        "SELECT count() FROM vigil_events WHERE timestamp > now() - INTERVAL 24 HOUR"
    )
    rows = result.result_rows
    if rows:
        return int(rows[0][0])
    return 0


# ---------------------------------------------------------------------------
# In-memory fallback helpers (sync)
# ---------------------------------------------------------------------------

def _fallback_search(
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
) -> list[StoredEvent]:
    results: list[StoredEvent] = []
    for ev in _fallback_events:
        ts = _ensure_tz(ev.timestamp)
        if from_time is not None and ts < _ensure_tz(from_time):
            continue
        if to_time is not None and ts > _ensure_tz(to_time):
            continue
        if query is not None:
            haystack = str(ev.model_dump()).lower()
            if query.lower() not in haystack:
                continue
        results.append(ev)
    results.sort(key=lambda e: _ensure_tz(e.timestamp), reverse=True)
    return results[:limit]


def _fallback_count_24h() -> int:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    return sum(1 for e in _fallback_events if _ensure_tz(e.timestamp) >= cutoff)


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _ensure_tz(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
