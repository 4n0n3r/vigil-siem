# Skill: triage

**Trigger:** "what's happening?", "triage current alerts", "show me what's going on", "security summary"

**Goal:** Rapidly assess the current threat landscape — surface critical/high alerts, confirm the system is healthy, and group findings by severity and rule.

---

## Steps

### Step 1 — Check system status

```bash
vigil status --output json
```

**Verify:**
- `response.api_status == "ok"` — if not, stop and report connectivity issue
- `response.postgres_status == "ok"` — if not, alerts may be unavailable
- Note `response.open_alerts` as the total alert count

---

### Step 2 — List critical alerts

```bash
vigil alerts list --severity critical --output json
```

**Verify:**
- `response.total` is numeric (not an error)
- If `response.total > 0`, record each `alert.id`, `alert.rule_name`, `alert.matched_at`

---

### Step 3 — List high alerts

```bash
vigil alerts list --severity high --output json
```

**Verify:**
- Same checks as Step 2

---

### Step 4 — List all open alerts (full picture)

```bash
vigil alerts list --status open --output json
```

**Verify:**
- `response.total` is numeric
- Group by `alert.rule_name` to identify the noisiest detections
- Group by `alert.severity` to prioritise

---

### Step 5 — Report summary

Produce a structured summary:

```json
{
  "api_healthy": true,
  "open_alerts": <total>,
  "by_severity": {
    "critical": <count>,
    "high": <count>,
    "medium": <count>,
    "low": <count>
  },
  "top_rules": [
    {"rule_name": "...", "count": N},
    ...
  ],
  "recommended_action": "investigate_alert <id>"
}
```

---

## Error handling

| Error | Action |
|---|---|
| `CONNECTION_ERROR` on status | Stop. Report API unreachable. Run `vigil doctor` |
| `DB_NOT_CONNECTED` on alerts | Warn that alerts unavailable, report events only |
| Empty results on all severities | Report "no open alerts — system clean" |

---

## Success criteria

- `api_status == "ok"` confirmed
- At least one alert severity bucket inspected
- Summary produced with `open_alerts` count (zero is valid)

---

## Known Benign Patterns

Alerts matching any row below: **skip investigation, resolve immediately** via batch.

```bash
vigil alerts batch --action resolve --ids <matching_ids> --note "Known benign: <reason>" --output json
```

| rule_name | field_path | field_value | reason | date_added |
|---|---|---|---|---|
| Linux - Python or Perl Reverse Shell One-liner | SYSLOG_IDENTIFIER | CRON | certbot renewal cron uses `perl -e sleep`; not a reverse shell | 2026-04-28 |
| Linux - Disk Wipe or Overwrite Utility Executed | SYSLOG_IDENTIFIER | sshd | SSH brute force for username "dd" matches dd substring; not disk wipe | 2026-04-28 |
| Linux - System Directory Targeted by Recursive Deletion | SYSLOG_IDENTIFIER | sshd | sshd disconnect messages contain "-rf" substring; not actual rm execution | 2026-04-28 |
| Linux - Systemd Service Unit Created or Enabled | MESSAGE | *.service: Succeeded. | Normal systemd service completion log; not new service creation | 2026-04-28 |
| Linux - Suspicious Download from External Host | MESSAGE | http | YAML duplicate-key bug collapsed detection to match any HTTP URL; rule fixed 2026-04-28 | 2026-04-28 |

*This table is populated by the daily investigation run. Each confirmed-benign pattern gets a row here so future runs skip re-investigation and go straight to resolve.*
