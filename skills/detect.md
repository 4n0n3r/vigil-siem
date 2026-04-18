# Skill: deploy_detection

**Trigger:** "deploy a detection rule", "add Sigma rule", "create detection for <pattern>"

**Goal:** Deploy a Sigma rule, verify it fires on a synthetic test event, and confirm the alert appears in the alert list.

---

## Steps

### Step 1 — Create the rule

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
```

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
