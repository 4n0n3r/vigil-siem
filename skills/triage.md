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
