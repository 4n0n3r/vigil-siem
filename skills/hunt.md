# Skill: hunt

**Trigger:** "hunt for", "search for attacker", "find all events where", "show me lateral movement events", "look for credential abuse", "threat hunt", "pivot on IP", "pivot on user"

---

## Purpose

`vigil hunt` executes structured queries against the full event store using the Hunt Query Language (HQL). Unlike `vigil search` (substring-only), `hunt` supports typed field lookups, boolean logic, wildcards, and aggregations — enabling efficient, scalable threat hunting across millions of events.

---

## HQL syntax reference

```
field:value                     exact match (case-insensitive)
field:value*                    prefix wildcard
field:*value*                   contains wildcard
field:(v1 OR v2 OR v3)          multi-value OR
field1:v1 AND field2:v2         boolean AND
NOT field:value                 negation
(expr1 OR expr2) AND expr3      grouping
bare_term                       full-text substring search
```

### Common fields

| Field | Example |
|---|---|
| `event_id` | `event_id:4625` |
| `source` | `source:winlog:Security` |
| `event_data.IpAddress` | `event_data.IpAddress:10.0.*` |
| `event_data.SubjectUserName` | `event_data.SubjectUserName:admin` |
| `event_data.TargetUserName` | `event_data.TargetUserName:administrator` |
| `event_data.LogonType` | `event_data.LogonType:3` |
| `event_data.ProcessName` | `event_data.ProcessName:*mshta*` |
| `event_data.CommandLine` | `event_data.CommandLine:*encoded*` |
| `event_data.TargetServerName` | `event_data.TargetServerName:DC01` |
| `computer` | `computer:WORKSTATION-42` |

### Key Windows event IDs

| ID | Meaning |
|---|---|
| 4624 | Successful logon |
| 4625 | Failed logon |
| 4648 | Logon with explicit credentials |
| 4688 | Process creation |
| 4698 | Scheduled task created |
| 4720 | User account created |
| 1 (Sysmon) | Process creation |
| 3 (Sysmon) | Network connection |

---

## Command syntax

```bash
vigil hunt --query "<HQL>" [--agg <field>] [--timeline] [--from <RFC3339>] [--to <RFC3339>] [--limit <n>] --output json
```

### Flags

| Flag | Description | Default |
|---|---|---|
| `--query` | HQL query string | (all events) |
| `--agg` | Aggregate by field path | — |
| `--timeline` | Include hourly event counts | false |
| `--from` | Lower time bound (RFC3339) | — |
| `--to` | Upper time bound (RFC3339) | — |
| `--limit` | Max events returned (1–1000) | 100 |

---

## Standard hunt playbooks

### 1. Brute-force / password spray

```bash
# Failed logons — volume by source IP
vigil hunt --query "event_id:4625" --agg event_data.IpAddress --timeline --limit 200 --output json

# Target specific attacker IP
vigil hunt --query "event_id:4625 AND event_data.IpAddress:10.0.0.55" --limit 100 --output json

# Multiple failed logons from one IP to many users (spray pattern)
vigil hunt --query "event_id:4625 AND event_data.IpAddress:10.0.0.55" --agg event_data.TargetUserName --output json
```

**Interpretation:**
- `aggregations[].count > 20` for a single IP → likely spray
- Many different `TargetUserName` values → spray vs. single-account targeted attack

---

### 2. Lateral movement

```bash
# Explicit credential logons (pass-the-hash / ticket)
vigil hunt --query "event_id:4648" --agg event_data.TargetServerName --timeline --output json

# Network logons (type 3) — cross-host movement
vigil hunt --query "event_id:4624 AND event_data.LogonType:3" --agg event_data.IpAddress --output json

# Same account on multiple hosts
vigil hunt --query "event_id:4624 AND event_data.SubjectUserName:alice" --agg computer --output json
```

**Interpretation:**
- Same `SubjectUserName` appearing on many different `TargetServerName` values → likely lateral movement
- Short time window with many distinct hosts → rapid pivoting

---

### 3. Suspicious execution

```bash
# Living-off-the-land binaries
vigil hunt --query "event_data.ProcessName:*mshta*" --output json
vigil hunt --query "event_data.ProcessName:*wscript* OR event_data.ProcessName:*cscript*" --output json

# Encoded PowerShell
vigil hunt --query "event_data.CommandLine:*encodedcommand*" --limit 50 --output json
vigil hunt --query "event_data.CommandLine:*-enc*" --limit 50 --output json

# New processes spawned from Office apps
vigil hunt --query "event_data.ParentProcessName:*WINWORD* OR event_data.ParentProcessName:*EXCEL*" --output json
```

---

### 4. Persistence

```bash
# Scheduled task creation
vigil hunt --query "event_id:4698" --output json

# Registry run keys (forensic)
vigil hunt --query "source:forensic:registry" --limit 100 --output json

# New user accounts
vigil hunt --query "event_id:4720" --output json
```

---

### 5. Full-text pivot

```bash
# Pivot on a hostname across all event types
vigil hunt --query "WORKSTATION-42" --timeline --output json

# Pivot on an IP
vigil hunt --query "10.0.0.55" --agg source --output json

# Pivot on a username
vigil hunt --query "alice" --agg event_id --output json
```

---

## Response schema

```json
{
  "events": [
    {
      "id": "uuid",
      "source": "winlog:Security",
      "event": { "event_id": 4625, "event_data": { "IpAddress": "10.0.0.55" } },
      "timestamp": "2026-03-17T09:00:00Z"
    }
  ],
  "total": 42,
  "query_time_ms": 18,
  "aggregations": [
    { "value": "10.0.0.55", "count": 312 },
    { "value": "192.168.1.100", "count": 7 }
  ],
  "timeline": [
    { "ts": "2026-03-17T08:00:00Z", "count": 14 },
    { "ts": "2026-03-17T09:00:00Z", "count": 28 }
  ],
  "query": "event_id:4625"
}
```

---

## When to use hunt vs. search

| Situation | Use |
|---|---|
| Quick substring across all fields | `vigil search --query "mshta.exe"` |
| Structured field lookup | `vigil hunt --query "event_data.ProcessName:*mshta*"` |
| Counting/grouping attackers by IP | `vigil hunt --agg event_data.IpAddress` |
| Time-series volume spike detection | `vigil hunt --timeline` |
| Complex boolean filter | `vigil hunt --query "event_id:4625 AND NOT event_data.SubjectUserName:SYSTEM$"` |

---

## Performance notes

- ClickHouse evaluates HQL queries against the `ngrambf_v1` index — full-text substring searches are pre-filtered without full table scans.
- Integer fields (`event_id`, `record_id`, `pid`) use `JSONExtractUInt` with direct integer comparison — fastest path.
- `source` field queries hit the primary key index directly.
- For very large time ranges, narrow with `--from`/`--to` first.
- `--limit 100` (default) is safe; raise to 1000 only when aggregating, not when inspecting events.
