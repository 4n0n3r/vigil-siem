"""
Helper for persisting Sigma-triggered alerts to PostgreSQL.

Used by the ingest route after evaluating each enabled detection rule.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


async def save_alert(rule: dict, stored_event) -> str:
    """Insert an alert row and return its UUID string.

    Parameters
    ----------
    rule:
        An entry from the Sigma rule cache (must have keys: id, severity).
    stored_event:
        A StoredEvent instance (id, event dict, timestamp).

    Returns the new alert's UUID, or empty string on failure.
    """
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return ""

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO alerts (rule_id, event_id, severity, event_snapshot)
                VALUES ($1, $2, $3, $4::jsonb)
                RETURNING id
                """,
                rule["id"],
                stored_event.id,
                rule.get("severity", "medium"),
                json.dumps(stored_event.event),
            )
        return str(row["id"]) if row else ""
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            '{"event": "alert_save_error", "rule_id": "%s", "error": "%s"}',
            rule.get("id", "?"),
            str(exc).replace('"', "'"),
        )
        return ""
