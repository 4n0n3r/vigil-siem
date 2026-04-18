"""
Endpoint registry — PostgreSQL persistence helpers.

API key validation uses a module-level in-memory cache that is loaded lazily
on first call and invalidated after writes.  Since the API runs in a single
asyncio thread there is no need for a lock.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from app.db import postgres

# ---------------------------------------------------------------------------
# API key cache  (key → endpoint dict)
# ---------------------------------------------------------------------------

_key_cache: dict[str, dict] = {}
_cache_warmed: bool = False


def invalidate_cache() -> None:
    """Force the next validate_api_key call to reload all keys from the DB."""
    global _cache_warmed
    _key_cache.clear()
    _cache_warmed = False


async def _warm_cache() -> None:
    global _cache_warmed
    pool = postgres.get_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM endpoints")
    _key_cache.clear()
    for row in rows:
        _key_cache[row["api_key"]] = dict(row)
    _cache_warmed = True


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def _generate_api_key() -> str:
    return "vig_" + secrets.token_urlsafe(32)


async def register_endpoint(
    name: str,
    hostname: str = "",
    os_name: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict:
    pool = postgres.get_pool()
    if pool is None:
        raise RuntimeError("PostgreSQL not available")

    api_key = _generate_api_key()
    meta = metadata or {}

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO endpoints (name, hostname, os, api_key, metadata)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            RETURNING *
            """,
            name,
            hostname,
            os_name,
            api_key,
            str(meta).replace("'", '"'),  # simple JSON-safe conversion
        )

    result = dict(row)
    invalidate_cache()
    return result


async def get_endpoint_by_id(endpoint_id: str) -> Optional[dict]:
    pool = postgres.get_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM endpoints WHERE id = $1", endpoint_id
        )
    return dict(row) if row else None


async def list_endpoints(limit: int = 100, offset: int = 0) -> tuple[list[dict], int]:
    pool = postgres.get_pool()
    if pool is None:
        return [], 0
    async with pool.acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM endpoints")
        rows = await conn.fetch(
            "SELECT * FROM endpoints ORDER BY created_at DESC LIMIT $1 OFFSET $2",
            limit,
            offset,
        )
    return [dict(r) for r in rows], total


async def heartbeat(endpoint_id: str) -> bool:
    """Update last_seen = now() for the given endpoint. Returns True on success."""
    pool = postgres.get_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE endpoints SET last_seen = $1 WHERE id = $2",
            datetime.now(timezone.utc),
            endpoint_id,
        )
    return result == "UPDATE 1"


async def delete_endpoint(endpoint_id: str) -> bool:
    """Delete an endpoint by ID. Returns True if a row was deleted."""
    pool = postgres.get_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM endpoints WHERE id = $1", endpoint_id
        )
    invalidate_cache()
    return result == "DELETE 1"


async def validate_api_key(api_key: str) -> Optional[dict]:
    """Return the endpoint dict for the given key, or None if invalid.

    Uses an in-memory cache.  Cache miss triggers a full reload from DB.
    """
    global _cache_warmed
    if not _cache_warmed:
        await _warm_cache()
    return _key_cache.get(api_key)
