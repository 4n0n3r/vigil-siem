# Vigil — CLAUDE.md

## What this is
Vigil is a CLI-first SIEM built for AI agents (Claude Code, Codex, and similar).
The CLI is written in Go. The backend API is Python/FastAPI. The web UI is Next.js.

AI agents are the primary consumers of this system — they ingest events, run
searches, propose detections, and act on findings. Humans stay in the loop via
HITL approval flows (Slack / Teams / email → Yes / No / Other → agent resumes).

Every CLI command MUST return structured JSON when `--output json` is passed.
This is non-negotiable — AI agents depend on it.

## Repo structure
- `cli/`        Go CLI binary (Cobra). Single static binary. Users and agents install this.
- `api/`        Python FastAPI backend. Single source of truth for all logic.
- `web/`        Next.js frontend. HITL approvals + dashboards only. (Phase 2+)
- `infra/`      Terraform. AWS only (ECS Fargate, RDS, S3, ALB).
- `detections/` Sigma rule YAML files. Organized by MITRE tactic.
- `scripts/`    Dev tooling, seed scripts, local setup.

## Non-negotiables
1. Every CLI command accepts `--output [json|table]`. Default is table for humans.
2. Every API response is a Pydantic model. No raw dicts returned from endpoints.
3. Every destructive action (delete, suppress, bulk ops) requires HITL approval.
   The CLI must block and poll until approved or rejected.
4. All errors return structured JSON with an `error_code` field. No freeform strings.
5. The CLI binary must compile to a single static binary with no external deps.
6. The `vigil agent` binary is the only thing that needs to run on an endpoint.
   No separate installer, no config file required for basic operation.

## Current phase
**Phase 1 — complete.**
- `vigil ingest` — POST a single event to the API
- `vigil search` — query the event store
- `vigil status` — API + DB health
- `vigil agent` — Windows Event Log collection daemon (install as Windows Service)
- API skeleton — in-memory store, all Pydantic models, batch ingest endpoint

**Next: Phase 2 — Wire real storage + detection engine.**
- Replace in-memory store with ClickHouse Cloud
- Wire PostgreSQL for config/state
- Sigma rule evaluation on ingest
- `vigil detections` command group

## Stack decisions (do not change without asking)
- CLI: Go + Cobra
- API: Python 3.12 + FastAPI + Pydantic v2
- Event DB: ClickHouse Cloud (connection string in .env)
- Config DB: PostgreSQL (connection string in .env)
- Infra: AWS ECS Fargate + RDS + S3
- Billing: Stripe (phase 3)

## How to run locally

**API:**
```bash
cd api
pip install -r requirements.txt
make dev          # uvicorn --reload on :8001
# or: docker-compose up
```

**CLI (build from source):**
```bash
cd cli
make build        # output: cli/bin/vigil (or vigil.exe on Windows)
make install      # copies to /usr/local/bin
```

**Agent (Windows only, run as admin):**
```bash
vigil agent start                   # foreground, Ctrl+C to stop
vigil agent install                 # register as Windows Service (auto-start)
vigil agent status                  # show live stats
vigil agent uninstall               # remove the service
```

## Environment variables
```
VIGIL_API_URL      Base URL of the Vigil API (default: http://localhost:8001)
CLICKHOUSE_DSN     ClickHouse Cloud connection string (Phase 2)
POSTGRES_DSN       PostgreSQL connection string (Phase 2)
```

---

## How to add a new collector

Every log source is a **Collector** — a Go struct that implements this interface
in `cli/internal/agent/`:

```go
type Collector interface {
    Name() string
    Start(ctx context.Context) (<-chan Event, error)
    SaveBookmark(path string) error
}
```

**Rules:**
- One file per platform/source, with a build tag on line 1.
- Always pair a real implementation with a stub for other platforms.
- `Start` must close the returned channel when `ctx` is cancelled.
- `SaveBookmark` may be a no-op (`return nil`) if the source has no resume state.
- Emit `agent.Event` structs — `Source`, `Event` (map), `Timestamp`.
- Never panic. Log errors via stderr as `{"error_code":"...","message":"..."}`.

### File naming convention
```
collector_<source>_<platform>.go     //go:build <platform>
collector_<source>_stub.go           //go:build !<platform>
```

### Example: adding a macOS collector
```
cli/internal/agent/
  collector_unifiedlog_darwin.go     //go:build darwin
  collector_unifiedlog_stub.go       //go:build !darwin
```

### Wire it up
In `cmd/agent.go`, inside the `start` command's `RunE`, add:
```go
a.AddCollector(agent.NewUnifiedLogCollector(cfg))
```
Wrap in a build-tag-guarded helper if it's platform-specific.

### Event shape
```json
{
  "source": "<prefix>:<channel>",
  "event": {
    "event_id": 4624,
    "channel": "Security",
    "computer": "HOSTNAME",
    "record_id": 12345,
    "event_data": { "SubjectUserName": "SYSTEM" }
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```
Use `source` prefixes: `winlog:`, `unifiedlog:`, `syslog:`, `journald:`, `file:`.

### Batch flush
The agent core (`agent.go`) handles all batching and flushing to
`POST /v1/events/batch`. Collectors just emit events on a channel.
Default: flush every 5s or 100 events, whichever comes first.

---

## HITL approval flow (Phase 2+)
AI agent proposes an action → Vigil holds it as a pending approval →
notification sent to human's preferred channel (Slack / Teams / email / PagerDuty) →
human responds Yes / No / Other (with instruction text) →
Vigil returns decision as structured JSON to the polling agent.

The `Other` response carries a machine-readable instruction so the agent can re-plan.
The web UI (Next.js) is the primary surface for approvals.
