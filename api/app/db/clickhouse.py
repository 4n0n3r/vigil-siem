"""
ClickHouse connection management.

Reads CLICKHOUSE_DSN from the environment on startup.
If the variable is absent or the connection fails, _ch_client stays None
and all callers fall back to the in-memory store — no exceptions raised.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_ch_client = None  # clickhouse_connect.Client | None

_VIGIL_EVENTS_DDL = """
CREATE TABLE IF NOT EXISTS vigil_events (
    id           String,
    source       LowCardinality(String),
    event        String,
    timestamp    DateTime64(3, 'UTC'),
    ingested_at  DateTime64(3, 'UTC') DEFAULT now64()
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (source, timestamp, id)
SETTINGS index_granularity = 8192
"""


async def init_clickhouse() -> None:
    """Connect to ClickHouse and create the events table.

    Called once from the FastAPI lifespan context manager.
    Logs a warning and returns cleanly if anything goes wrong.
    """
    global _ch_client

    dsn = os.environ.get("CLICKHOUSE_DSN", "").strip()
    if not dsn:
        _warn("CLICKHOUSE_DSN is not set — ClickHouse disabled, using in-memory fallback")
        return

    try:
        import clickhouse_connect  # noqa: PLC0415  (lazy import)

        parsed = urlparse(dsn)
        host = parsed.hostname or "localhost"
        port = parsed.port or 8443
        user = parsed.username or "default"
        password = parsed.password or ""
        database = (parsed.path or "/default").lstrip("/") or "default"
        # Accept both clickhouse:// and clickhouses:// (with TLS)
        secure = parsed.scheme in ("clickhouses", "clickhouse+https") or bool(
            _query_flag(parsed.query, "secure")
        )

        def _connect():
            return clickhouse_connect.get_client(
                host=host,
                port=port,
                username=user,
                password=password,
                database=database,
                secure=secure,
            )

        client = await asyncio.to_thread(_connect)

        # Create the table (idempotent)
        await asyncio.to_thread(client.command, _VIGIL_EVENTS_DDL)

        _ch_client = client
        logger.info(
            '{"event": "clickhouse_connected", "host": "%s", "database": "%s"}',
            host,
            database,
        )

    except Exception as exc:  # noqa: BLE001
        _warn(f"ClickHouse connection failed ({exc}) — using in-memory fallback")


def get_client():
    """Return the connected ClickHouse client, or None if not available."""
    return _ch_client


def get_warnings() -> list[str]:
    """Return a list of human-readable warnings about ClickHouse availability."""
    if _ch_client is None:
        return ["ClickHouse not configured"]
    return []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _warn(msg: str) -> None:
    """Emit a structured warning to stderr and the logger."""
    print(
        f'{{"level": "warning", "component": "clickhouse", "message": "{msg}"}}',
        file=sys.stderr,
    )
    logger.warning(msg)


def _query_flag(query_string: str, key: str) -> bool:
    """Return True if key=true (case-insensitive) appears in the query string."""
    for part in query_string.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            if k.lower() == key.lower() and v.lower() in ("true", "1", "yes"):
                return True
    return False
