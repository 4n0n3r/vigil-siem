# Vigil — Agent Reference

Vigil is a CLI-first SIEM. You are the analyst. Vigil is the platform.
Read this file before issuing any Vigil CLI commands.

---

## Setup check

```
vigil status --output json
```

Healthy response: `api_status:"ok"`, `clickhouse_status:"ok"`, `postgres_status:"ok"`.

- `clickhouse_status:"ok"` — events are persisted to ClickHouse. Self-hosted ClickHouse is included in the Docker stack (`docker-compose -f api/docker-compose.yml up -d`).
- `clickhouse_status:"degraded"` — ClickHouse unreachable; events stored in-memory only (lost on restart, capped at 50 000 events). Fix: check `CLICKHOUSE_DSN` and ensure the ClickHouse container is running.
- If `warnings` is non-empty or any status is not `"ok"`, report degraded state before proceeding.

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
| `vigil alerts batch` | `--action ack\|suppress\|resolve` `--ids` `--status` `--severity` `--confirm` | `updated`, `ids[]`, `action` |
| `vigil alerts visualize` | `--out <file>` `--serve` | `file`, `total_alerts` |
| `vigil forensic collect` | — | `ingested`, `counts{}` |
| `vigil agent start` | `--profile minimal\|standard\|full` `--bookmark-dir` | streaming (no JSON output) |
| `vigil web start` | `--port <n>` | `status`, `url`, `api_proxy` |
| `vigil hunt` | `--query <HQL>` `--agg <field>` `--timeline` `--from` `--to` `--limit` | `events[]`, `total`, `aggregations[]`, `timeline[]`, `query_time_ms` |

| `vigil cloud start` | `--provider aws\|azure\|gcp` `--region` `--bucket` `--subscription` `--storage-account` `--project` | `status`, `source`, `provider` |

**Source prefixes:** `winlog:` `syslog:` `journald:` `file:` `forensic:` `cloudtrail:` `azure:` `gcp:`

**Sigma modifiers supported:** `contains` `startswith` `endswith` `re`

**Condition syntax:** `AND` `OR` `NOT` `1 of X*` `all of X*`

**HQL syntax (hunt):** `field:value` `field:val*` `field:(v1 OR v2)` `NOT field:val` `AND`/`OR`/`NOT` `(grouping)` bare-text

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
| `BATCH_NO_TARGET` | `alerts batch` called with neither `--ids` nor any filter |
| `INVALID_QUERY` | HQL syntax error — check field names and operators |
| `UNSUPPORTED_PLATFORM` | Feature not available on current OS |
| `FORENSIC_PLATFORM_ERROR` | Forensic collection not supported on this platform |
| `CLOUD_NOT_COMPILED` | Binary not built with `-tags cloud`; run `make build-cloud` |
| `CLOUD_UNKNOWN_PROVIDER` | `--provider` value not one of: `aws`, `azure`, `gcp` |
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

### `hunt`
**Trigger:** "hunt for", "find all events where", "pivot on", "show me events with", "threat hunt", "look for credential abuse", "search for attacker"

The full hunt skill reference lives in `skills/hunt.md`. Key patterns:

```bash
# Brute-force — top source IPs for failed logons
vigil hunt --query "event_id:4625" --agg event_data.IpAddress --timeline --output json

# Lateral movement — explicit credential logons grouped by target host
vigil hunt --query "event_id:4648" --agg event_data.TargetServerName --output json

# Suspicious execution — living-off-the-land
vigil hunt --query "event_data.ProcessName:*mshta* OR event_data.ProcessName:*wscript*" --output json

# Encoded PowerShell
vigil hunt --query "event_data.CommandLine:*encodedcommand*" --limit 50 --output json

# Pivot on a hostname across all sources
vigil hunt --query "WORKSTATION-42" --timeline --output json

# Multi-value shorthand
vigil hunt --query "event_id:(4625 OR 4648 OR 4624)" --agg event_data.IpAddress --output json
```

**Response fields to analyse:**
- `aggregations` — top values sorted by count; `count > 20` for a single IP on event 4625 → spray
- `timeline` — hourly spike indicates brute-force window
- `events[].event.event_data` — extract `SubjectUserName`, `IpAddress`, `TargetServerName` for context

See `skills/hunt.md` for the full HQL syntax reference, all common field names, and complete hunt playbooks.

---

### `hunt_brute_force`
**Trigger:** suspected password attacks / credential abuse
```bash
vigil hunt --query "event_id:4625" --agg event_data.IpAddress --timeline --limit 200 --output json
vigil hunt --query "event_id:4648" --agg event_data.TargetUserName --output json
```
Group results by `aggregations[].value`. Count > 20 from a single IP → spray. Many distinct `TargetUserName` → spray. Single account many attempts → targeted.

---

### `hunt_lateral_movement`
**Trigger:** suspected lateral movement / pivoting
```bash
vigil hunt --query "event_id:4648" --agg event_data.TargetServerName --timeline --output json
vigil hunt --query "event_id:4624 AND event_data.LogonType:3" --agg event_data.IpAddress --output json
```
Correlate `aggregations[].value` (target servers) vs. timestamp. Same account on many distinct hosts in a short window → lateral movement. Look for `SubjectUserName` common across events.

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
**Trigger:** post-incident artifact collection / "what was running on this host?" (Windows)
```bash
vigil forensic collect --output json
vigil search --query "forensic:registry" --limit 50 --output json
vigil search --query "forensic:services" --limit 100 --output json
vigil search --query "forensic:tasks" --limit 50 --output json
```
Look for unexpected Run keys, unsigned services, and tasks with unusual paths.
Cross-reference with `forensic:prefetch` timestamps to establish timeline.

---

### `forensic_sweep_linux`
**Trigger:** post-incident artifact collection on Linux / "what was running?" / "what's installed?"
```bash
vigil forensic collect --output json
vigil search --query "forensic:cron" --limit 50 --output json
vigil search --query "forensic:services" --limit 100 --output json
vigil search --query "forensic:suid" --limit 50 --output json
vigil search --query "forensic:ssh_keys" --limit 50 --output json
vigil search --query "forensic:users" --limit 50 --output json
vigil search --query "forensic:bash_history" --limit 100 --output json
```
Look for: unexpected cron entries, unsigned services, unusual SUID binaries, unknown SSH keys,
accounts with UID 0 besides root, suspicious bash_history commands (curl/wget/base64).

---

### `build_dashboard`
**Trigger:** "show me a dashboard" / "visualize the alerts"
```bash
vigil alerts visualize --serve --output json
```
Reports `file` path and `total_alerts`. The browser opens automatically with `--serve`.

---

### `onboard_linux`
**Trigger:** "set up Linux agent", "add Linux host", "onboard Linux endpoint"
```bash
vigil status --output json                                   # confirm API reachable
vigil agent register --name <hostname> --output json         # save api_key + endpoint_id
vigil agent start --profile standard --output json           # verify events flow (Ctrl+C)
vigil search --query "journald:" --limit 5 --output json    # confirm events in SIEM
```
Profile guidance: `standard` for most servers (journald + auth.log + /var/log/secure),
`full` for complete coverage including auditd (requires root).

---

### `onboard_aws`
**Trigger:** "connect AWS", "add CloudTrail", "ingest CloudTrail"
```bash
# Prerequisites: VIGIL_API_URL set, AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY set
# Binary must be built with: make build-cloud
vigil status --output json
vigil cloud start --provider aws --region <region> --bucket <cloudtrail-bucket> --output json
# Wait ~2 minutes (S3 delivery lag)
vigil search --query "cloudtrail:" --limit 5 --output json  # verify events
```
IAM requirements: `s3:GetObject` + `s3:ListBucket` + `s3:GetBucketLocation` on the CloudTrail bucket.
See `docs/onboarding/aws.md` for the least-privilege IAM policy JSON.

---

### `onboard_azure`
**Trigger:** "connect Azure", "add Azure Activity Log", "ingest Azure"
```bash
# Prerequisites: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET set
# Binary must be built with: make build-cloud
vigil status --output json
vigil cloud start --provider azure \
  --subscription <subscription-id> \
  --storage-account <storage-account-name> \
  --container insights-activity-logs \
  --output json
vigil search --query "azure:activity" --limit 5 --output json
```

---

### `onboard_gcp`
**Trigger:** "connect GCP", "add GCP logging", "ingest GCP Cloud Logging"
```bash
# Prerequisites: GOOGLE_APPLICATION_CREDENTIALS set to service account JSON path
# Binary must be built with: make build-cloud
vigil status --output json
vigil cloud start --provider gcp --project <project-id> --subscription <sub-name> --output json
vigil search --query "gcp:logs" --limit 5 --output json
```

---

### `deploy_agent`
**Trigger:** "set up the agent on this host" / "start collecting events"
```bash
# 1. Confirm API is reachable.
vigil status --output json

# 2. Start in foreground to verify event flow (Ctrl+C after a few seconds).
#    Choose profile: minimal (Security only) | standard (+ Sysmon, PowerShell) | full (all channels)
vigil agent start --profile standard --output json

# 3. Confirm events are arriving.
vigil search --query "winlog:" --limit 5 --output json

# 4. Install as a persistent Windows Service.
vigil agent install --output json

# 5. Verify service health.
vigil agent status --output json
```
Profile selection guidance: use `minimal` for low-noise environments; `standard` for most deployments;
`full` only when WMI/TaskScheduler/Defender telemetry is needed.

---

### Log collection scenarios

| Scenario | Profile | Rationale |
|---|---|---|
| Endpoint baseline, low storage | `minimal` | Security log only; covers logon/logoff |
| Standard endpoint monitoring | `standard` | Adds Sysmon, PowerShell; recommended default |
| Active incident response | `full` | All channels; high volume, short retention |
| Linux server monitoring | `minimal` | journald only, low overhead |
| Linux with SSH brute force risk | `standard` | journald + auth.log + /var/log/secure |
| Linux full audit | `full` | + /var/log/syslog + auditd |
| AWS CloudTrail | `aws` | IAM/S3/VPC audit trail, ~2 min delivery lag |
| Azure Activity Log | `azure` | RBAC changes, admin operations, subscription-wide |
| GCP Cloud Logging | `gcp` | IAM, compute, storage — Pub/Sub real-time |

Override channels on Windows: `vigil agent start --channels Security,Microsoft-Windows-Sysmon/Operational`

---

### `end_to_end_analysis`
**Trigger:** "investigate what happened" / "full workflow on this alert"
```bash
# 1. List critical and high alerts.
vigil alerts list --status open --severity critical --output json
vigil alerts list --status open --severity high --output json

# 2. Get full detail on the top alert.
vigil alerts get <alert_id> --output json
# Extract event_snapshot.computer and key event fields.

# 3. Search for supporting context around the same host.
vigil search --query "<hostname>" --limit 50 --output json

# 4. Acknowledge confirmed true positives with a note.
vigil alerts acknowledge <alert_id> --note "Confirmed TP: <findings>" --output json

# 5. Bulk-close low-severity noise after review.
vigil alerts batch --action resolve --status open --severity low --confirm --output json

# 6. Open the live web UI for a visual overview.
vigil web start --port 3000 --output json
# Navigate to http://localhost:3000 → Alerts → click alert → view entity graph
```

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
