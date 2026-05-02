"""
GET /v1/hunt — HQL-powered threat hunting endpoint.

Query parameters:
  q        HQL query string (field:value, wildcards, AND/OR/NOT)
  from     ISO-8601 datetime — lower bound on timestamp
  to       ISO-8601 datetime — upper bound on timestamp
  limit    max events returned (default 100, max 1000)
  agg      dotted field path to aggregate on (e.g. event_data.IpAddress)
  timeline include hourly event-count buckets in response
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app import store
from app.models import (
    ErrorResponse,
    HuntAggBucket,
    HuntResponse,
    SearchEvent,
    TimelineBucket,
)

router = APIRouter()


@router.get("/hunt", response_model=HuntResponse)
async def hunt(
    q: Optional[str] = Query(default=None, description="HQL query"),
    from_: Optional[datetime] = Query(default=None, alias="from"),
    to: Optional[datetime] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    agg: Optional[str] = Query(default=None, description="Field to aggregate on"),
    timeline: bool = Query(default=False, description="Include hourly timeline"),
    endpoint_id: Optional[str] = Query(default=None, description="Filter by endpoint ID"),
):
    if q:
        # Validate the query by parsing it — returns 400 on syntax error
        try:
            from app.hunt.parser import parse_hql  # noqa: PLC0415
            parse_hql(q)
        except ValueError as exc:
            body = ErrorResponse(
                error_code="INVALID_QUERY",
                message="HQL syntax error",
                detail=str(exc),
            )
            return JSONResponse(status_code=400, content=body.model_dump())

    t0 = time.perf_counter()
    try:
        result = await store.hunt_events(
            query=q,
            from_time=from_,
            to_time=to,
            limit=limit,
            agg_field=agg,
            timeline=timeline,
            endpoint_id=endpoint_id,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=ErrorResponse(
                error_code="STORAGE_UNAVAILABLE",
                message=str(exc),
                hint="Set CLICKHOUSE_DSN to a reachable ClickHouse instance and restart the API.",
            ).model_dump(),
        ) from exc
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    raw_events: list = result.get("events", [])
    search_events = [
        SearchEvent(
            id=ev.id,
            source=ev.source,
            event=ev.event,
            timestamp=ev.timestamp,
        )
        for ev in raw_events
    ]

    agg_buckets = [
        HuntAggBucket(value=a["value"], count=a["count"])
        for a in result.get("aggregations", [])
    ]

    tl_buckets = [
        TimelineBucket(ts=b["ts"], count=b["count"])
        for b in result.get("timeline", [])
    ]

    return HuntResponse(
        events=search_events,
        total=len(search_events),
        query_time_ms=elapsed_ms,
        aggregations=agg_buckets,
        timeline=tl_buckets,
        query=q or "",
    )
