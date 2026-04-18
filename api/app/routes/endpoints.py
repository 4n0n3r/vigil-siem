"""
/v1/endpoints — endpoint registration and listing.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.db import postgres, pg_endpoints, pg_tokens
from app.models import (
    Endpoint,
    EndpointCommandRequest,
    EndpointHeartbeatRequest,
    EndpointHeartbeatResponse,
    EndpointListResponse,
    EndpointRegisterRequest,
    EndpointRegisterResponse,
    ErrorResponse,
)

_REQUIRE_AUTH = os.environ.get("VIGIL_REQUIRE_AUTH", "").lower() in ("true", "1", "yes")

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
        ip_address=row.get("ip_address", ""),
        last_seen=row.get("last_seen"),
        created_at=row["created_at"],
        metadata=meta,
    )


# ---------------------------------------------------------------------------
# POST /endpoints/register
# ---------------------------------------------------------------------------

@router.post("/endpoints/register", response_model=EndpointRegisterResponse, status_code=201)
async def register_endpoint(body: EndpointRegisterRequest):
    """Register a new endpoint and return a one-time API key.

    When VIGIL_REQUIRE_AUTH=true an enrollment token must be provided in the
    request body. Generate one with: vigil token create
    """
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    # Validate enrollment token when auth is enforced.
    if _REQUIRE_AUTH:
        if not body.enroll_token:
            err = ErrorResponse(
                error_code="ENROLL_TOKEN_REQUIRED",
                message="An enrollment token is required to register an endpoint.",
                hint="Generate one on the server with: vigil token create",
            )
            return JSONResponse(status_code=403, content=err.model_dump())

        token_row = await pg_tokens.validate_and_consume(body.enroll_token)
        if token_row is None:
            err = ErrorResponse(
                error_code="INVALID_ENROLL_TOKEN",
                message="Enrollment token is invalid, expired, or already used.",
                hint="Generate a new token with: vigil token create",
            )
            return JSONResponse(status_code=403, content=err.model_dump())

    try:
        row = await pg_endpoints.register_endpoint(
            name=body.name,
            hostname=body.hostname,
            os_name=body.os,
            ip_address=body.ip_address,
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
# DELETE /endpoints/{id}
# ---------------------------------------------------------------------------

@router.delete("/endpoints/{endpoint_id}", status_code=204)
async def delete_endpoint(endpoint_id: str):
    """Delete an endpoint and its API key. The endpoint will need to re-register."""
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    ok = await pg_endpoints.delete_endpoint(endpoint_id)
    if not ok:
        return _not_found(endpoint_id)

    return None


# ---------------------------------------------------------------------------
# PATCH /endpoints/{id}/heartbeat
# ---------------------------------------------------------------------------

@router.patch("/endpoints/{endpoint_id}/heartbeat", response_model=EndpointHeartbeatResponse)
async def endpoint_heartbeat(endpoint_id: str, body: EndpointHeartbeatRequest = None):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    ip_address = body.ip_address if body else ""
    ok = await pg_endpoints.heartbeat(endpoint_id, ip_address=ip_address)
    if not ok:
        return _not_found(endpoint_id)

    # Fetch pending commands and deliver them exactly once.
    pending = await pg_endpoints.get_pending_commands(endpoint_id)
    if pending:
        for cmd in set(pending):
            await pg_endpoints.mark_commands_done(endpoint_id, cmd)

    return EndpointHeartbeatResponse(
        id=endpoint_id,
        last_seen=datetime.now(timezone.utc),
        pending_commands=pending,
    )


# ---------------------------------------------------------------------------
# POST /endpoints/{id}/commands
# ---------------------------------------------------------------------------

@router.post("/endpoints/{endpoint_id}/commands", status_code=202)
async def queue_command(endpoint_id: str, body: EndpointCommandRequest):
    """Queue a command for delivery to the agent on next heartbeat."""
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    row = await pg_endpoints.get_endpoint_by_id(endpoint_id)
    if row is None:
        return _not_found(endpoint_id)

    try:
        cmd_row = await pg_endpoints.queue_command(endpoint_id, body.command)
    except Exception as exc:  # noqa: BLE001
        err = ErrorResponse(
            error_code="COMMAND_QUEUE_ERROR",
            message="Failed to queue command.",
            detail=str(exc),
        )
        return JSONResponse(status_code=500, content=err.model_dump())

    return {"id": str(cmd_row["id"]), "command": body.command, "status": "queued"}
