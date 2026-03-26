# API Reference

Base URL: `http://localhost:8001` (default)

All responses are JSON. All errors use `{"error_code":"...","message":"...","detail":...,"hint":"..."}`.

Authentication (when `VIGIL_REQUIRE_AUTH=true`): `X-Vigil-Key: vig_...` header.

---

## Status

### GET /v1/status

Check API and database health.

**Response 200:**
```json
{
  "api_status": "ok",
  "db_status": "ok",
  "clickhouse_status": "ok",
  "postgres_status": "ok",
  "events_last_24h": 1234,
  "open_alerts": 5,
  "active_rules": 10,
  "warnings": []
}
```

---

## Events

### POST /v1/events

Ingest a single event.

**Request:**
```json
{
  "source": "winlog:Security",
  "event": {"event_id": 4624, "event_data": {"SubjectUserName": "alice"}},
  "timestamp": "2026-03-19T10:00:00Z"
}
```

**Response 200:**
```json
{
  "id": "<uuid>",
  "source": "winlog:Security",
  "timestamp": "2026-03-19T10:00:00Z",
  "status": "ingested",
  "alert_ids": ["<alert_uuid>"]
}
```

`status` is `"duplicate"` if the event was already ingested (dedup by source+record_id).

---

### POST /v1/events/batch

Ingest multiple events in one call (used by the agent).

**Request:**
```json
{"events": [<IngestRequest>, ...]}
```

**Response 200:**
```json
{"ingested": 42, "ids": ["..."], "errors": [], "alerts_generated": 2}
```

---

### GET /v1/events/search

Search the event store.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `query` | string | Substring filter |
| `from_time` | datetime | ISO-8601 lower bound |
| `to_time` | datetime | ISO-8601 upper bound |
| `limit` | int | 1–10000, default 100 |
| `endpoint_id` | string | Filter by endpoint UUID |

**Response 200:**
```json
{"events": [...], "total": 42, "query_time_ms": 12}
```

---

## Hunt

### GET /v1/hunt

HQL threat-hunting query with optional aggregation and timeline.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `q` | string | HQL query |
| `from` | datetime | Lower bound |
| `to` | datetime | Upper bound |
| `limit` | int | 1–1000, default 100 |
| `agg` | string | Dotted field path to aggregate on |
| `timeline` | bool | Include hourly buckets |
| `endpoint_id` | string | Filter by endpoint UUID |

**Response 200:**
```json
{
  "events": [...],
  "total": 10,
  "query_time_ms": 8,
  "aggregations": [{"value": "10.0.0.1", "count": 42}],
  "timeline": [{"ts": "2026-03-19T10:00:00Z", "count": 5}],
  "query": "event_id:4625"
}
```

---

## Detections

### POST /v1/detections

Create a Sigma detection rule.

**Request:**
```json
{
  "name": "Brute Force",
  "description": "Multiple failed logons",
  "severity": "high",
  "mitre_tactic": "credential_access",
  "sigma_yaml": "...",
  "enabled": true
}
```

**Response 201:** `DetectionRule` object.

---

### GET /v1/detections

List rules. Query params: `enabled` (bool), `severity`, `limit`, `offset`.

**Response 200:** `{"rules": [...], "total": N}`

---

### GET /v1/detections/{rule_id}

Get a single rule.

---

### PATCH /v1/detections/{rule_id}

Partial update. All fields optional.

---

### DELETE /v1/detections/{rule_id}

Delete a rule. **Response 204.**

---

## Alerts

### GET /v1/alerts

List alerts. Query params: `status`, `severity`, `rule_id`, `endpoint_id`, `from_time`, `to_time`, `limit`, `offset`.

**Response 200:** `{"alerts": [...], "total": N}`

---

### GET /v1/alerts/{alert_id}

Get a single alert.

---

### POST /v1/alerts/{alert_id}/acknowledge

Acknowledge an alert.

**Request:** `{"note": "Investigated, false positive"}`

**Response 200:** `{"id": "...", "status": "acknowledged", "acknowledged_at": "...", "note": "..."}`

---

### POST /v1/alerts/batch

Bulk acknowledge/suppress/resolve.

**Request:**
```json
{
  "ids": ["<uuid>", ...],
  "action": "acknowledge",
  "note": "bulk ack"
}
```

Or filter-based:
```json
{
  "status_filter": "open",
  "severity_filter": "low",
  "action": "suppress"
}
```

**Response 200:** `{"updated": N, "ids": [...], "action": "acknowledge", "errors": []}`

---

## Endpoints

### POST /v1/endpoints/register

Register a new endpoint. **Public — no API key required.**

**Request:**
```json
{"name": "MY-BOX", "hostname": "my-box.corp", "os": "windows", "metadata": {}}
```

**Response 201:**
```json
{"id": "<uuid>", "name": "MY-BOX", "api_key": "vig_...", "created_at": "..."}
```

The `api_key` is returned **once only**.

---

### GET /v1/endpoints

List all endpoints. Query params: `limit`, `offset`.

**Response 200:** `{"endpoints": [...], "total": N}`

---

### GET /v1/endpoints/{id}

Get a single endpoint (without `api_key`).

---

### PATCH /v1/endpoints/{id}/heartbeat

Update `last_seen` to now. Called automatically by the agent on each batch flush.

**Response 200:** `{"id": "...", "last_seen": "..."}`

---

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `DB_NOT_CONNECTED` | 503 | PostgreSQL pool is not available |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 422 | Request body failed schema validation |
| `UNAUTHORIZED` | 401 | Missing API key (auth enabled) |
| `FORBIDDEN` | 403 | Invalid API key (auth enabled) |
| `INVALID_QUERY` | 400 | HQL syntax error |
| `REGISTER_ERROR` | 500 | Endpoint registration failed |
| `BATCH_NO_TARGET` | 422 | No IDs and no filter provided for batch operation |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
