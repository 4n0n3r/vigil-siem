"""
Endpoint registry — PostgreSQL persistence helpers.

API key validation uses a module-level in-memory cache that is loaded lazily
on first call and invalidated after writes.  Since the API runs in a single
asyncio thread there is no need for a lock.
"""

from __future__ import annotations

import json
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
    ip_address: str = "",
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
            INSERT INTO endpoints (name, hostname, os, ip_address, api_key, metadata)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            RETURNING *
            """,
            name,
            hostname,
            os_name,
            ip_address,
            api_key,
            json.dumps(meta),
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


async def heartbeat(
    endpoint_id: str,
    ip_address: str = "",
    sys_info: dict[str, Any] | None = None,
) -> bool:
    """Update last_seen, ip_address, and optionally merge sys_info into metadata."""
    pool = postgres.get_pool()
    if pool is None:
        return False

    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        # Merge sys_info into existing metadata JSONB when provided.
        if sys_info:
            result = await conn.execute(
                """
                UPDATE endpoints
                SET last_seen  = $1,
                    ip_address = $3,
                    metadata   = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
                WHERE id = $2
                """,
                now,
                endpoint_id,
                ip_address,
                json.dumps(sys_info),
            )
        else:
            result = await conn.execute(
                "UPDATE endpoints SET last_seen = $1, ip_address = $3 WHERE id = $2",
                now,
                endpoint_id,
                ip_address,
            )

        if result != "UPDATE 1":
            return False

        # Track IP history: upsert by (endpoint_id, ip_address).
        if ip_address:
            await conn.execute(
                """
                INSERT INTO endpoint_ip_history (endpoint_id, ip_address, first_seen, last_seen)
                VALUES ($1, $2, $3, $3)
                ON CONFLICT DO NOTHING
                """,
                endpoint_id,
                ip_address,
                now,
            )
            # Update last_seen for the existing row if it already existed.
            await conn.execute(
                """
                UPDATE endpoint_ip_history
                SET last_seen = $3
                WHERE endpoint_id = $1 AND ip_address = $2
                """,
                endpoint_id,
                ip_address,
                now,
            )

    return True


async def get_ip_history(endpoint_id: str) -> list[dict]:
    """Return IP address history for an endpoint, newest first."""
    pool = postgres.get_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ip_address, first_seen, last_seen
            FROM endpoint_ip_history
            WHERE endpoint_id = $1
            ORDER BY last_seen DESC
            """,
            endpoint_id,
        )
    return [dict(r) for r in rows]


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


async def get_pending_commands(endpoint_id: str) -> list[str]:
    """Return a list of pending command names for the given endpoint."""
    pool = postgres.get_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT command FROM endpoint_commands WHERE endpoint_id = $1 AND status = 'pending' ORDER BY created_at",
            endpoint_id,
        )
    return [r["command"] for r in rows]


async def mark_commands_done(endpoint_id: str, command: str) -> None:
    """Mark all pending instances of command for endpoint_id as done."""
    pool = postgres.get_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE endpoint_commands
            SET status = 'done', completed_at = $1
            WHERE endpoint_id = $2 AND command = $3 AND status = 'pending'
            """,
            datetime.now(timezone.utc),
            endpoint_id,
            command,
        )


async def queue_command(endpoint_id: str, command: str) -> dict:
    """Insert a new pending command for the given endpoint."""
    pool = postgres.get_pool()
    if pool is None:
        raise RuntimeError("PostgreSQL not available")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO endpoint_commands (endpoint_id, command)
            VALUES ($1, $2)
            RETURNING id, endpoint_id, command, status, created_at
            """,
            endpoint_id,
            command,
        )
    return dict(row)


async def validate_api_key(api_key: str) -> Optional[dict]:
    """Return the endpoint dict for the given key, or None if invalid.

    Uses an in-memory cache.  Cache miss triggers a full reload from DB.
    """
    global _cache_warmed
    if not _cache_warmed:
        await _warm_cache()
    return _key_cache.get(api_key)
