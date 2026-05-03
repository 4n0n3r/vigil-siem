"""
PostgreSQL connection management.

Reads POSTGRES_DSN from the environment on startup.
If absent or connection fails, _pg_pool stays None and callers return 503.
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys

logger = logging.getLogger(__name__)

_pg_pool = None  # asyncpg.Pool | None

_MIGRATIONS_DIR = pathlib.Path(__file__).parent / "migrations"


async def init_postgres() -> None:
    """Create the asyncpg connection pool and run migrations.

    Called once from the FastAPI lifespan context manager.
    Logs a warning and returns cleanly if anything goes wrong.
    """
    global _pg_pool

    dsn = os.environ.get("POSTGRES_DSN", "").strip()
    if not dsn:
        _warn("POSTGRES_DSN is not set — PostgreSQL disabled")
        return

    try:
        import asyncpg  # noqa: PLC0415

        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
        _pg_pool = pool

        # Run migrations in order.
        async with pool.acquire() as conn:
            for migration in sorted(_MIGRATIONS_DIR.glob("*.sql")):
                await conn.execute(migration.read_text())

        logger.info('{"event": "postgres_connected"}')

    except Exception as exc:  # noqa: BLE001
        _warn(f"PostgreSQL connection failed ({exc}) — DB features disabled")
        _pg_pool = None


def get_pool():
    """Return the asyncpg pool, or None if not available."""
    return _pg_pool


def get_warnings() -> list[str]:
    """Return a list of human-readable warnings about PostgreSQL availability."""
    if _pg_pool is None:
        return ["PostgreSQL not configured"]
    return []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _warn(msg: str) -> None:
    print(
        f'{{"level": "warning", "component": "postgres", "message": "{msg}"}}',
        file=sys.stderr,
    )
    logger.warning(msg)
