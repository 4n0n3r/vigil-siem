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

**Source prefixes:** `winlog:` `syslog:` `journald:` `file:` `forensic:` `cloudtrail:` `azure:` `gcp:` `web:<appname>`

### Connect mode commands

Connect mode gives AI agents structured access to existing SIEMs (Wazuh, Elastic) without deploying new agents on endpoints.

| Command | Key flags | Key response fields |
|---|---|---|
| `vigil connector add wazuh` | `--name <s>` `--indexer-url <url>` `--indexer-user <s>` `--indexer-pass <s>` `--no-verify-ssl` | `id`, `name`, `siem_type`, `enabled` |
| `vigil connector add elastic` | `--name <s>` `--url <url>` `--api-key <s>` `--no-verify-ssl` | `id`, `name`, `siem_type`, `enabled` |
| `vigil connector list` | — | `connectors[]`, `total` |
| `vigil connector test <id>` | — | `id`, `status`, `latency_ms` |
| `vigil connector remove <id>` | `--confirm` (**human required**) | `id`, `deleted:true` |
| `vigil feed alerts` | `--severity` `--since <duration>` | `alerts[]`, `total` |
| `vigil feed context <connector_id> <native_id>` | `--window <duration>` | `events[]`, `total`, `source_siem` |

---

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
| `CONNECTOR_NOT_FOUND` | Connector ID does not exist |
| `CONNECTOR_FETCH_ERROR` | SIEM returned an error during alert fetch |
| `CONNECTOR_CONTEXT_ERROR` | SIEM returned an error during context fetch |
| `UNSUPPORTED_SIEM_TYPE` | `siem_type` not in supported list: `wazuh`, `elastic` |
| `CONNECTOR_NAME_CONFLICT` | A connector with this name already exists |
| `CONNECTOR_CONFIG_INVALID` | Missing required config keys for this SIEM type |

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
| Web app (nginx/apache/json) | `--web-log` flag | HTTP access log; format: `name:format:path` |

Override channels on Windows: `vigil agent start --channels Security,Microsoft-Windows-Sysmon/Operational`

Web app log monitoring (all platforms): `vigil agent start --web-log "name:format:/path/to/access.log"`

---

### `onboard_webapp`
**Trigger:** "monitor web app", "add web log", "onboard web application"
```bash
# Supported formats: nginx, apache, clf, json
# One --web-log per application; flag is repeatable.
vigil status --output json                        # confirm API reachable

vigil agent start \
  --web-log "myapp:nginx:/var/log/nginx/access.log" \
  --output json
# Ctrl+C after a few seconds to verify events flow.

vigil search --query "web:myapp" --limit 5 --output json
# Confirm events arrive with source prefix "web:myapp".

# Deploy the four web detection rules (run once per environment):
vigil detections create --file detections/initial_access/web_vulnerability_scanner.yml --output json
vigil detections create --file detections/initial_access/web_path_traversal.yml --output json
vigil detections create --file detections/initial_access/web_sql_injection.yml --output json
vigil detections create --file detections/initial_access/web_sensitive_file_access.yml --output json

# Install agent as a persistent service (Windows) or systemd unit (Linux).
vigil agent install --output json
```

Format reference:

| Format | Log type |
|---|---|
| `nginx` | Nginx combined log (`$remote_addr … "$request" $status …`) |
| `apache` | Apache combined log (identical format to nginx) |
| `clf` | Common Log Format (no referer / UA fields) |
| `json` | JSON lines — auto-normalises common field names |

---

### `hunt_web_attacks`
**Trigger:** "investigate web traffic", "look for web attacks", "web threat hunt"

```bash
# Overview: error distribution by path
vigil hunt --query "source:web:*" --agg path --output json
# High 4xx/5xx counts on a path → brute force or probing target.

# Scanner activity
vigil hunt --query "ua_category:scanner" --agg client_ip --timeline --output json
# Multiple IPs or sustained timeline → coordinated scan.

# Path traversal attempts
vigil hunt --query "has_traversal:true" --agg client_ip --output json
# Same IP across multiple apps → targeted attacker.

# SQL injection attempts
vigil hunt --query "has_sql_chars:true" --agg path --output json
# Paths with high hit count → likely automated injection tooling.

# Sensitive file probing
vigil hunt --query "is_sensitive_path:true" --agg path --timeline --output json

# Pivot on a specific attacker IP
vigil hunt --query "client_ip:1.2.3.4" --timeline --limit 200 --output json

# Admin path brute force
vigil hunt --query "is_admin_path:true AND status_class:4xx" --agg client_ip --output json

# POST flood (possible credential stuffing)
vigil hunt --query "method:POST AND status_class:4xx" --agg path --timeline --output json
```

**Fields available on every web event** (use in `vigil hunt --query` and alert `event_snapshot`):

| Field | Type | Description |
|---|---|---|
| `source` | string | `web:<appname>` — identifies the application |
| `app_name` | string | Friendly name passed to `--web-log` |
| `log_format` | string | `nginx` / `apache` / `clf` / `json` |
| `client_ip` | string | Remote client address |
| `method` | string | HTTP verb (`GET`, `POST`, …) |
| `path` | string | URI path, URL-decoded |
| `query` | string | Query string, URL-decoded |
| `status_code` | int | HTTP response status |
| `status_class` | string | `2xx` / `3xx` / `4xx` / `5xx` |
| `bytes_sent` | int | Response body size in bytes |
| `user_agent` | string | Full User-Agent header |
| `ua_category` | string | `browser` / `bot` / `scanner` / `tool` / `unknown` |
| `referer` | string | HTTP Referer header |
| `extension` | string | File extension from path (e.g. `php`, `js`) |
| `path_depth` | int | Number of path segments |
| `has_traversal` | bool | Path or query contains `../` or encoded variant |
| `has_sql_chars` | bool | SQL keywords / comment sequences detected |
| `is_admin_path` | bool | Path matches known admin prefixes |
| `is_sensitive_path` | bool | Path targets `.env`, `.git`, config files, etc. |
| `is_error` | bool | `status_code >= 400` |

**Response fields to analyse:**
- `aggregations[].value` + `aggregations[].count` — top offenders sorted by volume
- `timeline[]` — hourly distribution; spikes indicate burst activity
- `events[].event.client_ip` — pivot to `vigil hunt --query "client_ip:<ip>"` for full actor history

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

## Connect mode skills

Use these when Vigil is connected to an existing SIEM via `vigil connector add`.

### `onboard_connector_wazuh`
**Trigger:** "connect Wazuh", "add Wazuh connector", "point Vigil at Wazuh"

Wazuh exposes two APIs. The connector only needs the OpenSearch indexer (port 9200).

```bash
vigil status --output json   # confirm API reachable

vigil connector add wazuh \
  --name <display-name> \
  --indexer-url https://<wazuh-indexer>:9200 \
  --indexer-user admin \
  --indexer-pass <password> \
  --output json
# Note the returned id

vigil connector test <id> --output json
# status must be "ok" before proceeding
```

**Troubleshooting:**
- `connection refused` → wrong indexer URL or port
- `401` → wrong credentials (default Wazuh indexer: admin/admin — change in production)
- `CONNECTOR_CONFIG_INVALID` → missing `--indexer-url` or `--indexer-user`/`--indexer-pass`

Context fetch requires Wazuh archives enabled in ossec.conf: `<logall_json>yes</logall_json>`.
Without this, `vigil feed context` falls back to nearby alerts from the same agent only.

---

### `onboard_connector_elastic`
**Trigger:** "connect Elastic", "add Elastic connector", "connect Elastic Security"

```bash
# Create an API key in Kibana:
# Stack Management → API Keys → Create API key
# Type: Restricted — grant read on .alerts-security.* and logs-*
# Copy the base64-encoded value shown as "Encoded"

vigil status --output json

vigil connector add elastic \
  --name <display-name> \
  --url https://<elastic>:9200 \
  --api-key <base64-key> \
  --output json

vigil connector test <id> --output json
# status must be "ok"

vigil feed alerts --severity high --since 1h --output json
# confirm alerts arrive from the connected Elastic deployment
```

---

### `investigate_feed_alert`
**Trigger:** alert from `vigil feed alerts` needs investigation

```bash
# 1. Pull recent high-severity alerts from all connected SIEMs
vigil feed alerts --severity high --since 1h --output json
# Extract: connector_id, native_id, hostname from response

# 2. Get surrounding log context (±15m window)
vigil feed context <connector_id> <native_id> --window 15m --output json
# Returns raw log events from the same host in the window before the alert

# 3. Check related alerts on the same host (last 24h)
vigil feed alerts --since 24h --output json
# Filter by hostname client-side: jq '[.alerts[] | select(.hostname == "<hostname>")]'

# 4. Classify and act
# False positive → vigil alerts acknowledge <native_id> --note "FP: <reason>" --output json
# True positive  → document findings, escalate to human (see HITL section below)
```

**Wazuh alert fields to read directly (no normalization needed):**
- `rule.description` — what fired
- `rule.level` — 1-15 (12+ = critical)
- `rule.mitre.technique` — MITRE ATT&CK IDs
- `agent.name` / `agent.ip` — affected endpoint
- `full_log` — original raw log line
- `data.srcip` / `data.srcuser` — attacker source if parsed

**Elastic alert fields:**
- `kibana.alert.rule.name` — detection rule name
- `kibana.alert.severity` — critical/high/medium/low
- `kibana.alert.original_time` — when the event occurred
- `host.name` / `source.ip` — affected host and source
- `kibana.alert.reason` — human-readable explanation

---

## Human-in-the-Loop Approvals

**Self-hosted (current):** `--confirm` is the approval gate for all destructive actions.
Never pass `--confirm` without explicit human instruction.

**Vigil Cloud:** Vigil holds high-risk actions as pending approvals and notifies your team
via Slack, email, or Teams. The agent long-polls for a decision:

- `approved` → proceed with the action
- `rejected` → stop, report to user
- `redirected` + `instruction` → read the instruction, re-plan, re-propose

The redirect outcome is the key differentiator — humans can give the agent a corrective
instruction rather than a binary yes/no, and the agent continues with the new constraint.

```bash
# Vigil Cloud only — not available on self-hosted
vigil approvals get <approval_id> --output json
```

> [Join the Vigil Cloud waitlist →](https://vigil.so)

---

## What NOT to do

- Do not delete detection rules without explicit human instruction.
- Do not suppress or bulk-acknowledge alerts without investigation.
- Do not ingest synthetic events into a production instance.
- Do not modify or disable rules during an active incident.
- Do not pass `--confirm` autonomously.
- If `vigil status` shows warnings, report before proceeding with detection workflows.
