# Vigil — Agent Usage Guide

This file is for AI agents (Claude Code, Codex, and similar) using Vigil as a security operations tool.
Read this before issuing any Vigil CLI commands.

---

## What Vigil is

Vigil is a CLI-first SIEM. You use the `vigil` binary to ingest events, search logs,
manage detection rules, and respond to alerts. Humans stay in the loop via HITL approval
flows — you propose actions, humans approve or steer, you continue.

You are the analyst. Vigil is the platform.

---

## Setup check

Before doing anything, verify the API is reachable:

```
vigil status --output json
```

Expected healthy response:
```json
{
  "api_status": "ok",
  "clickhouse_status": "ok",
  "postgres_status": "ok",
  "events_last_24h": 0,
  "open_alerts": 0,
  "active_rules": 0,
  "warnings": []
}
```

If `warnings` is non-empty, the system is degraded. Ingest still works; detections and alerts
require `postgres_status: "ok"`. Stop and report degraded state to the user before proceeding
with detection or alert workflows.

---

## Global rules

- Always pass `--output json` when you need to parse output. Table output is for humans.
- All errors go to **stderr** as `{"error_code": "...", "message": "...", "detail": "..."}`.
  A non-zero exit code always means an error occurred.
- Never parse table output. It is not a stable interface.
- `VIGIL_API_URL` overrides the default API endpoint (`http://localhost:8001`).
  Use `--api-url` per-command if needed.

---

## Commands reference

### vigil ingest

Send a single event to the SIEM.

```
vigil ingest --source <source> --event '<json>' --output json
```

- `--source`: a string identifier for the log source. Use prefixes:
  `winlog:Security`, `winlog:Sysmon`, `syslog:auth`, `file:auth.log`, etc.
- `--event`: a valid JSON object. Any shape is accepted.

Response:
```json
{
  "id": "uuid",
  "source": "winlog:Security",
  "timestamp": "2024-01-15T10:30:00Z",
  "status": "ingested",
  "alert_ids": ["uuid"]
}
```

`alert_ids` is non-empty when a Sigma rule matched this event. Treat any non-empty
`alert_ids` as a signal to review the alert immediately.

---

### vigil search

Query ingested events.

```
vigil search --query <string> --from <RFC3339> --to <RFC3339> --limit <int> --output json
```

All flags are optional. Without `--query`, returns recent events up to `--limit`.

Response:
```json
{
  "events": [
    {
      "id": "uuid",
      "timestamp": "...",
      "source": "winlog:Security",
      "event_type": "",
      "summary": "",
      "event": { ... }
    }
  ],
  "total": 1,
  "query_time_ms": 2
}
```

---

### vigil detections list

List active detection rules.

```
vigil detections list --output json
vigil detections list --enabled true --severity high --output json
```

Response:
```json
{
  "rules": [
    {
      "id": "uuid",
      "name": "Suspicious PowerShell",
      "severity": "high",
      "mitre_tactic": "execution",
      "enabled": true,
      "created_at": "..."
    }
  ],
  "total": 1
}
```

---

### vigil detections create

Upload a Sigma rule YAML file.

```
vigil detections create --file ./path/to/rule.yml --output json
```

The YAML file must be a valid Sigma rule. The `title` field becomes the rule name.
Optionally override severity: `--severity high`.

Response:
```json
{
  "id": "uuid",
  "name": "Rule Title",
  "severity": "high",
  "enabled": true,
  ...
}
```

**Sigma rule format** (minimum viable):
```yaml
title: Suspicious Process Creation
status: experimental
description: Detects ...
logsource:
  product: windows
  service: security
detection:
  selection:
    event_id: 4688
    event_data.CommandLine|contains:
      - powershell
      - cmd.exe
  condition: selection
level: high
```

Supported detection modifiers: `contains`, `startswith`, `endswith`, `re`.
Supported condition syntax: `AND`, `OR`, `NOT`, `1 of <name>*`, `all of <name>*`.

---

### vigil detections enable / disable

```
vigil detections enable <id> --output json
vigil detections disable <id> --output json
```

---

### vigil detections delete

Destructive. Requires explicit confirmation flag.

```
vigil detections delete <id> --confirm --output json
```

Do not pass `--confirm` without human instruction to delete.

---

### vigil alerts list

```
vigil alerts list --output json
vigil alerts list --status open --severity high --output json
```

`--status` accepts: `open`, `acknowledged`, `suppressed`. Default: `open`.

Response:
```json
{
  "alerts": [
    {
      "id": "uuid",
      "rule_id": "uuid",
      "rule_name": "Suspicious PowerShell",
      "event_id": "uuid",
      "severity": "high",
      "status": "open",
      "matched_at": "2024-01-15T10:30:00Z",
      "event_snapshot": { ... }
    }
  ],
  "total": 1
}
```

---

### vigil alerts get

```
vigil alerts get <id> --output json
```

Returns the full alert including `event_snapshot` — the event payload at match time.

---

### vigil alerts acknowledge

```
vigil alerts acknowledge <id> --note "investigated, confirmed false positive" --output json
```

---

## HITL approval flow

When you propose a destructive or high-impact action, Vigil will hold the action as a
pending approval and notify the human via their configured channel (Slack, email, etc.).
You must poll until a decision is returned.

**Pending approval response shape:**
```json
{
  "approval_id": "uuid",
  "status": "pending",
  "action": "delete_rule",
  "payload": { ... }
}
```

**Poll:**
```
vigil approvals get <approval_id> --output json
```

**Decision response:**
```json
{
  "approval_id": "uuid",
  "status": "approved" | "rejected" | "other",
  "instruction": "scope to aws:us-east-1 only",
  "decided_at": "..."
}
```

- `approved` → proceed.
- `rejected` → stop, report back to the user.
- `other` → read `instruction`, re-plan, re-propose.

> Note: HITL approval endpoints are Phase 3. Until then, destructive actions use `--confirm`
> as the only gate.

---

## Common agent workflows

### Workflow: Investigate a host

```bash
# 1. Search for events from the host in the last hour
vigil search --query "HOSTNAME" --from $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) --output json

# 2. Check for open alerts related to that host
vigil alerts list --status open --output json
```

### Workflow: Create and deploy a detection

```bash
# 1. Write the Sigma rule to a temp file, then upload
vigil detections create --file /tmp/my_rule.yml --severity high --output json

# 2. Verify it's enabled
vigil detections list --enabled true --output json

# 3. Ingest a test event and confirm alert fires
vigil ingest --source test --event '{"event_id": 4688, "CommandLine": "powershell -enc ..."}' --output json
# alert_ids should be non-empty
```

### Workflow: Triage open alerts

```bash
# 1. List all open high-severity alerts
vigil alerts list --status open --severity high --output json

# 2. Inspect the event that triggered each alert
vigil alerts get <alert_id> --output json

# 3. Acknowledge with investigation note
vigil alerts acknowledge <alert_id> --note "confirmed benign — scheduled task" --output json
```

---

## Error codes reference

| error_code | Meaning |
|---|---|
| `CONNECTION_ERROR` | Cannot reach the Vigil API. Check `VIGIL_API_URL` and API status. |
| `MISSING_FLAG` | A required flag was not provided. |
| `INVALID_JSON` | The `--event` value is not valid JSON. |
| `DB_NOT_CONNECTED` | PostgreSQL is unavailable. Detections/alerts endpoints require it. |
| `NOT_FOUND` | The requested resource (rule, alert, approval) does not exist. |
| `CONFIRM_REQUIRED` | A destructive command requires `--confirm`. Do not add without human instruction. |
| `COMMAND_ERROR` | Unknown command or flag. |

---

## What NOT to do

- Do not delete detection rules without explicit human instruction.
- Do not suppress alerts without investigation.
- Do not ingest synthetic or fabricated events into a production instance.
- Do not modify or disable rules during an active incident.
- If `vigil status` shows warnings, report them before proceeding.
