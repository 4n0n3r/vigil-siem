from __future__ import annotations

from datetime import datetime
from typing import Any
import uuid

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Error response — used by the global exception handler
# ---------------------------------------------------------------------------

class ErrorResponse(BaseModel):
    error_code: str
    message: str
    detail: Any = None


# ---------------------------------------------------------------------------
# POST /v1/events
# ---------------------------------------------------------------------------

class IngestRequest(BaseModel):
    source: str
    event: dict[str, Any]
    timestamp: datetime | None = None


class IngestResponse(BaseModel):
    id: str
    source: str
    timestamp: datetime
    status: str = "ingested"


# ---------------------------------------------------------------------------
# GET /v1/events/search
# ---------------------------------------------------------------------------

class StoredEvent(BaseModel):
    """Internal representation kept in the in-memory store."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source: str
    event: dict[str, Any]
    timestamp: datetime


class SearchEvent(BaseModel):
    """Shape of each item returned in search results."""
    id: str
    source: str
    event: dict[str, Any]
    timestamp: datetime


class SearchResponse(BaseModel):
    events: list[SearchEvent]
    total: int
    query_time_ms: int


# ---------------------------------------------------------------------------
# GET /v1/status
# ---------------------------------------------------------------------------

class StatusResponse(BaseModel):
    api_status: str = "ok"
    db_status: str = "not_connected"
    events_last_24h: int


# ---------------------------------------------------------------------------
# POST /v1/events/batch
# ---------------------------------------------------------------------------

class BatchIngestRequest(BaseModel):
    events: list[IngestRequest]


class BatchIngestResponse(BaseModel):
    ingested: int
    ids: list[str]
    errors: list[str]
