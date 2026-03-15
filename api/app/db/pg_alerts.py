"""
Helper for persisting Sigma-triggered alerts to PostgreSQL.

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

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO alerts
                    (rule_id, event_id, severity, event_snapshot, source_event_id)
                VALUES ($1, $2, $3, $4::jsonb, $5)
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                rule["id"],
                stored_event.id,
                rule.get("severity", "medium"),
                json.dumps(stored_event.event),
                source_event_id,
            )
        # row is None when ON CONFLICT DO NOTHING suppressed the insert.
        return str(row["id"]) if row else ""
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            '{"event": "alert_save_error", "rule_id": "%s", "error": "%s"}',
            rule.get("id", "?"),
            str(exc).replace('"', "'"),
        )
        return ""
