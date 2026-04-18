from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
import uuid

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Error response — used by the global exception handler
# ---------------------------------------------------------------------------

class ErrorResponse(BaseModel):
    error_code: str
    message: str
    detail: Any = None
    hint: str = ""


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
    alert_ids: list[str] = []


# ---------------------------------------------------------------------------
# GET /v1/events/search
# ---------------------------------------------------------------------------

class StoredEvent(BaseModel):
    """Internal representation kept in the in-memory store."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source: str
    event: dict[str, Any]
    timestamp: datetime
    endpoint_id: str = ""


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
    clickhouse_status: str = "not_connected"
    postgres_status: str = "not_connected"
    open_alerts: int = 0
    active_rules: int = 0
    warnings: list[str] = []


# ---------------------------------------------------------------------------
# POST /v1/events/batch
# ---------------------------------------------------------------------------

class BatchIngestRequest(BaseModel):
    events: list[IngestRequest]


class BatchIngestResponse(BaseModel):
    ingested: int
    ids: list[str]
    errors: list[str]
    alerts_generated: int = 0


# ---------------------------------------------------------------------------
# Detection rules
# ---------------------------------------------------------------------------

class DetectionRuleCreate(BaseModel):
    name: str
    description: str = ""
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    mitre_tactic: str = ""
    sigma_yaml: str
    enabled: bool = True


class DetectionRuleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    severity: Literal["low", "medium", "high", "critical"] | None = None
    mitre_tactic: str | None = None
    sigma_yaml: str | None = None
    enabled: bool | None = None


class DetectionRule(BaseModel):
    id: str
    name: str
    description: str
    severity: str
    mitre_tactic: str
    sigma_yaml: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class DetectionListResponse(BaseModel):
    rules: list[DetectionRule]
    total: int


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

class Alert(BaseModel):
    id: str
    rule_id: str
    rule_name: str
    event_id: str
    severity: str
    status: str
    matched_at: datetime
    acknowledged_at: datetime | None = None
    note: str | None = None
    event_snapshot: dict
    endpoint_id: str | None = None


class AlertListResponse(BaseModel):
    alerts: list[Alert]
    total: int


class AlertAcknowledgeRequest(BaseModel):
    note: str | None = None


class AlertAcknowledgeResponse(BaseModel):
    id: str
    status: str
    acknowledged_at: datetime
    note: str | None = None


# ---------------------------------------------------------------------------
# Batch alert operations
# ---------------------------------------------------------------------------

class AlertBatchRequest(BaseModel):
    ids: list[str] = []
    status_filter: str | None = None
    severity_filter: str | None = None
    action: Literal["acknowledge", "suppress", "resolve"]
    note: str | None = None


class AlertBatchResponse(BaseModel):
    updated: int
    ids: list[str]
    action: str
    errors: list[str] = []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class EndpointRegisterRequest(BaseModel):
    name: str
    hostname: str = ""
    os: str = ""
    metadata: dict[str, Any] = {}
    enroll_token: str = ""  # required when VIGIL_REQUIRE_AUTH=true


class EndpointRegisterResponse(BaseModel):
    id: str
    name: str
    api_key: str  # returned ONCE — caller must save it
    created_at: datetime


class Endpoint(BaseModel):
    id: str
    name: str
    hostname: str
    os: str
    last_seen: datetime | None = None
    created_at: datetime
    metadata: dict[str, Any]


class EndpointListResponse(BaseModel):
    endpoints: list[Endpoint]
    total: int


class EndpointHeartbeatResponse(BaseModel):
    id: str
    last_seen: datetime


# ---------------------------------------------------------------------------
# Enrollment tokens
# ---------------------------------------------------------------------------

class EnrollmentTokenCreate(BaseModel):
    label: str = ""
    single_use: bool = True
    expires_hours: int | None = 24  # None or 0 = no expiry


class EnrollmentToken(BaseModel):
    id: str
    label: str
    single_use: bool
    used: bool
    expires_at: datetime | None = None
    created_at: datetime


class EnrollmentTokenCreatedResponse(BaseModel):
    id: str
    label: str
    token: str  # plaintext — returned once, never stored
    single_use: bool
    expires_at: datetime | None = None
    created_at: datetime


class EnrollmentTokenListResponse(BaseModel):
    tokens: list[EnrollmentToken]
    total: int


# ---------------------------------------------------------------------------
# Hunt
# ---------------------------------------------------------------------------

class TimelineBucket(BaseModel):
    ts: datetime
    count: int


class HuntAggBucket(BaseModel):
    value: str
    count: int


class HuntResponse(BaseModel):
    events: list[SearchEvent]
    total: int
    query_time_ms: int
    aggregations: list[HuntAggBucket] = []
    timeline: list[TimelineBucket] = []
    query: str
