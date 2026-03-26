# Skill: investigate_alert

**Trigger:** alert ID given, "investigate alert <id>", "look into alert <id>"

**Goal:** Understand the full context of a single alert — the triggering event, surrounding activity, lateral movement, and whether the alert is a true positive.

---

## Steps

### Step 1 — Get the alert

```bash
vigil alerts get <alert_id> --output json
```

**Verify:**
- `response.id == <alert_id>` — confirm it exists
- Record: `rule_name`, `severity`, `matched_at`, `event_snapshot`
- `event_snapshot` must be non-empty — it contains the triggering event data

---

### Step 2 — Extract pivot values from event_snapshot

From `event_snapshot`, extract:
- `computer` (hostname)
- `event_data.SubjectUserName` or `event_data.TargetUserName` (user)
- `event_data.IpAddress` (source IP, if present)

---

### Step 3 — Hunt by hostname

```bash
vigil hunt --query "computer:<HOSTNAME>" --from <matched_at - 1h> --to <matched_at + 1h> --output json
```

**Verify:**
- `response.total` is numeric
- Look for other event_ids from the same host in the ±1h window
- Note any 4624 (logon), 4625 (failed), 4648 (explicit creds) events

---

### Step 4 — Hunt by user (if user present)

```bash
vigil hunt --query "event_data.SubjectUserName:<USER>" --from <matched_at - 1h> --output json
```

**Verify:**
- Look for unexpected logon types or hosts

---

### Step 5 — Hunt by IP (if IP present)

```bash
vigil hunt --query "event_data.IpAddress:<IP>" --from <matched_at - 1h> --output json
```

---

### Step 6 — Check for follow-on alerts

```bash
vigil alerts list --from_time <matched_at - 5m> --status open --output json
```

**Verify:**
- Are there related alerts from the same time window?
- Multiple high/critical alerts suggest an active incident

---

### Step 7 — Acknowledge with findings

```bash
vigil alerts acknowledge <alert_id> --note "Investigated: <summary of findings>" --output json
```

**Verify:**
- `response.acknowledged_at` is set (not null)
- `response.status == "acknowledged"`

---

## Error handling

| Error | Action |
|---|---|
| `NOT_FOUND` on alert get | Alert was deleted or ID is wrong — stop |
| Empty `event_snapshot` | Can still hunt by alert `rule_name` and time range |
| No hunt results | Log "no corroborating events found" in acknowledgement note |

---

## Success criteria

- Alert retrieved with non-empty `event_snapshot`
- At least one hunt query executed for pivoting
- Alert acknowledged with a meaningful note
- `acknowledged_at` is set in the final response
