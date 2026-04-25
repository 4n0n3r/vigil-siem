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

**Phase 2 — complete.**
- ClickHouse Cloud event storage (MergeTree, monthly partitions)
- PostgreSQL for detection rules + alerts
- Sigma rule evaluation on every ingest
- `vigil detections` command group
- `vigil alerts` command group

**Phase 3 — complete.**
- `vigil forensic collect` — point-in-time artifact sweep (Windows)
- Linux agent: journald + syslog collectors
- `--profile minimal|standard|full` for `vigil agent start`
- 10 Sigma detection rules across 6 MITRE tactics
- `vigil alerts visualize` — self-contained HTML dashboard

**Phase 5 — complete.**
- `LICENSE` (Apache 2.0), `README.md`, `CONTRIBUTING.md`
- `vigil config get/set` — persistent config file (`~/.config/vigil/config.yaml`)
- Config file resolution: flag > env > config > default
- `vigil doctor` — 5-check connectivity + config diagnostic
- `vigil web start` PORT_IN_USE error with hint
- Error hints: `hint` field on all `ErrorResponse` and `APIError`
- Multi-endpoint backend: `endpoints` table, per-key auth cache
- `VIGIL_REQUIRE_AUTH` env var for optional auth enforcement
- `vigil agent register` — register endpoint, save api_key + endpoint_id to config
- `vigil endpoints list/get`
- `--endpoint <id>` filter on `vigil search` and `vigil hunt`
- `endpoint_id` column in ClickHouse `vigil_events`
- `endpoint_id` FK on `alerts` table (migration 004)
- Skill files: `skills/triage.md`, `skills/investigate.md`, `skills/detect.md`, `skills/forensic.md`
- Docs: `docs/installation.md`, `docs/configuration.md`, `docs/multi-endpoint.md`, `docs/detections.md`, `docs/api-reference.md`

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
VIGIL_API_URL        Base URL of the Vigil API (default: http://localhost:8001)
VIGIL_API_KEY        API key for authenticated deployments (CLI/agent)
VIGIL_REQUIRE_AUTH   Set "true" to require X-Vigil-Key on all API endpoints (default: false)
CLICKHOUSE_DSN       ClickHouse Cloud connection string (Phase 2)
POSTGRES_DSN         PostgreSQL connection string (Phase 2)
```

## Config file (Phase 5)

The CLI stores persistent settings at:
- Windows: `%APPDATA%\vigil\config.yaml`
- Linux/macOS: `~/.config/vigil/config.yaml`

Resolution order (highest to lowest priority):
1. CLI flag (`--api-url`)
2. Environment variable (`VIGIL_API_URL`, `VIGIL_API_KEY`)
3. Config file value
4. Built-in default

Manage with: `vigil config get [key]` and `vigil config set <key> <value>`.

Valid keys: `api_url`, `api_key`, `endpoint_id`, `endpoint_name`.

## Error codes (Phase 5 additions)

| Code | Meaning |
|---|---|
| `CONFIG_LOAD_ERROR` | Failed to read or parse the config file |
| `CONFIG_SAVE_ERROR` | Failed to write the config file |
| `CONFIG_UNKNOWN_KEY` | Key not in the valid set |
| `PORT_IN_USE` | Requested port is already bound by another process |
| `WEB_START_ERROR` | Failed to start the web server (non-port error) |
| `UNAUTHORIZED` | Missing `X-Vigil-Key` header (auth enabled) |
| `FORBIDDEN` | Invalid or unknown `X-Vigil-Key` (auth enabled) |
| `REGISTER_ERROR` | Endpoint registration failed (DB error) |

All `ErrorResponse` objects now include an optional `hint` field with actionable
remediation text. CLI's `PrintErrorWithHint` propagates this to stderr.

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

## Vigil Forensic

`vigil forensic collect` is a **one-shot** artifact sweep — distinct from `vigil agent`'s
continuous stream. Use it when you want a point-in-time snapshot before or after an incident.

**Artifacts collected (Windows, requires admin):**
| Source prefix | Artifact |
|---|---|
| `forensic:prefetch` | Prefetch file metadata (name, size, mtime) from `C:\Windows\Prefetch` |
| `forensic:registry` | Run/RunOnce keys from HKLM and HKCU |
| `forensic:services` | All services from the SCM (name, binary, start type) |
| `forensic:tasks` | Scheduled task entries from the registry TaskCache |
| `forensic:shimcache` | AppCompatCache raw bytes (hex-encoded) for offline parsing |

Results are ingested as events into the SIEM. Search with `vigil search --query forensic:`.

---

## Agent Profiles

`vigil agent start --profile <name>` selects a preset collector configuration:

| Profile | Windows channels | Linux collectors |
|---|---|---|
| `minimal` | Security only | journald only |
| `standard` (default) | Security, System, Application, Sysmon, PowerShell | journald + auth.log |
| `full` | + WMI, TaskScheduler, Defender, BITS | + syslog |

Override the channel list on Windows with `--channels ch1,ch2,...` (takes precedence over profile).

---

## Skills

Named investigation playbooks that AI agents should internalize. An agent given a task
should identify the appropriate skill and execute the steps in order.

| Skill | Trigger | Steps |
|---|---|---|
| `triage` | "what's happening?" | `vigil alerts list --severity high --output json`, group by severity |
| `investigate_alert <id>` | alert ID given | `vigil alerts get <id> --output json` → search event context → `acknowledge` with note |
| `hunt_brute_force` | credential attacks suspected | `vigil hunt --query "event_id:4625" --agg event_data.IpAddress --output json` |
| `hunt_lateral_movement` | lateral spread suspected | `vigil hunt --query "event_id:4648" --agg event_data.TargetServerName --output json` |
| `deploy_detection <file>` | new Sigma rule to deploy | `vigil detections create --file <rule.yaml> --output json` → ingest test event → verify `alert_ids` non-empty |
| `forensic_sweep` | post-incident artifact grab | `vigil forensic collect --output json` → `vigil search --query "forensic:" --output json` |
| `build_dashboard` | reporting requested | `vigil alerts visualize --serve` |

Each skill maps to a defined sequence of CLI commands with `--output json` throughout.
Agents must not deviate from skills without explicit instruction.

---

## HITL approval flow (Phase 2+)
AI agent proposes an action → Vigil holds it as a pending approval →
notification sent to human's preferred channel (Slack / Teams / email / PagerDuty) →
human responds Yes / No / Other (with instruction text) →
Vigil returns decision as structured JSON to the polling agent.

The `Other` response carries a machine-readable instruction so the agent can re-plan.
The web UI (Next.js) is the primary surface for approvals.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%)
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->

---

## Coding Behavior Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.