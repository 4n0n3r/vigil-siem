# Skill: deploy_detection

**Trigger:** "deploy a detection rule", "add Sigma rule", "create detection for <pattern>"

**Goal:** Deploy a Sigma rule, verify it fires on a synthetic test event, and confirm the alert appears in the alert list.

---

## Steps

### Step 0 — Pre-flight: check available log data

Before writing a rule, verify that the target log sources and fields actually
exist in the Vigil event store.

```bash
vigil search --query "<expected_field_or_value>" --limit 3 --output json
```

**Verify:**
- Events exist for the log source the rule targets (e.g. Sysmon EID 1, Security 4688)
- The field names in returned events match what the rule `detection.selection` uses
  (e.g. `event_data.CommandLine`, `event_data.Image`)
- If the field names differ, adjust the rule before deploying

---

### Step 1 — Create the rule

The Sigma YAML `title:` becomes the alert name shown during triage. Follow
this naming structure:

```
<Threat Name> - <Observable Behavior>
```

**Rules:**
- Use a plain unquoted string — no `"quotes"` around the title value
- Use ` - ` (space-dash-space) to separate the threat name from the behavior
- Do NOT put specifics like IPs, domains, or hashes in parentheses — put
  those in the `description` field instead
- Keep it short enough to scan at a glance in an alert list

**Good examples:**
```
title: Axios RAT - DNS Query to C2 Domain
title: Axios RAT - Node.js Spawns cscript via Postinstall Dropper
title: Cobalt Strike - Named Pipe Default Pattern
```

**Bad examples:**
```
title: "Axios RAT: DNS Query to C2 Domain (sfrclak.com)"   # quotes + parens
title: Suspicious Activity                                  # too vague
title: T1059.005                                            # MITRE ID is not a name
```

```bash
vigil detections create --file <rule.yaml> --output json
```

**Verify:**
- `response.id` is non-empty (a UUID)
- `response.enabled == true`
- Record `rule_id = response.id`

---

### Step 2 — Confirm rule appears in list

```bash
vigil detections list --output json
```

**Verify:**
- `response.rules` contains an entry with `id == <rule_id>`
- `enabled == true` for that entry

---

### Step 3 — Ingest a synthetic matching event

Construct a minimal event that satisfies the rule's `detection.selection`.

```bash
vigil ingest \
  --source "test:unit" \
  --event '<json matching the rule detection>' \
  --output json
```

**PowerShell 5.1 workaround:** The CLI `--event` flag has JSON quoting
issues on older PowerShell. If you hit `INVALID_JSON` errors, POST directly
to the API instead:

```powershell
# Write the test event to a temp file
Set-Content "$env:TEMP\test_event.json" -Value '<api_body_json>' -NoNewline -Encoding ASCII

# POST to the API
curl.exe -s -X POST http://localhost:8001/v1/events `
  -H "Content-Type: application/json" `
  -d "@$env:TEMP\test_event.json"
```

The API body format is: `{"source": "<source>", "event": {<event_fields>}}`

**Verify:**
- `response.alert_ids.length > 0` — this is the critical check
- If `alert_ids` is empty, the rule did not fire:
  - Re-read the rule's `detection` block
  - Check field names match exactly (case-sensitive)
  - Retry with a corrected event

---

### Step 4 — Verify the alert exists

```bash
vigil alerts list --rule-id <rule_id> --output json
```

**Verify:**
- `response.total >= 1`
- `response.alerts[0].rule_name` matches the rule name
- `response.alerts[0].severity` matches the rule's `level`

---

### Step 5 — Handle false positives (if needed)

If the rule fires on known-good events in production:

```bash
# Option A: Suppress the specific alert
vigil alerts acknowledge <alert_id> --note "FP: known-good event" --output json

# Option B: Disable the rule for refinement
vigil detections update <rule_id> --enabled false --output json
vigil detections get <rule_id> --output json   # verify enabled == false

# Option C: Tighten the rule (preferred for recurring FPs)
# Add a filter block to the detection YAML to exclude known-good patterns:
#   filter_known_good:
#     event_data.CommandLine|contains: "<known_good_value>"
#   condition: selection and not filter_known_good
```

**Guidance:** Prefer Option C when FPs share a consistent, distinguishable
pattern. Option A is best for one-off FPs. Option B is a last resort.

---

## Error handling

| Error | Action |
|---|---|
| `VALIDATION_ERROR` on create | Fix the YAML structure and retry |
| `alert_ids` empty after ingest | Event doesn't match — re-read rule detection block |
| `DB_NOT_CONNECTED` | PostgreSQL unavailable — rules cannot be persisted |

---

## Success criteria

- `response.id` non-empty from creation
- `enabled == true` confirmed in list
- `alert_ids.length > 0` from synthetic ingest
- `total >= 1` from alerts list filtered by `rule_id`

---

## Known Noisy Rules

Rules with recurring FPs. Before acting on alerts from these rules, check the
suppression list first (`vigil suppressions list --output json`) — a suppression
may already cover the pattern.

| rule_id | rule_name | common FP pattern | suppression_exists | date_noted |
|---|---|---|---|---|

*Populated by the daily tuning run. A rule earns a row here after producing 3+ FPs across runs.*
