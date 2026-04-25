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
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.models import StoredEvent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory fallback storage
# ---------------------------------------------------------------------------

_fallback_events: list[StoredEvent] = []
_FALLBACK_MAX = 50_000

# ---------------------------------------------------------------------------
# Event-level LRU dedup — prevents re-ingesting the same source log record
# after an agent restart when EvtSeek falls back to start-of-log.
# ---------------------------------------------------------------------------

_SEEN_MAX = 10_000
_seen: OrderedDict[str, bool] = OrderedDict()


def _compute_source_event_id(event: StoredEvent) -> str:
    """Derive a stable dedup key from the event's originating record ID.

    Returns "" for events without a stable record_id so they are never
    entered into the LRU (they get a new UUID on every ingest anyway).
    """
    ev = event.event or {}
    record_id = ev.get("record_id")
    if record_id is None:
        record_id = (ev.get("event_data") or {}).get("record_id")
    if record_id is not None:
        return f"{event.source}:{record_id}"
    return ""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def add_event(event: StoredEvent) -> bool:
    """Persist a single event to ClickHouse.

    Returns True if the event was stored, False if it was a known duplicate.
    Raises RuntimeError if ClickHouse is configured but unavailable — callers
    should surface this as a 503 rather than silently losing data.
    """
    from app.db import clickhouse  # noqa: PLC0415

    key = _compute_source_event_id(event)
    if key:
        if key in _seen:
            return False
        _seen[key] = True
        if len(_seen) > _SEEN_MAX:
            _seen.popitem(last=False)  # evict oldest entry

    client = _get_ch_client()
    if client is not None:
        try:
            await asyncio.to_thread(_ch_insert, client, event)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error(
                '{"event": "ch_insert_failed", "error": "%s"}',
                str(exc).replace('"', "'"),
            )
            raise RuntimeError(f"ClickHouse insert failed: {exc}") from exc

    if clickhouse.is_configured():
        # DSN was set but connection failed at startup — refuse rather than lose data.
        raise RuntimeError(
            "ClickHouse is configured but unavailable — "
            "event not stored. Check CLICKHOUSE_DSN and connectivity."
        )

    # No ClickHouse configured: use in-memory fallback (development / quick-start mode).
    _fallback_events.append(event)
    if len(_fallback_events) > _FALLBACK_MAX:
        del _fallback_events[0]
    return True


async def search_events(
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
    endpoint_id: Optional[str] = None,
) -> list[StoredEvent]:
    """Search events — ClickHouse if available, else fallback list."""
    client = _get_ch_client()
    if client is not None:
        try:
            return await asyncio.to_thread(_ch_search, client, query, from_time, to_time, limit, endpoint_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                '{"event": "ch_search_failed", "error": "%s", "fallback": true}',
                str(exc).replace('"', "'"),
            )
    return await asyncio.to_thread(_fallback_search, query, from_time, to_time, limit, endpoint_id)


async def hunt_events(
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
    agg_field: Optional[str],
    timeline: bool,
    endpoint_id: Optional[str] = None,
) -> dict:
    """Run an HQL hunt query and return events + aggregations + timeline."""
    client = _get_ch_client()
    if client is not None:
        try:
            return await asyncio.to_thread(
                _ch_hunt, client, query, from_time, to_time, limit, agg_field, timeline, endpoint_id
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                '{"event": "ch_hunt_failed", "error": "%s", "fallback": true}',
                str(exc).replace('"', "'"),
            )
    return await asyncio.to_thread(_fallback_hunt, query, from_time, to_time, limit, agg_field, timeline, endpoint_id)


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
    return await asyncio.to_thread(_fallback_count_24h)


async def count_events_in_window(
    pattern: str,
    ip: str,
    window_minutes: int,
) -> int:
    """Count events containing both *pattern* and *ip* in the last *window_minutes*."""
    client = _get_ch_client()
    if client is not None:
        try:
            return await asyncio.to_thread(_ch_count_in_window, client, pattern, ip, window_minutes)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                '{"event": "ch_count_window_failed", "error": "%s", "fallback": true}',
                str(exc).replace('"', "'"),
            )
    return await asyncio.to_thread(_fallback_count_in_window, pattern, ip, window_minutes)


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
            event.endpoint_id or "",
        ]],
        column_names=["id", "source", "event", "timestamp", "endpoint_id"],
    )


def _ch_search(
    client,
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
    endpoint_id: Optional[str] = None,
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
    if endpoint_id:
        conditions.append("endpoint_id = {endpoint_id:String}")
        params["endpoint_id"] = endpoint_id

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


def _ch_hunt(
    client,
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
    agg_field: Optional[str],
    timeline: bool,
    endpoint_id: Optional[str] = None,
) -> dict:
    from app.hunt.parser import parse_hql  # noqa: PLC0415
    from app.hunt.translator import to_clickhouse_sql  # noqa: PLC0415

    conditions = []
    params: dict = {}

    if from_time is not None:
        conditions.append("timestamp >= {from_time:DateTime64}")
        params["from_time"] = _ensure_tz(from_time)
    if to_time is not None:
        conditions.append("timestamp <= {to_time:DateTime64}")
        params["to_time"] = _ensure_tz(to_time)

    if query:
        ast = parse_hql(query)
        if ast is not None:
            conditions.append(to_clickhouse_sql(ast))
    if endpoint_id:
        conditions.append("endpoint_id = {endpoint_id:String}")
        params["endpoint_id"] = endpoint_id

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    # Main events query
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

    # Aggregation query
    aggregations: list[dict] = []
    if agg_field:
        path_parts = agg_field.split(".")
        ch_path = ", ".join(f"'{p}'" for p in path_parts)
        agg_sql = f"""
            SELECT JSONExtractString(event, {ch_path}) AS val, count() AS cnt
            FROM vigil_events
            {where_clause}
            GROUP BY val
            ORDER BY cnt DESC
            LIMIT 50
        """
        agg_result = client.query(agg_sql, parameters=params)
        for row in agg_result.result_rows:
            val, cnt = row
            if val:
                aggregations.append({"value": str(val), "count": int(cnt)})

    # Timeline query
    timeline_buckets: list[dict] = []
    if timeline:
        tl_sql = f"""
            SELECT toStartOfHour(timestamp) AS bucket, count() AS cnt
            FROM vigil_events
            {where_clause}
            GROUP BY bucket
            ORDER BY bucket ASC
        """
        tl_result = client.query(tl_sql, parameters=params)
        for row in tl_result.result_rows:
            bucket, cnt = row
            ts_val = bucket if isinstance(bucket, datetime) else datetime.fromisoformat(str(bucket))
            timeline_buckets.append({"ts": ts_val, "count": int(cnt)})

    return {"events": events, "aggregations": aggregations, "timeline": timeline_buckets}


def _ch_count_24h(client) -> int:
    result = client.query(
        "SELECT count() FROM vigil_events WHERE timestamp > now() - INTERVAL 24 HOUR"
    )
    rows = result.result_rows
    if rows:
        return int(rows[0][0])
    return 0


def _ch_count_in_window(client, pattern: str, ip: str, window_minutes: int) -> int:
    result = client.query(
        "SELECT count() FROM vigil_events "
        "WHERE event LIKE {pattern:String} "
        "AND event LIKE {ip:String} "
        "AND timestamp > now() - INTERVAL {window:UInt32} MINUTE",
        parameters={"pattern": f"%{pattern}%", "ip": f"%{ip}%", "window": window_minutes},
    )
    rows = result.result_rows
    return int(rows[0][0]) if rows else 0


def _fallback_count_in_window(pattern: str, ip: str, window_minutes: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    count = 0
    for ev in _fallback_events:
        if _ensure_tz(ev.timestamp) < cutoff:
            continue
        haystack = (json.dumps(ev.event) + ev.source).lower()
        if pattern.lower() in haystack and ip in haystack:
            count += 1
    return count


# ---------------------------------------------------------------------------
# In-memory fallback helpers (sync)
# ---------------------------------------------------------------------------

def _fallback_search(
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
    endpoint_id: Optional[str] = None,
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
        if endpoint_id and ev.endpoint_id != endpoint_id:
            continue
        results.append(ev)
    results.sort(key=lambda e: _ensure_tz(e.timestamp), reverse=True)
    return results[:limit]


def _fallback_hunt(
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
    agg_field: Optional[str],
    timeline: bool,
    endpoint_id: Optional[str] = None,
) -> dict:
    from app.hunt.parser import parse_hql  # noqa: PLC0415
    from app.hunt.translator import to_predicate  # noqa: PLC0415

    predicate = None
    if query:
        ast = parse_hql(query)
        if ast is not None:
            predicate = to_predicate(ast)

    matched: list[StoredEvent] = []
    for ev in _fallback_events:
        ts = _ensure_tz(ev.timestamp)
        if from_time is not None and ts < _ensure_tz(from_time):
            continue
        if to_time is not None and ts > _ensure_tz(to_time):
            continue
        if predicate is not None:
            # Include top-level StoredEvent fields (source) in the dict
            # so field:source queries work the same as in ClickHouse.
            ev_dict = {"source": ev.source, **ev.event}
            if not predicate(ev_dict):
                continue
        if endpoint_id and ev.endpoint_id != endpoint_id:
            continue
        matched.append(ev)

    matched.sort(key=lambda e: _ensure_tz(e.timestamp), reverse=True)
    events = matched[:limit]

    aggregations: list[dict] = []
    if agg_field:
        from collections import Counter  # noqa: PLC0415
        parts = agg_field.split(".")
        counter: Counter = Counter()
        for ev in matched:
            val = ev.event
            for p in parts:
                if isinstance(val, dict):
                    val = val.get(p)
                else:
                    val = None
                    break
            if val is not None:
                counter[str(val)] += 1
        aggregations = [{"value": v, "count": c} for v, c in counter.most_common(50)]

    timeline_buckets: list[dict] = []
    if timeline:
        from collections import Counter as _Counter  # noqa: PLC0415
        tc: _Counter = _Counter()
        for ev in matched:
            ts = _ensure_tz(ev.timestamp)
            bucket = ts.replace(minute=0, second=0, microsecond=0)
            tc[bucket] += 1
        for bucket in sorted(tc):
            timeline_buckets.append({"ts": bucket, "count": tc[bucket]})

    return {"events": events, "aggregations": aggregations, "timeline": timeline_buckets}


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
