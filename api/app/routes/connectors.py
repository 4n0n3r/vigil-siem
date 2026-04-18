"""
SIEM connector management routes.

POST   /v1/connectors              create
GET    /v1/connectors              list
GET    /v1/connectors/{id}         get one
DELETE /v1/connectors/{id}         delete
POST   /v1/connectors/{id}/test    test connection
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.connectors import get_connector, SUPPORTED_TYPES
from app.db import pg_connectors
from app.models import (
    ConnectorCreate,
    ConnectorListResponse,
    ConnectorResponse,
    ConnectorTestResult,
    ErrorResponse,
)

router = APIRouter(prefix="/v1/connectors", tags=["connectors"])


def _row_to_response(row: dict) -> ConnectorResponse:
    conn = get_connector(row)
    return ConnectorResponse(
        id=str(row["id"]),
        name=row["name"],
        siem_type=row["siem_type"],
        config=conn.redact_config(),
        enabled=row["enabled"],
        last_polled=row.get("last_polled"),
        last_error=row.get("last_error"),
        created_at=row["created_at"],
    )


@router.post("", response_model=ConnectorResponse, status_code=201)
async def create_connector(body: ConnectorCreate):
    if body.siem_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=422,
            detail=ErrorResponse(
                error_code="UNSUPPORTED_SIEM_TYPE",
                message=f"Unsupported SIEM type: {body.siem_type!r}",
                hint=f"Supported types: {', '.join(SUPPORTED_TYPES)}",
            ).model_dump(),
        )

    # Validate required config keys per type
    _validate_config(body.siem_type, body.config)

    try:
        row = await pg_connectors.create_connector(body.name, body.siem_type, body.config)
    except Exception as exc:
        err_str = str(exc)
        if "unique" in err_str.lower() or "duplicate" in err_str.lower():
            raise HTTPException(
                status_code=409,
                detail=ErrorResponse(
                    error_code="CONNECTOR_NAME_CONFLICT",
                    message=f"A connector named {body.name!r} already exists",
                    hint="Use a different name or delete the existing connector first",
                ).model_dump(),
            ) from exc
        raise HTTPException(
            status_code=503,
            detail=ErrorResponse(
                error_code="DB_ERROR",
                message="Failed to create connector",
                detail=err_str,
            ).model_dump(),
        ) from exc

    return _row_to_response(row)


@router.get("", response_model=ConnectorListResponse)
async def list_connectors():
    rows = await pg_connectors.list_connectors()
    return ConnectorListResponse(
        connectors=[_row_to_response(r) for r in rows],
        total=len(rows),
    )


@router.get("/{connector_id}", response_model=ConnectorResponse)
async def get_connector_by_id(connector_id: str):
    row = await pg_connectors.get_connector(connector_id)
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error_code="CONNECTOR_NOT_FOUND",
                message=f"No connector with id {connector_id!r}",
            ).model_dump(),
        )
    return _row_to_response(row)


@router.delete("/{connector_id}", status_code=204)
async def delete_connector(connector_id: str):
    deleted = await pg_connectors.delete_connector(connector_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error_code="CONNECTOR_NOT_FOUND",
                message=f"No connector with id {connector_id!r}",
            ).model_dump(),
        )


@router.post("/{connector_id}/test", response_model=ConnectorTestResult)
async def test_connector(connector_id: str):
    row = await pg_connectors.get_connector(connector_id)
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error_code="CONNECTOR_NOT_FOUND",
                message=f"No connector with id {connector_id!r}",
            ).model_dump(),
        )

    conn = get_connector(row)
    ok, message, latency_ms = await conn.test_connection()
    return ConnectorTestResult(
        ok=ok,
        message=message,
        connector_id=connector_id,
        latency_ms=latency_ms,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_REQUIRED_CONFIG: dict[str, list[str]] = {
    "wazuh": ["indexer_url", "indexer_user", "indexer_password"],
    "elastic": ["url", "api_key"],
}


def _validate_config(siem_type: str, config: dict) -> None:
    missing = [k for k in _REQUIRED_CONFIG.get(siem_type, []) if not config.get(k)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=ErrorResponse(
                error_code="CONNECTOR_CONFIG_INVALID",
                message=f"Missing required config keys for {siem_type}: {missing}",
                hint="See docs/connectors.md for required fields per SIEM type",
            ).model_dump(),
        )
