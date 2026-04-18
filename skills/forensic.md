# Skill: forensic_sweep

**Trigger:** "forensic sweep", "collect artifacts", "post-incident artifact grab", "what was installed/running on this host?"

**Goal:** Collect a point-in-time artifact snapshot from the endpoint and search the results for indicators of compromise.

---

## Platform Detection

Before running, detect which platform you are on:

```bash
vigil status --output json
# Check the response for platform context, or inspect the agent:
uname -s 2>/dev/null || echo "windows"
```

- If `Linux` → follow the **Linux** section below
- If `Windows` → follow the **Windows** section below

---

## Linux

**Requires:** root or sudo for full coverage. Some artifacts degrade gracefully without root.

### Step 1 — Run the forensic collection

```bash
vigil forensic collect --output json
```

**Verify:**
- `response.ingested > 0` — artifacts were collected and sent to the API
- Expect counts for: `forensic:cron`, `forensic:services`, `forensic:suid`, `forensic:ssh_keys`, `forensic:users`, `forensic:network`, `forensic:bash_history`, `forensic:packages`
- If `ingested == 0`: check privileges, run `vigil doctor`

---

### Step 2 — Search cron jobs

```bash
vigil search --query "forensic:cron" --limit 50 --output json
```

**Look for:**
- Cron entries in `/etc/cron.d/` or user crontabs referencing temp paths, curl/wget, or encoded commands
- Entries owned by unusual users

---

### Step 3 — Search enabled services

```bash
vigil search --query "forensic:services" --limit 100 --output json
```

**Look for:**
- Services with `ExecStart` paths in `/tmp`, `/var/tmp`, or user home directories
- Services enabled but not from a standard package path (`/usr/bin`, `/usr/sbin`, `/usr/lib`)

---

### Step 4 — Search SUID binaries

```bash
vigil search --query "forensic:suid" --limit 50 --output json
```

**Look for:**
- SUID binaries outside of standard paths (`/bin`, `/usr/bin`, `/usr/sbin`)
- Unexpected interpreters with SUID bit (`python`, `perl`, `bash`)

---

### Step 5 — Search SSH authorized keys

```bash
vigil search --query "forensic:ssh_keys" --limit 50 --output json
```

**Look for:**
- Authorized keys for accounts that should not have remote access
- Multiple keys for the same user — one may be attacker-added
- Keys with unusual `from=` or `command=` prefixes

---

### Step 6 — Search user accounts

```bash
vigil search --query "forensic:users" --limit 50 --output json
```

**Look for:**
- Accounts with UID 0 other than root
- Accounts with interactive shells that should not have them
- Accounts created recently (cross-reference with incident timeline)

---

### Step 7 — Search listening network services

```bash
vigil search --query "forensic:network" --limit 50 --output json
```

**Look for:**
- Ports listening on 0.0.0.0 that are not expected
- Unknown process names in the `process` field

---

### Step 8 — Search bash history

```bash
vigil search --query "forensic:bash_history" --limit 100 --output json
```

**Look for:**
- `curl`, `wget` to external IPs
- `chmod +x` / `./` sequences
- Encoded commands (`base64 -d`, `python -c`)
- Privilege escalation attempts (`sudo`, `su`)

---

### Step 9 — Cross-reference with alerts

```bash
vigil alerts list --status open --output json
```

Correlate open alerts against findings: usernames, paths, and IPs from forensic artifacts.

---

## Windows

**Requires:** Administrator. Run from the endpoint.

### Step 1 — Run the forensic collection

```bash
vigil forensic collect --output json
```

**Verify:**
- `response.ingested > 0` — artifacts were collected and sent to the API
- Record the `source` prefixes reported (e.g. `forensic:prefetch`, `forensic:registry`)
- If `ingested == 0`: check admin privileges, check `vigil doctor`

---

### Step 2 — Search registry run keys

```bash
vigil search --query "forensic:registry" --output json
```

**Look for:**
- Unusual entries in `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`
- Entries referencing temp directories, unusual executables, or encoded commands

---

### Step 3 — Search services

```bash
vigil search --query "forensic:services" --output json
```

**Look for:**
- Services with binary paths in temp directories, user profiles, or AppData
- Auto-start services that were not present before the incident

---

### Step 4 — Search scheduled tasks

```bash
vigil search --query "forensic:tasks" --output json
```

**Look for:**
- Tasks with unusual triggers (on logon, on idle) or binary paths outside `System32`

---

### Step 5 — Search prefetch artifacts

```bash
vigil search --query "forensic:prefetch" --output json
```

**Look for:**
- Prefetch entries from unexpected executables
- Execution timestamps from `mtime` field

---

### Step 6 — Cross-reference with alerts

```bash
vigil alerts list --status open --output json
```

Correlate `event_snapshot.event_data.ProcessName` with prefetch entries.

---

## Error handling

| Error | Action |
|---|---|
| `PERMISSION_DENIED` / no data | Re-run as root (Linux) or Administrator (Windows) |
| `ingested == 0` | API may be unreachable — run `vigil doctor` |
| No results for a source prefix | That artifact class was empty on this host (normal) |
| `UNSUPPORTED_PLATFORM` | Check build — Linux forensic requires `vigil` built for linux |

---

## Success criteria

- `response.ingested > 0` from collection
- At least two source prefixes return results in search
- Findings cross-referenced against open alerts
- Summary includes: suspicious cron/autorun entries, unusual services, unknown SSH keys (Linux) or unexpected Run keys/services/tasks (Windows)
