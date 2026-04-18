from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db import pg_suppressions
from app.models import (
    ErrorResponse,
    SuppressionCreate,
    SuppressionListResponse,
    SuppressionResponse,
    SuppressionToggleRequest,
)

router = APIRouter()


@router.get("/suppressions", response_model=SuppressionListResponse)
async def list_suppressions(include_disabled: bool = False) -> SuppressionListResponse:
    rows = await pg_suppressions.list_suppressions(include_disabled=include_disabled)
    return SuppressionListResponse(
        suppressions=[SuppressionResponse(**r) for r in rows],
        total=len(rows),
    )


@router.post("/suppressions", response_model=SuppressionResponse, status_code=201)
async def create_suppression(body: SuppressionCreate) -> SuppressionResponse:
    row = await pg_suppressions.create_suppression(
        name=body.name,
        field_path=body.field_path,
        field_value=body.field_value,
        match_type=body.match_type,
        scope=body.scope,
        description=body.description,
    )
    if row is None:
        raise HTTPException(
            status_code=503,
            detail=ErrorResponse(
                error_code="STORAGE_UNAVAILABLE",
                message="Failed to create suppression — PostgreSQL unavailable.",
                hint="Check POSTGRES_DSN and restart the API.",
            ).model_dump(),
        )
    return SuppressionResponse(**row)


@router.delete("/suppressions/{suppression_id}", status_code=200)
async def delete_suppression(suppression_id: str) -> dict:
    deleted = await pg_suppressions.delete_suppression(suppression_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error_code="not_found",
                message=f"Suppression {suppression_id} not found.",
            ).model_dump(),
        )
    return {"status": "deleted", "id": suppression_id}


@router.patch("/suppressions/{suppression_id}", response_model=SuppressionResponse)
async def toggle_suppression(
    suppression_id: str, body: SuppressionToggleRequest
) -> SuppressionResponse:
    ok = await pg_suppressions.toggle_suppression(suppression_id, body.enabled)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error_code="not_found",
                message=f"Suppression {suppression_id} not found.",
            ).model_dump(),
        )
    rows = await pg_suppressions.list_suppressions(include_disabled=True)
    match = next((r for r in rows if str(r["id"]) == suppression_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail={"error_code": "not_found", "message": "not found"})
    return SuppressionResponse(**match)
