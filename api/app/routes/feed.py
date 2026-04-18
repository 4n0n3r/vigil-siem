"""
Unified alert feed routes.

GET /v1/feed/alerts                             pull alerts from all enabled connectors
GET /v1/feed/context?connector=<id>&alert=<id>  raw log context for a specific alert
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.connectors import get_connector
from app.connectors.base import RawAlertData
from app.db import pg_connectors
from app.models import (
    ErrorResponse,
    FeedAlert,
    FeedAlertsResponse,
    FeedContextResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/feed", tags=["feed"])


def _alert_to_model(alert: RawAlertData, connector_id: str, connector_name: str, siem_type: str) -> FeedAlert:
    return FeedAlert(
        connector_id=connector_id,
        connector_name=connector_name,
        source_siem=siem_type,
        native_id=alert.native_id,
        severity=alert.severity,
        title=alert.title,
        hostname=alert.hostname,
        source_ip=alert.source_ip,
        detected_at=alert.detected_at,
        raw=alert.raw,
    )


@router.get("/alerts", response_model=FeedAlertsResponse)
async def feed_alerts(
    since_minutes: int = Query(default=60, ge=1, le=10080, description="Alerts from the last N minutes"),
    severity: str = Query(default="", description="Filter by severity: critical/high/medium/low"),
    limit: int = Query(default=50, ge=1, le=500),
):
    rows = await pg_connectors.list_connectors()
    enabled = [r for r in rows if r.get("enabled", True)]

    if not enabled:
        return FeedAlertsResponse(alerts=[], total=0, connectors_queried=0, errors=[])

    since = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)

    async def fetch_one(row: dict) -> tuple[list[FeedAlert], str | None]:
        try:
            conn = get_connector(row)
            raw_alerts = await conn.fetch_alerts(since=since, limit=limit)
            models = [
                _alert_to_model(a, str(row["id"]), row["name"], row["siem_type"])
                for a in raw_alerts
            ]
            await pg_connectors.update_connector_status(str(row["id"]), error=None)
            return models, None
        except Exception as exc:  # noqa: BLE001
            err = f"{row['name']}: {exc}"
            logger.warning("Connector fetch failed: %s", err)
            await pg_connectors.update_connector_status(str(row["id"]), error=str(exc))
            return [], err

    results = await asyncio.gather(*[fetch_one(r) for r in enabled])

    all_alerts: list[FeedAlert] = []
    errors: list[str] = []
    for alerts, err in results:
        all_alerts.extend(alerts)
        if err:
            errors.append(err)

    # Sort by detected_at descending across all connectors
    all_alerts.sort(key=lambda a: a.detected_at, reverse=True)

    # Apply severity filter
    if severity:
        all_alerts = [a for a in all_alerts if a.severity == severity]

    # Apply global limit
    all_alerts = all_alerts[:limit]

    return FeedAlertsResponse(
        alerts=all_alerts,
        total=len(all_alerts),
        connectors_queried=len(enabled),
        errors=errors,
    )


@router.get("/context", response_model=FeedContextResponse)
async def feed_context(
    connector: str = Query(..., description="Connector ID (UUID)"),
    alert: str = Query(..., description="Native alert ID from the SIEM"),
    window: int = Query(default=10, ge=1, le=120, description="Context window in minutes"),
):
    try:
        row = await pg_connectors.get_connector(connector)
    except Exception:
        row = None
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error_code="CONNECTOR_NOT_FOUND",
                message=f"No connector with id {connector!r}",
            ).model_dump(),
        )

    # Re-fetch the alert so we have its metadata for context queries
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    conn = get_connector(row)
    try:
        raw_alerts = await conn.fetch_alerts(since=since, limit=500)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=ErrorResponse(
                error_code="CONNECTOR_FETCH_ERROR",
                message=f"Failed to fetch alerts from connector: {exc}",
            ).model_dump(),
        ) from exc

    alert_data = next((a for a in raw_alerts if a.native_id == alert), None)
    if not alert_data:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error_code="ALERT_NOT_FOUND",
                message=f"Alert {alert!r} not found in connector {row['name']!r} (last 24h)",
                hint="The alert may be older than 24h or may have been deleted from the SIEM",
            ).model_dump(),
        )

    try:
        events = await conn.fetch_context(alert_data, window_minutes=window)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=ErrorResponse(
                error_code="CONNECTOR_CONTEXT_ERROR",
                message=f"Failed to fetch context: {exc}",
            ).model_dump(),
        ) from exc

    alert_model = _alert_to_model(
        alert_data, str(row["id"]), row["name"], row["siem_type"]
    )
    return FeedContextResponse(
        alert=alert_model,
        events=events,
        total_events=len(events),
        window_minutes=window,
    )
