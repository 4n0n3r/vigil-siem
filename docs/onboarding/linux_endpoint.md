# Onboarding: Linux Endpoint

## Prerequisites

| Requirement | Notes |
|---|---|
| `vigil` binary | Download from releases or `make build` |
| `VIGIL_API_URL` | Set to your Vigil API address |
| Linux kernel 3.10+ | systemd recommended |
| Root / sudo | Required for `full` profile and auditd |

## Permissions required

| Feature | Minimum | Recommended |
|---|---|---|
| journald | any user | any user |
| /var/log/auth.log | `adm` group | root |
| /var/log/secure (RHEL) | `adm` group | root |
| /var/log/syslog | `adm` group | root |
| auditd (`full` profile) | root | root |

## Step-by-step setup

### 1. Install the binary

```bash
# Download latest release (example):
curl -Lo /usr/local/bin/vigil https://github.com/your-org/vigil/releases/latest/download/vigil-linux-amd64
chmod +x /usr/local/bin/vigil
vigil --version
```

### 2. Set environment

```bash
export VIGIL_API_URL=https://your-vigil-api
# Or persist via config file:
vigil config set api_url https://your-vigil-api
```

### 3. Register the endpoint

```bash
vigil agent register --name "$(hostname)" --output json
# Saves api_key and endpoint_id to ~/.config/vigil/config.yaml
```

### 4. Verify connectivity

```bash
vigil doctor --output json
# Expect: all 5 checks pass
```

### 5. Start the agent

Choose your profile:

```bash
# Standard (recommended for most Linux servers)
vigil agent start --profile standard

# Full (requires root, includes auditd)
sudo vigil agent start --profile full
```

### 6. Install as a systemd service

Create `/etc/systemd/system/vigil-agent.service`:

```ini
[Unit]
Description=Vigil Security Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/vigil agent start --profile standard
Restart=on-failure
RestartSec=10
Environment=VIGIL_API_URL=https://your-vigil-api
Environment=VIGIL_API_KEY=<your-api-key>

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable vigil-agent
systemctl start vigil-agent
systemctl status vigil-agent
```

### 7. (Optional) Enable auditd for the `full` profile

**Debian/Ubuntu:**
```bash
apt-get install auditd
systemctl enable auditd
systemctl start auditd
```

**RHEL/CentOS:**
```bash
yum install audit
systemctl enable auditd
systemctl start auditd
```

Add audit rules for execution and cron monitoring:
```bash
auditctl -a always,exit -F arch=b64 -S execve -k exec
auditctl -w /etc/cron.d -p wa -k cron
auditctl -w /var/spool/cron -p wa -k cron
```

## Verify collection

```bash
vigil search --query "journald:" --limit 5 --output json
# Expect: events[] non-empty

vigil search --query "syslog:auth" --limit 5 --output json
# Expect: events[] non-empty (standard/full profile)

vigil search --query "auditd:" --limit 5 --output json
# Expect: events[] non-empty (full profile only)
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `journald` events missing | systemd not running | Switch to syslog profile |
| `syslog:auth` empty | File not readable | Add user to `adm` group or run as root |
| `auditd:` empty | auditd not running | `systemctl start auditd` |
| `CONNECTION_ERROR` | API unreachable | Check `VIGIL_API_URL`, run `vigil doctor` |
| Agent exits immediately | Missing bookmark dir | `mkdir -p ~/.vigil/bookmarks` |
