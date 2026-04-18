"""
Global suppression / allowlist management.

Suppressions are loaded from PostgreSQL and cached in memory with a 60-second
TTL so the hot ingest path never blocks on a DB round-trip.

A suppression matches when the value at ``field_path`` in the event equals
(or contains / regex-matches) ``field_value``.  When matched, the alert is
silently dropped and the suppression's hit_count is incremented.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory cache
# ---------------------------------------------------------------------------

_cache: list[dict] = []
_cache_ts: float = 0.0
_CACHE_TTL = 60.0  # seconds


async def get_active_suppressions() -> list[dict]:
    """Return active suppressions, refreshing the cache if stale."""
    global _cache, _cache_ts  # noqa: PLW0603

    now = time.monotonic()
    if now - _cache_ts < _CACHE_TTL and _cache_ts > 0:
        return _cache

    rows = await _load_from_db()
    _cache = rows
    _cache_ts = now
    return _cache


async def invalidate_cache() -> None:
    """Force a reload on the next call to get_active_suppressions."""
    global _cache_ts  # noqa: PLW0603
    _cache_ts = 0.0


# ---------------------------------------------------------------------------
# Matching (sync — called from the ingest hot path)
# ---------------------------------------------------------------------------

def _get_field(event: dict, field_path: str) -> Any:
    """Resolve a dot-notation field_path from an event dict."""
    parts = field_path.split(".", 1)
    val = event.get(parts[0])
    if len(parts) == 1 or not isinstance(val, dict):
        return val
    return _get_field(val, parts[1])


def _matches_suppression(event: dict, s: dict) -> bool:
    actual = _get_field(event, s["field_path"])
    if actual is None:
        return False
    actual_str   = str(actual).lower()
    expected_str = str(s["field_value"]).lower()
    match_type   = s.get("match_type", "exact")

    if match_type == "exact":
        return actual_str == expected_str
    if match_type == "contains":
        return expected_str in actual_str
    if match_type == "regex":
        try:
            return bool(re.search(s["field_value"], str(actual), re.IGNORECASE))
        except re.error:
            return False
    return False


def is_suppressed(event: dict, suppressions: list[dict]) -> bool:
    """Return True if the event matches any active global suppression."""
    for s in suppressions:
        if s.get("scope", "global") != "global":
            continue
        if _matches_suppression(event, s):
            return True
    return False


# ---------------------------------------------------------------------------
# Side-effect: increment hit_count when a suppression fires
# ---------------------------------------------------------------------------

async def record_suppression_hit(event: dict, suppressions: list[dict]) -> None:
    """Increment hit_count + last_hit_at on the first matching suppression."""
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return

    for s in suppressions:
        if s.get("scope", "global") != "global":
            continue
        if _matches_suppression(event, s):
            try:
                async with pool.acquire() as conn:
                    await conn.execute(
                        """
                        UPDATE suppressions
                        SET hit_count = hit_count + 1,
                            last_hit_at = now()
                        WHERE id = $1
                        """,
                        s["id"],
                    )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    '{"event": "suppression_hit_error", "id": "%s", "error": "%s"}',
                    s.get("id"), str(exc).replace('"', "'"),
                )
            return  # only record once per event


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def list_suppressions(include_disabled: bool = False) -> list[dict]:
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return []

    where = "" if include_disabled else "WHERE enabled = TRUE"
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT id, name, description, field_path, field_value,
                       match_type, scope, enabled, hit_count, last_hit_at, created_at
                FROM suppressions
                {where}
                ORDER BY created_at DESC
                """
            )
        return [dict(r) for r in rows]
    except Exception as exc:  # noqa: BLE001
        logger.warning('{"event": "suppressions_list_error", "error": "%s"}', str(exc))
        return []


async def create_suppression(
    name: str,
    field_path: str,
    field_value: str,
    match_type: str = "exact",
    scope: str = "global",
    description: str = "",
) -> dict | None:
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return None

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO suppressions
                    (name, description, field_path, field_value, match_type, scope)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, name, description, field_path, field_value,
                          match_type, scope, enabled, hit_count, last_hit_at, created_at
                """,
                name, description, field_path, field_value, match_type, scope,
            )
        await invalidate_cache()
        return dict(row) if row else None
    except Exception as exc:  # noqa: BLE001
        logger.warning('{"event": "suppression_create_error", "error": "%s"}', str(exc))
        return None


async def delete_suppression(suppression_id: str) -> bool:
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return False

    try:
        async with pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM suppressions WHERE id = $1", suppression_id
            )
        await invalidate_cache()
        return result == "DELETE 1"
    except Exception as exc:  # noqa: BLE001
        logger.warning('{"event": "suppression_delete_error", "error": "%s"}', str(exc))
        return False


async def toggle_suppression(suppression_id: str, enabled: bool) -> bool:
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return False

    try:
        async with pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE suppressions SET enabled = $1 WHERE id = $2",
                enabled, suppression_id,
            )
        await invalidate_cache()
        return result == "UPDATE 1"
    except Exception as exc:  # noqa: BLE001
        logger.warning('{"event": "suppression_toggle_error", "error": "%s"}', str(exc))
        return False


# ---------------------------------------------------------------------------
# Internal: load from DB
# ---------------------------------------------------------------------------

async def _load_from_db() -> list[dict]:
    from app.db import postgres  # noqa: PLC0415

    pool = postgres.get_pool()
    if pool is None:
        return []

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, name, field_path, field_value, match_type, scope,
                       hit_count, last_hit_at
                FROM suppressions
                WHERE enabled = TRUE
                ORDER BY created_at
                """
            )
        return [dict(r) for r in rows]
    except Exception as exc:  # noqa: BLE001
        logger.warning('{"event": "suppressions_load_error", "error": "%s"}', str(exc))
        return []
