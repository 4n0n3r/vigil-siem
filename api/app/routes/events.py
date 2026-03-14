from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query

from app.models import (
    BatchIngestRequest,
    BatchIngestResponse,
    IngestRequest,
    IngestResponse,
    SearchEvent,
    SearchResponse,
    StoredEvent,
)
from app import store

router = APIRouter()


@router.post("/events", response_model=IngestResponse, status_code=200)
async def ingest_event(body: IngestRequest) -> IngestResponse:
    """Ingest a single event into the store."""
    event_id = str(uuid.uuid4())
    timestamp = body.timestamp if body.timestamp is not None else datetime.now(timezone.utc)

    stored = StoredEvent(
        id=event_id,
        source=body.source,
        event=body.event,
        timestamp=timestamp,
    )
    store.add_event(stored)

    return IngestResponse(
        id=event_id,
        source=body.source,
        timestamp=timestamp,
        status="ingested",
    )


@router.post("/events/batch", response_model=BatchIngestResponse, status_code=200)
async def ingest_batch(body: BatchIngestRequest) -> BatchIngestResponse:
    """Ingest a batch of events into the store."""
    ids: list[str] = []
    errors: list[str] = []

    for item in body.events:
        try:
            event_id = str(uuid.uuid4())
            timestamp = item.timestamp if item.timestamp is not None else datetime.now(timezone.utc)
            stored = StoredEvent(
                id=event_id,
                source=item.source,
                event=item.event,
                timestamp=timestamp,
            )
            store.add_event(stored)
            ids.append(event_id)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    return BatchIngestResponse(
        ingested=len(ids),
        ids=ids,
        errors=errors,
    )


@router.get("/events/search", response_model=SearchResponse)
async def search_events(
    query: Optional[str] = Query(default=None, description="Substring filter against the full event payload"),
    from_time: Optional[datetime] = Query(default=None, alias="from_time"),
    to_time: Optional[datetime] = Query(default=None, alias="to_time"),
    limit: int = Query(default=100, ge=1, le=10_000),
) -> SearchResponse:
    """Search stored events with optional time-range and substring filters."""
    t0 = time.monotonic()

    results = store.search_events(
        query=query,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
    )

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    return SearchResponse(
        events=[
            SearchEvent(
                id=ev.id,
                source=ev.source,
                event=ev.event,
                timestamp=ev.timestamp,
            )
            for ev in results
        ],
        total=len(results),
        query_time_ms=elapsed_ms,
    )
