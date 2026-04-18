"""
Helper for persisting and bulk-managing Sigma-triggered alerts in PostgreSQL.

Used by the ingest route after evaluating each enabled detection rule.
Duplicate alerts (same rule fired on the same source event) are silently
dropped via the unique constraint on (rule_id, source_event_id).
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def _source_event_id(stored_event) -> str:
    """Derive a stable dedup key from the event's originating record ID.

    For Windows Event Log events the agent includes a ``record_id`` field
    (the EventRecordID) which is stable across re-ingestion of the same log
    record. We combine it with the source prefix to get a globally unique key.

    For events that lack a record_id (synthetic test events, syslog lines
    without a stable ID) we fall back to the generated ingest UUID. These
    events will produce a new alert on every re-ingest, which is acceptable
    since they have no stable identity.
    """
    ev = stored_event.event or {}

    # Windows agent: event_id is at top level, record_id too.
    record_id = ev.get("record_id")

    # Some collectors nest under event_data.
    if record_id is None:
        record_id = (ev.get("event_data") or {}).get("record_id")

    if record_id is not None:
        return f"{stored_event.source}:{record_id}"

    # No stable ID available — use the ingest UUID (no cross-restart dedup).
    return stored_event.id


async def save_alert(rule: dict, stored_event) -> str:
    """Insert an alert row and return its UUID string.

    Returns empty string if the alert is a duplicate (already fired for this
    rule + source event) or if PostgreSQL is unavailable.
    """
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return ""

    source_event_id = _source_event_id(stored_event)

    endpoint_id = getattr(stored_event, "endpoint_id", None) or None

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO alerts
                    (rule_id, event_id, severity, event_snapshot, source_event_id,
                     endpoint_id, hit_count, first_seen, last_seen)
                VALUES ($1, $2, $3, $4::jsonb, $5, $6, 1, now(), now())
                ON CONFLICT (rule_id, source_event_id)
                    WHERE source_event_id <> ''
                DO UPDATE
                    SET hit_count = alerts.hit_count + 1,
                        last_seen = now()
                RETURNING id, hit_count
                """,
                rule["id"],
                stored_event.id,
                rule.get("severity", "medium"),
                json.dumps(stored_event.event),
                source_event_id,
                endpoint_id,
            )
        if not row:
            return ""
        # Only count as a "new" alert on first insert (hit_count == 1).
        # On subsequent hits we still return the id so callers can log it,
        # but the caller can inspect hit_count > 1 to know it was a dedup.
        return str(row["id"])
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            '{"event": "alert_save_error", "rule_id": "%s", "error": "%s"}',
            rule.get("id", "?"),
            str(exc).replace('"', "'"),
        )
        return ""


# ---------------------------------------------------------------------------
# Batch operations
# ---------------------------------------------------------------------------

_ACTION_STATUS = {
    "acknowledge": "acknowledged",
    "suppress": "suppressed",
    "resolve": "resolved",
}


async def batch_update_alerts(
    ids: list[str], action: str, note: str | None
) -> tuple[int, list[str]]:
    """Apply action to all alerts in ids. Returns (count, updated_ids)."""
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None or not ids:
        return 0, []

    new_status = _ACTION_STATUS.get(action, action)
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                UPDATE alerts
                SET status = $1,
                    acknowledged_at = CASE WHEN $1 = 'acknowledged'
                                          THEN NOW() ELSE acknowledged_at END,
                    note = COALESCE($2, note)
                WHERE id = ANY($3::uuid[])
                RETURNING id
                """,
                new_status,
                note,
                ids,
            )
        updated_ids = [str(r["id"]) for r in rows]
        return len(updated_ids), updated_ids
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            '{"event": "batch_update_error", "error": "%s"}',
            str(exc).replace('"', "'"),
        )
        return 0, []


async def get_alert_ids_by_filter(
    status_filter: str | None,
    severity_filter: str | None,
) -> list[str]:
    """Return alert IDs matching the given filters."""
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return []

    conditions = []
    params: list = []
    idx = 1

    if status_filter is not None:
        conditions.append(f"status = ${idx}")
        params.append(status_filter)
        idx += 1
    if severity_filter is not None:
        conditions.append(f"severity = ${idx}")
        params.append(severity_filter)
        idx += 1

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(f"SELECT id FROM alerts {where_clause}", *params)
        return [str(r["id"]) for r in rows]
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            '{"event": "filter_ids_error", "error": "%s"}',
            str(exc).replace('"', "'"),
        )
        return []
