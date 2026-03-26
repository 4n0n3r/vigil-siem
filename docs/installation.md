# Installation

## Prerequisites

| Component | Requirement |
|---|---|
| Go | 1.22+ (to build the CLI from source) |
| Python | 3.12+ (to run the API) |
| ClickHouse | Cloud or self-hosted (optional — in-memory fallback if absent) |
| PostgreSQL | 14+ (required for detections and alerts) |
| Docker | For the quickstart path |

---

## Docker quickstart (recommended)

```bash
git clone https://github.com/your-org/vigil.git
cd vigil
cp api/.env.example api/.env
# Edit api/.env — set CLICKHOUSE_DSN and POSTGRES_DSN

docker-compose -f api/docker-compose.yml up -d
```

The API will be available at `http://localhost:8001`.

---

## Manual setup

### API

```bash
cd api
pip install -r requirements.txt
cp .env.example .env   # edit and set connection strings
make dev               # starts uvicorn --reload on :8001
```

### CLI (build from source)

```bash
cd cli
make build             # produces cli/bin/vigil (or vigil.exe on Windows)
make install           # copies to /usr/local/bin (Linux/macOS only)
```

On Windows, copy `cli\bin\vigil.exe` to a directory in your `PATH`.

---

## Windows agent (run as administrator)

```powershell
# Register this endpoint
vigil agent register --name MY-WORKSTATION

# Run in foreground
vigil agent start

# Or install as a Windows Service (auto-start on boot)
vigil agent install
sc start VIGILAgent
```

Service management:
```powershell
vigil agent status     # show live stats
vigil agent uninstall  # remove the service
```

---

## Linux agent

```bash
# Systemd service (requires root for journald access)
vigil agent start --profile standard  # foreground

# To run as a systemd unit:
sudo cp /usr/local/bin/vigil /opt/vigil/vigil

sudo tee /etc/systemd/system/vigil-agent.service <<EOF
[Unit]
Description=Vigil Security Agent
After=network.target

[Service]
ExecStart=/opt/vigil/vigil agent start --profile standard
Environment=VIGIL_API_URL=http://your-vigil-api:8001
Environment=VIGIL_API_KEY=vig_...
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now vigil-agent
```

---

## Upgrade procedure

1. Build or download the new `vigil` binary.
2. Replace the existing binary.
3. Restart the API: `docker-compose restart` or restart the uvicorn process.
4. New migrations run automatically on API startup.
5. ClickHouse schema changes are applied idempotently on startup.

---

## Verify the installation

```bash
vigil doctor --output json
# All checks should show "pass" or "warn"
```
