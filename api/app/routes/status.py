from __future__ import annotations

import logging

from fastapi import APIRouter

from app.models import StatusResponse
from app import store
from app.db import clickhouse, postgres
from app.sigma import loader

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/status", response_model=StatusResponse)
async def get_status() -> StatusResponse:
    """Return system health and basic ingestion metrics."""
    # Connection statuses
    ch_client = clickhouse.get_client()
    ch_status = "ok" if ch_client is not None else "not_connected"

    pg_pool = postgres.get_pool()
    pg_status = "ok" if pg_pool is not None else "not_connected"

    # Counts
    events_24h = await store.count_last_24h()

    open_alerts = 0
    active_rules = 0

    if pg_pool is not None:
        try:
            async with pg_pool.acquire() as conn:
                open_alerts = await conn.fetchval(
                    "SELECT COUNT(*) FROM alerts WHERE status = 'open'"
                ) or 0
                active_rules = await conn.fetchval(
                    "SELECT COUNT(*) FROM detection_rules WHERE enabled = TRUE"
                ) or 0
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                '{"event": "status_db_query_failed", "error": "%s"}',
                str(exc).replace('"', "'"),
            )

    # Aggregate warnings
    warnings = clickhouse.get_warnings() + postgres.get_warnings()

    # Legacy db_status field — reflect worst-case for backwards compat
    if ch_status == "ok" or pg_status == "ok":
        db_status = "ok"
    else:
        db_status = "not_connected"

    return StatusResponse(
        api_status="ok",
        db_status=db_status,
        events_last_24h=events_24h,
        clickhouse_status=ch_status,
        postgres_status=pg_status,
        open_alerts=open_alerts,
        active_rules=active_rules,
        warnings=warnings,
    )
