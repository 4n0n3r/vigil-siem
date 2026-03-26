"""
/v1/endpoints — endpoint registration and listing.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.db import postgres, pg_endpoints
from app.models import (
    Endpoint,
    EndpointHeartbeatResponse,
    EndpointListResponse,
    EndpointRegisterRequest,
    EndpointRegisterResponse,
    ErrorResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _db_unavailable() -> JSONResponse:
    body = ErrorResponse(
        error_code="DB_NOT_CONNECTED",
        message="PostgreSQL is not available.",
        detail=None,
    )
    return JSONResponse(status_code=503, content=body.model_dump())


def _not_found(endpoint_id: str) -> JSONResponse:
    body = ErrorResponse(
        error_code="NOT_FOUND",
        message=f"Endpoint '{endpoint_id}' not found.",
        detail=None,
    )
    return JSONResponse(status_code=404, content=body.model_dump())


def _row_to_endpoint(row: dict) -> Endpoint:
    meta = row.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:  # noqa: BLE001
            meta = {}
    return Endpoint(
        id=str(row["id"]),
        name=row["name"],
        hostname=row.get("hostname", ""),
        os=row.get("os", ""),
        last_seen=row.get("last_seen"),
        created_at=row["created_at"],
        metadata=meta,
    )


# ---------------------------------------------------------------------------
# POST /endpoints/register
# ---------------------------------------------------------------------------

@router.post("/endpoints/register", response_model=EndpointRegisterResponse, status_code=201)
async def register_endpoint(body: EndpointRegisterRequest):
    """Register a new endpoint and return a one-time API key."""
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    try:
        row = await pg_endpoints.register_endpoint(
            name=body.name,
            hostname=body.hostname,
            os_name=body.os,
            metadata=body.metadata,
        )
    except Exception as exc:  # noqa: BLE001
        body_err = ErrorResponse(
            error_code="REGISTER_ERROR",
            message="Failed to register endpoint.",
            detail=str(exc),
        )
        return JSONResponse(status_code=500, content=body_err.model_dump())

    return EndpointRegisterResponse(
        id=str(row["id"]),
        name=row["name"],
        api_key=row["api_key"],
        created_at=row["created_at"],
    )


# ---------------------------------------------------------------------------
# GET /endpoints
# ---------------------------------------------------------------------------

@router.get("/endpoints", response_model=EndpointListResponse)
async def list_endpoints(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    rows, total = await pg_endpoints.list_endpoints(limit=limit, offset=offset)
    return EndpointListResponse(
        endpoints=[_row_to_endpoint(r) for r in rows],
        total=total,
    )


# ---------------------------------------------------------------------------
# GET /endpoints/{id}
# ---------------------------------------------------------------------------

@router.get("/endpoints/{endpoint_id}", response_model=Endpoint)
async def get_endpoint(endpoint_id: str):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    row = await pg_endpoints.get_endpoint_by_id(endpoint_id)
    if row is None:
        return _not_found(endpoint_id)

    return _row_to_endpoint(row)


# ---------------------------------------------------------------------------
# PATCH /endpoints/{id}/heartbeat
# ---------------------------------------------------------------------------

@router.patch("/endpoints/{endpoint_id}/heartbeat", response_model=EndpointHeartbeatResponse)
async def endpoint_heartbeat(endpoint_id: str):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    ok = await pg_endpoints.heartbeat(endpoint_id)
    if not ok:
        return _not_found(endpoint_id)

    return EndpointHeartbeatResponse(
        id=endpoint_id,
        last_seen=datetime.now(timezone.utc),
    )
