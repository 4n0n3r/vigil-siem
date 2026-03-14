from __future__ import annotations

from fastapi import APIRouter

from app.models import StatusResponse
from app import store

router = APIRouter()


@router.get("/status", response_model=StatusResponse)
async def get_status() -> StatusResponse:
    """Return system health and basic ingestion metrics."""
    return StatusResponse(
        api_status="ok",
        db_status="not_connected",
        events_last_24h=store.count_last_24h(),
    )
