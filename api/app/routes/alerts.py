"""
/v1/alerts — read and acknowledge alerts.

All persistence is via asyncpg.  If the PostgreSQL pool is not available,
every endpoint returns 503 with error_code DB_NOT_CONNECTED.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.db import postgres
from app.models import (
    Alert,
    AlertAcknowledgeRequest,
    AlertAcknowledgeResponse,
    AlertListResponse,
    ErrorResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _db_unavailable() -> JSONResponse:
    body = ErrorResponse(
        error_code="DB_NOT_CONNECTED",
        message="PostgreSQL is not available.",
        detail=None,
    )
    return JSONResponse(status_code=503, content=body.model_dump())


def _not_found(alert_id: str) -> JSONResponse:
    body = ErrorResponse(
        error_code="NOT_FOUND",
        message=f"Alert '{alert_id}' not found.",
        detail=None,
    )
    return JSONResponse(status_code=404, content=body.model_dump())


def _row_to_alert(row) -> Alert:
    snapshot = row["event_snapshot"]
    if isinstance(snapshot, str):
        try:
            snapshot = json.loads(snapshot)
        except Exception:  # noqa: BLE001
            snapshot = {}
    elif snapshot is None:
        snapshot = {}

    return Alert(
        id=str(row["id"]),
        rule_id=str(row["rule_id"]),
        rule_name=row.get("rule_name", ""),
        event_id=row["event_id"],
        severity=row["severity"],
        status=row["status"],
        matched_at=row["matched_at"],
        acknowledged_at=row.get("acknowledged_at"),
        note=row.get("note"),
        event_snapshot=snapshot,
    )


# ---------------------------------------------------------------------------
# GET /alerts
# ---------------------------------------------------------------------------

@router.get("/alerts", response_model=AlertListResponse)
async def list_alerts(
    status: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    rule_id: Optional[str] = Query(default=None),
    from_time: Optional[datetime] = Query(default=None),
    to_time: Optional[datetime] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    conditions = []
    params: list = []
    idx = 1

    if status is not None:
        conditions.append(f"a.status = ${idx}")
        params.append(status)
        idx += 1
    if severity is not None:
        conditions.append(f"a.severity = ${idx}")
        params.append(severity)
        idx += 1
    if rule_id is not None:
        conditions.append(f"a.rule_id = ${idx}")
        params.append(rule_id)
        idx += 1
    if from_time is not None:
        conditions.append(f"a.matched_at >= ${idx}")
        params.append(from_time)
        idx += 1
    if to_time is not None:
        conditions.append(f"a.matched_at <= ${idx}")
        params.append(to_time)
        idx += 1

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    base_query = f"""
        SELECT a.*, r.name AS rule_name
        FROM alerts a
        JOIN detection_rules r ON r.id = a.rule_id
        {where_clause}
    """

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM alerts a {where_clause}",
            *params,
        )
        rows = await conn.fetch(
            f"{base_query} ORDER BY a.matched_at DESC LIMIT ${idx} OFFSET ${idx + 1}",
            *params,
            limit,
            offset,
        )

    return AlertListResponse(
        alerts=[_row_to_alert(r) for r in rows],
        total=total,
    )


# ---------------------------------------------------------------------------
# GET /alerts/{id}
# ---------------------------------------------------------------------------

@router.get("/alerts/{alert_id}", response_model=Alert)
async def get_alert(alert_id: str):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT a.*, r.name AS rule_name
            FROM alerts a
            JOIN detection_rules r ON r.id = a.rule_id
            WHERE a.id = $1
            """,
            alert_id,
        )

    if row is None:
        return _not_found(alert_id)

    return _row_to_alert(row)


# ---------------------------------------------------------------------------
# POST /alerts/{id}/acknowledge
# ---------------------------------------------------------------------------

@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertAcknowledgeResponse)
async def acknowledge_alert(alert_id: str, body: AlertAcknowledgeRequest):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE alerts
            SET status = 'acknowledged',
                acknowledged_at = $1,
                note = $2
            WHERE id = $3
            RETURNING id, status, acknowledged_at, note
            """,
            now,
            body.note,
            alert_id,
        )

    if row is None:
        return _not_found(alert_id)

    return AlertAcknowledgeResponse(
        id=str(row["id"]),
        status=row["status"],
        acknowledged_at=row["acknowledged_at"],
        note=row["note"],
    )
