# Detection Rules

Vigil evaluates Sigma rules against every ingested event. Matched events generate alerts.

## Sigma format support

Vigil supports a subset of the [Sigma specification](https://github.com/SigmaHQ/sigma):

| Feature | Supported |
|---|---|
| `detection.keywords` — substring search | Yes |
| `detection.selection` — field:value pairs | Yes |
| `detection.condition: selection` | Yes |
| `detection.condition: selection AND filter` | Yes |
| `detection.condition: 1 of selection*` | Yes |
| Wildcards (`*`, `?`) | Yes |
| `|contains`, `|startswith`, `|endswith` modifiers | Yes |
| `|all` modifier (all values must match) | Yes |
| CIDR notation, regex modifiers | No |

## Rule file format

```yaml
title: Suspicious PowerShell EncodedCommand
status: experimental
description: Detects use of -EncodedCommand flag in PowerShell
logsource:
  product: windows
  service: sysmon
detection:
  selection:
    event_data.CommandLine|contains:
      - '-encodedcommand'
      - '-enc '
  condition: selection
level: high
tags:
  - attack.execution
  - attack.t1059.001
```

The `level` field maps to Vigil's `severity` (`low`, `medium`, `high`, `critical`).

## Deploy → test → verify cycle

### 1. Create the rule

```bash
vigil detections create --file rule.yaml --output json
# → {"id":"<rule_id>","name":"...","enabled":true,...}
```

### 2. Verify it's enabled

```bash
vigil detections list --output json | jq '.rules[] | select(.id == "<rule_id>")'
# → confirm "enabled": true
```

### 3. Ingest a synthetic matching event

```bash
vigil ingest \
  --source "winlog:Security" \
  --event '{"event_data":{"CommandLine":"powershell.exe -encodedcommand AABB..."}}' \
  --output json
# → {"alert_ids":["<alert_id>"],...}   ← non-empty = rule fired
```

### 4. Check the alert

```bash
vigil alerts list --rule-id <rule_id> --output json
# → {"alerts":[...],"total":1}
```

### 5. Handle false positives

```bash
# Suppress a specific alert
vigil alerts batch --ids <alert_id> --action suppress

# Or disable the rule entirely
vigil detections update <rule_id> --enabled false
```

## Bundled rules

Rules ship in `detections/` organized by MITRE tactic:

| Tactic | Rules |
|---|---|
| `credential_access/` | Brute force (4625), credential dump indicators |
| `defense_evasion/` | Log clearing (1102, 104), indicator removal |
| `execution/` | EncodedCommand, suspicious script hosts |
| `initial_access/` | Phishing attachment execution |
| `lateral_movement/` | Pass-the-hash (4648), network logon (4624 type 3) |
| `persistence/` | Scheduled task creation (4698), new user (4720) |

## Managing rules

```bash
vigil detections list --output json                    # all rules
vigil detections list --severity high --output json    # by severity
vigil detections get <id> --output json                # single rule
vigil detections update <id> --enabled false           # disable
vigil detections delete <id>                           # delete (HITL required)
```
