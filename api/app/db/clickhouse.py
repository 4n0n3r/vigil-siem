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

_ch_client = None   # clickhouse_connect.Client | None — used only for init/DDL
_ch_params: dict | None = None  # connection params for per-call clients

_VIGIL_EVENTS_DDL = """
CREATE TABLE IF NOT EXISTS vigil_events (
    id           String,
    source       LowCardinality(String),
    event        String,
    timestamp    DateTime64(3, 'UTC'),
    ingested_at  DateTime64(3, 'UTC') DEFAULT now64(),
    INDEX event_ngram event TYPE ngrambf_v1(3, 32768, 3, 0) GRANULARITY 1
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (source, timestamp, id)
SETTINGS index_granularity = 8192
"""

# Add index to existing tables that pre-date the DDL above.
_VIGIL_EVENTS_ADD_INDEX = """
ALTER TABLE vigil_events ADD INDEX IF NOT EXISTS
    event_ngram event TYPE ngrambf_v1(3, 32768, 3, 0) GRANULARITY 1
"""


async def init_clickhouse() -> None:
    """Connect to ClickHouse and create the events table.

    Called once from the FastAPI lifespan context manager.
    Logs a warning and returns cleanly if anything goes wrong.
    """
    global _ch_client, _ch_params

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

        params = dict(
            host=host,
            port=port,
            username=user,
            password=password,
            database=database,
            secure=secure,
        )

        def _connect():
            return clickhouse_connect.get_client(**params)

        client = await asyncio.to_thread(_connect)

        # Create the table (idempotent)
        await asyncio.to_thread(client.command, _VIGIL_EVENTS_DDL)
        # Add ngrambf index to pre-existing tables (no-op if already present)
        try:
            await asyncio.to_thread(client.command, _VIGIL_EVENTS_ADD_INDEX)
        except Exception:  # noqa: BLE001
            pass  # older CH versions may not support IF NOT EXISTS on ALTER INDEX

        _ch_client = client
        _ch_params = params

        # Add endpoint_id column to existing tables (idempotent).
        try:
            await asyncio.to_thread(
                client.command,
                "ALTER TABLE vigil_events ADD COLUMN IF NOT EXISTS"
                " endpoint_id LowCardinality(String) DEFAULT ''",
            )
        except Exception:  # noqa: BLE001
            pass  # older CH versions or column already exists

        logger.info(
            '{"event": "clickhouse_connected", "host": "%s", "database": "%s"}',
            host,
            database,
        )

    except Exception as exc:  # noqa: BLE001
        _warn(f"ClickHouse connection failed ({exc}) — using in-memory fallback")


def get_client():
    """Return a fresh ClickHouse client per call (thread-safe, no shared session).

    Returns None if ClickHouse was not successfully initialised.
    """
    if _ch_params is None:
        return None
    import clickhouse_connect  # noqa: PLC0415
    return clickhouse_connect.get_client(**_ch_params)


def get_warnings() -> list[str]:
    """Return a list of human-readable warnings about ClickHouse availability."""
    if _ch_params is None:
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
