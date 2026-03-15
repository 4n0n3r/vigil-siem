# Vigil — Agent Reference

Vigil is a CLI-first SIEM. You are the analyst. Vigil is the platform.
Read this file before issuing any Vigil CLI commands.

---

## Setup check

```
vigil status --output json
```

Healthy response: `api_status:"ok"`, `clickhouse_status:"ok"`, `postgres_status:"ok"`.
If `warnings` is non-empty or any status is not `"ok"`, report degraded state before proceeding.

---

## Global rules

- Always `--output json` when parsing output. Never parse table output.
- Errors go to **stderr** as `{"error_code":"...","message":"...","detail":"..."}`.
- Non-zero exit = error occurred.
- `VIGIL_API_URL` overrides default (`http://localhost:8001`).

---

## Command reference

| Command | Key flags | Key response fields |
|---|---|---|
| `vigil ingest` | `--source <s>` `--event '<json>'` | `id`, `status`, `alert_ids` |
| `vigil search` | `--query <s>` `--from` `--to` `--limit` | `events[]`, `total` |
| `vigil detections list` | `--enabled` `--severity` | `rules[]`, `total` |
| `vigil detections create` | `--file <yml>` `--severity` | `id`, `name`, `enabled` |
| `vigil detections enable <id>` | — | `id`, `enabled:true` |
| `vigil detections disable <id>` | — | `id`, `enabled:false` |
| `vigil detections delete <id>` | `--confirm` (**human required**) | `id`, `deleted:true` |
| `vigil alerts list` | `--status open\|ack` `--severity` `--limit` | `alerts[]`, `total` |
| `vigil alerts get <id>` | — | full alert + `event_snapshot` |
| `vigil alerts acknowledge <id>` | `--note <s>` | `id`, `status`, `acknowledged_at` |
| `vigil alerts visualize` | `--out <file>` `--serve` | `file`, `total_alerts` |
| `vigil forensic collect` | — | `ingested`, `counts{}` |
| `vigil agent start` | `--profile minimal\|standard\|full` | streaming (no JSON output) |

**Source prefixes:** `winlog:` `syslog:` `journald:` `file:` `forensic:`

**Sigma modifiers supported:** `contains` `startswith` `endswith` `re`

**Condition syntax:** `AND` `OR` `NOT` `1 of X*` `all of X*`

---

## Error codes

| error_code | Meaning |
|---|---|
| `CONNECTION_ERROR` | API unreachable — check `VIGIL_API_URL` |
| `MISSING_FLAG` | Required flag not provided |
| `INVALID_JSON` | `--event` is not valid JSON |
| `DB_NOT_CONNECTED` | PostgreSQL unavailable — detections/alerts need it |
| `NOT_FOUND` | Rule, alert, or approval does not exist |
| `CONFIRM_REQUIRED` | Destructive command needs `--confirm` (human must authorize) |
| `UNSUPPORTED_PLATFORM` | Feature not available on current OS |
| `FORENSIC_PLATFORM_ERROR` | Forensic collection requires Windows |
| `COMMAND_ERROR` | Unknown command or flag |

---

## Skills

Execute these playbooks when the matching trigger is given. Use `--output json` throughout.

### `triage`
**Trigger:** "what's happening?" / "triage the environment"
```bash
vigil status --output json
vigil alerts list --status open --output json
vigil alerts list --status open --severity critical --output json
vigil alerts list --status open --severity high --output json
```
Group results by severity. Report counts and rule names to the user.

---

### `investigate_alert <id>`
**Trigger:** specific alert ID or rule name given to investigate
```bash
vigil alerts get <id> --output json
# Extract event_snapshot.computer (host) and event_snapshot fields
vigil search --query "<hostname>" --limit 50 --output json
# Determine: true positive, false positive, or needs escalation
vigil alerts acknowledge <id> --note "<your findings>" --output json
```

---

### `hunt_brute_force`
**Trigger:** suspected password attacks / credential abuse
```bash
vigil search --query "4625" --limit 200 --output json
vigil search --query "4648" --limit 100 --output json
```
Group results by `event.event_data.IpAddress` and `event.event_data.TargetUserName`.
Report top sources and whether patterns suggest spray vs. targeted.

---

### `hunt_lateral_movement`
**Trigger:** suspected lateral movement / pivoting
```bash
vigil search --query "4648" --limit 200 --output json
vigil search --query "4624" --limit 200 --output json
```
Correlate SubjectUserName, TargetServerName, IpAddress across events.
Look for the same account authenticating to multiple hosts in a short window.

---

### `deploy_detection <file>`
**Trigger:** deploy a new Sigma rule
```bash
vigil detections create --file <file> --output json
# Note the returned id
vigil detections list --enabled true --output json
# Ingest a synthetic test event that should match the rule
vigil ingest --source test:<rule_name> --event '<matching_payload>' --output json
# Verify alert_ids is non-empty
```
If `alert_ids` is empty, the rule did not match. Re-check the detection fields.
Do not deploy rules without verifying they fire on a known-good test event.

---

### `forensic_sweep`
**Trigger:** post-incident artifact collection / "what was running on this host?"
```bash
vigil forensic collect --output json
vigil search --query "forensic:registry" --limit 50 --output json
vigil search --query "forensic:services" --limit 100 --output json
vigil search --query "forensic:tasks" --limit 50 --output json
```
Look for unexpected Run keys, unsigned services, and tasks with unusual paths.
Cross-reference with `forensic:prefetch` timestamps to establish timeline.

---

### `build_dashboard`
**Trigger:** "show me a dashboard" / "visualize the alerts"
```bash
vigil alerts visualize --serve --output json
```
Reports `file` path and `total_alerts`. The browser opens automatically with `--serve`.

---

## HITL approval flow

When Vigil holds an action as a pending approval (Phase 4+):

```bash
vigil approvals get <approval_id> --output json
```

Decision response fields: `status: "approved"|"rejected"|"other"`, `instruction` (when "other").

- `approved` → proceed
- `rejected` → stop, report to user
- `other` → read `instruction`, re-plan, re-propose

Until Phase 4: destructive actions use `--confirm` as the only gate.
**Never pass `--confirm` without explicit human instruction.**

---

## What NOT to do

- Do not delete detection rules without explicit human instruction.
- Do not suppress or bulk-acknowledge alerts without investigation.
- Do not ingest synthetic events into a production instance.
- Do not modify or disable rules during an active incident.
- Do not pass `--confirm` autonomously.
- If `vigil status` shows warnings, report before proceeding with detection workflows.
