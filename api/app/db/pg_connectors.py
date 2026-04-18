"""
SIEM connector registry — PostgreSQL persistence helpers.
"""

from __future__ import annotations

import json
from typing import Any

from app.db import postgres


def _decode_row(row) -> dict:
    """asyncpg may return JSONB columns as strings. Ensure config is always a dict."""
    d = dict(row)
    if isinstance(d.get("config"), str):
        d["config"] = json.loads(d["config"])
    return d


async def create_connector(
    name: str,
    siem_type: str,
    config: dict[str, Any],
) -> dict:
    pool = postgres.get_pool()
    if pool is None:
        raise RuntimeError("PostgreSQL not available")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO siem_connectors (name, siem_type, config)
            VALUES ($1, $2, $3::jsonb)
            RETURNING id, name, siem_type, config, enabled, last_polled, last_error, created_at
            """,
            name,
            siem_type,
            json.dumps(config),
        )
    return _decode_row(row)


async def list_connectors() -> list[dict]:
    pool = postgres.get_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, siem_type, config, enabled, last_polled, last_error, created_at"
            " FROM siem_connectors ORDER BY created_at ASC"
        )
    return [_decode_row(r) for r in rows]


async def get_connector(connector_id: str) -> dict | None:
    pool = postgres.get_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, siem_type, config, enabled, last_polled, last_error, created_at"
            " FROM siem_connectors WHERE id = $1",
            connector_id,
        )
    return _decode_row(row) if row else None


async def delete_connector(connector_id: str) -> bool:
    pool = postgres.get_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM siem_connectors WHERE id = $1",
            connector_id,
        )
    return result == "DELETE 1"


async def update_connector_status(
    connector_id: str,
    *,
    error: str | None = None,
) -> None:
    """Update last_polled + last_error after a fetch attempt."""
    pool = postgres.get_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE siem_connectors SET last_polled = now(), last_error = $2 WHERE id = $1",
            connector_id,
            error,
        )
