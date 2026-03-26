# Contributing to Vigil

## Architecture overview

```
vigility/
├── cli/        Go CLI binary (Cobra). The only thing users/agents install.
├── api/        Python FastAPI backend. All business logic lives here.
├── web/        Next.js frontend. HITL approvals and dashboards only.
├── infra/      Terraform. AWS ECS Fargate + RDS + S3.
├── detections/ Sigma rule YAML files. Organized by MITRE tactic.
└── docs/       User-facing documentation.
```

The CLI is a thin HTTP client — it calls the API and formats responses. All logic (storage, detection, alerting) lives in the API.

---

## How to add a Collector (new log source)

Every log source implements the `Collector` interface in `cli/internal/agent/`:

```go
type Collector interface {
    Name() string
    Start(ctx context.Context) (<-chan Event, error)
    SaveBookmark(path string) error
}
```

**Steps:**

1. Create `cli/internal/agent/collector_<source>_<platform>.go` with a `//go:build <platform>` tag on line 1.
2. Create `cli/internal/agent/collector_<source>_stub.go` with `//go:build !<platform>` — returns `ErrNotSupported`.
3. Wire it in `cli/cmd/agent_<platform>.go` inside `addPlatformCollectors()`.
4. Emit `agent.Event` structs with `Source`, `Event` (map), `Timestamp`.
5. Never panic — log errors to stderr as `{"error_code":"...","message":"..."}`.

Source prefix conventions: `winlog:`, `journald:`, `syslog:`, `file:`, `forensic:`.

---

## How to add an API route

1. Add Pydantic request/response models to `api/app/models.py`.
2. Create or extend a router file in `api/app/routes/`.
3. Register the router in `api/app/main.py` with `app.include_router(...)`.
4. Add a PostgreSQL migration if new tables/columns are needed (`api/app/db/migrations/NNN_<name>.sql`).

**Rules:**
- Every response must be a Pydantic model. No raw dicts.
- Every error must use `ErrorResponse` with a non-empty `error_code`.
- Add `DB_NOT_CONNECTED` (503) guard at the top of any endpoint that uses PostgreSQL.

---

## How to add a migration

1. Create `api/app/db/migrations/NNN_<description>.sql` (increment NNN).
2. Use `IF NOT EXISTS` / `IF EXISTS` guards so migrations are idempotent.
3. Test locally: `psql $POSTGRES_DSN < api/app/db/migrations/NNN_<description>.sql`.

Migrations run in filename order on every API startup (`postgres.init_postgres()`).

---

## Code conventions

### CLI (Go)
- Every command must accept `--output [json|table]`. Default is `table`.
- Use `output.PrintError(code, msg, detail)` — never `fmt.Fprintf(os.Stderr, ...)` directly.
- Use `output.PrintErrorFromErr(err)` when the error comes from `apiClient`.
- The binary must compile to a single static binary: no CGo, no dynamic libs.
- New dependencies must be pure-Go (no CGo) to preserve static binary compatibility.

### API (Python)
- All errors: `ErrorResponse(error_code=..., message=..., detail=...)`.
- `error_code` values: SCREAMING_SNAKE_CASE, e.g. `DB_NOT_CONNECTED`.
- Use `asyncio.to_thread()` for CPU-bound or synchronous IO work.
- New environment variables must be documented in `api/.env.example`.

### Sigma rules
- Place under `detections/<mitre_tactic>/`.
- Test via: `vigil detections create --file rule.yaml` then `vigil ingest` with a matching synthetic event and verify `alert_ids` is non-empty.

---

## PR checklist

- [ ] `vigil doctor --output json` returns all checks passing
- [ ] `cd cli && make build` succeeds (zero CGo)
- [ ] New CLI commands have `--output json` that returns valid JSON
- [ ] New API endpoints return `ErrorResponse` for all error paths
- [ ] New env vars added to `api/.env.example`
- [ ] Migrations are idempotent (safe to run twice)
- [ ] `CLAUDE.md` updated if architecture or phases changed
