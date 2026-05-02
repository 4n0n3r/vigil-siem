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
| Linux - Download Tool Piped to Shell | SYSLOG_IDENTIFIER | sshd | SSH brute force with username "curl" matches rule via |all modifier bug; detection tuned to exclude sshd events (filter_sshd block added 2026-04-29) | 2026-04-29 |
| Linux - Firewall Service Stopped | MESSAGE | Stopped Vigil Security Agent. | Vigil agent stop triggers firewall rule; not a firewall service. Suppression created. | 2026-04-29 |
| Linux - Firewall Service Stopped | MESSAGE | Stopped Vigil Web UI. | Vigil web UI stop triggers firewall rule; not a firewall service. Suppression created. | 2026-04-29 |
| Windows PowerShell - Script Block Logging Triggered | computer | UX200d | Vigil CLI PowerShell AST parser generates 4104 events on UX200d; verify ScriptBlockText contains vigil.exe before investigating | 2026-04-29 |
| Windows Security - Security Group Membership Enumerated | event_data.CallerProcessName | C:\Windows\System32\taskhostw.exe | System task host queries Administrators group on schedule; rule tuned 2026-04-29 to exclude | 2026-04-29 |
| Windows Security - Security Group Membership Enumerated | event_data.CallerProcessName | C:\Windows\System32\VSSVC.exe | Volume Shadow Copy queries group membership; rule tuned 2026-04-29 to exclude | 2026-04-29 |
| Linux - Passwd or Shadow File Enumeration via Cat | SYSLOG_IDENTIFIER | sshd | Sigma |all bug matches "cat" as substring of "authentication" in PAM/sshd messages; rule tuned 2026-04-29 to exclude sshd | 2026-04-29 |
| Windows Security - Security Local Group Created | event_data.SamAccountName | CodexSandboxUsers | dvdxd created this group on UX200d for AI agent sandbox isolation; legitimate | 2026-04-29 |
| Linux - DNS Query for Tor or Dark Web Domain | MESSAGE | NXDOMAIN (without .onion) | YAML duplicate-key bug in sel_msg_onion collapsed two MESSAGE|contains to only NXDOMAIN; certbot cert renewal failures triggered this. Rule fixed 2026-04-29 to use MESSAGE|contains|all: [.onion, NXDOMAIN] | 2026-04-29 |
| Windows Security - Local Group Membership Enumerated | event_data.CallerProcessName | C:\Windows\System32\svchost.exe | svchost routine local group membership lookup during token generation; rule disabled 2026-04-29 due to extreme noise | 2026-04-29 |
| Windows Security - Security Group Membership Enumerated | event_data.CallerProcessName | C:\Windows\System32\SearchIndexer.exe | Windows Search Indexer queries Administrators group membership; rule filter updated 2026-04-29 to exclude | 2026-04-29 |
| Windows Security - Security Group Membership Enumerated | event_data.CallerProcessName | C:\Windows\System32\svchost.exe | svchost queries group membership as part of service operations; rule filter updated 2026-04-29 to exclude | 2026-04-29 |
| Windows Security - User Account Properties Changed | event_data.SubjectUserName | UX200D$ | SYSTEM (machine account) automatically updates dvdxd account attributes (last logon time, logon count); not a human-initiated change | 2026-04-29 |
| Windows Security - User Account Enabled | event_data.TargetUserName | CodexSandboxOnline | dvdxd enabling AI sandbox account on UX200d; legitimate admin activity | 2026-04-29 |
| Windows Security - User Account Enabled | event_data.TargetUserName | CodexSandboxOffline | dvdxd enabling AI sandbox account on UX200d; legitimate admin activity | 2026-04-29 |
| Windows Security - Logon Using Explicit Credentials | event_data.ProcessName | C:\Windows\System32\lsass.exe | lsass MSA/Microsoft Account token refresh to localhost; standard Windows SSO credential renewal, not lateral movement | 2026-04-29 |
| Windows Security - Local Security Group Modified | event_data.TargetUserName | CodexSandboxUsers | dvdxd modifying CodexSandboxUsers group for AI agent sandbox setup on UX200d; legitimate | 2026-04-29 |
| Windows Security - Security Group Membership Enumerated | event_data.CallerProcessName | C:\Windows\System32\dllhost.exe | COM surrogate routine activation queries group membership; rule tuned 2026-04-30 to exclude | 2026-04-30 |
| Windows Security - Security Group Membership Enumerated | event_data.CallerProcessName | C:\Windows\System32\net1.exe | net.exe child process; dvdxd running net localgroup admin commands on UX200d; legitimate admin activity (not filtered in rule due to attacker use of net.exe) | 2026-04-30 |
| Windows Security - Logon Using Explicit Credentials | event_data.SubjectUserName | UX200D$ | Machine account (UX200D$) MSA/Microsoft Account token renewal via lsass.exe and svchost.exe; rule tuned 2026-04-30 to filter SubjectUserName ending with $ and loopback IpAddress | 2026-04-30 |
| Linux - DNS Query for Tor or Dark Web Domain | MESSAGE | NXDOMAIN (without .onion) | Still generating FPs after 2026-04-29 rule fix; root cause: sigma rule cache not invalidated across all API instances/workers after PATCH — stale in-memory cache retained old buggy rule. Resolve on sight until API periodic cache refresh is implemented. | 2026-04-30 |
| Windows PowerShell - Script Block Logging Triggered | event_data.ScriptBlockText | (contains Get-RawCommandElements) | Vigil CLI PSAst parser on UX200d generates 4104 events; rule tuned 2026-05-01 to exclude via filter_vigil_ast_parser. If alerts recur, check if cache invalidation applied. | 2026-05-01 |
| Windows System - New Service Installed | event_data.ServiceName | Logi Options+ | Logitech Options+ updater service (logioptionsplus_updater.exe) from C:\Program Files\LogiOptionsPlus\; Logitech Inc. signed binary confirmed via Sysmon; dvdxd machine UX200d. Rule tuned 2026-05-01 to filter all C:\Program Files\ paths — this alert type should not recur for any Program Files service. | 2026-05-01 |

*This table is populated by the daily investigation run. Each confirmed-benign pattern gets a row here so future runs skip re-investigation and go straight to resolve.*
