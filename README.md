# Vigil

**CLI-first SIEM built for AI agents.** Ingest, search, detect, and respond — all from the command line or via structured JSON that AI agents can consume directly.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](docs/installation.md)

---

## Vigil Cloud

Don't want to manage the infrastructure? Vigil Cloud runs the full stack for you —
ClickHouse, PostgreSQL, backups, retention, and high availability included.

**[Join the waitlist](https://vigil.so)** *(coming soon)*

---

## 5-minute quickstart (Docker)

The Docker stack includes everything: API, PostgreSQL, and ClickHouse. No external accounts or services required.

```bash
# Clone and start
git clone https://github.com/your-org/vigil.git
cd vigil
docker-compose -f api/docker-compose.yml up -d

# Build the CLI
cd cli && make build
./bin/vigil status                # should print api_status: ok, clickhouse_status: ok
```

That's it. Events are stored in ClickHouse, detection rules and alerts in PostgreSQL — both running locally in Docker with persistent volumes.

For production hardening (auth on, DBs not exposed, no hot-reload):

```bash
make prod-up
```

---

## Manual quickstart (without Docker)

### 1. Start the databases

**PostgreSQL** (required):
```bash
# Any Postgres 14+ instance works
createdb vigil
```

**ClickHouse** (required for event storage):
```bash
docker run -d --name clickhouse \
  -p 8123:8123 -p 9000:9000 \
  clickhouse/clickhouse-server:24-alpine
```

### 2. Start the API

```bash
cd api
pip install -r requirements.txt
cp .env.example .env              # edit DSNs if needed
make dev                          # uvicorn --reload on :8001
```

### 3. Build and install the CLI

```bash
cd cli
make build                        # produces cli/bin/vigil (or vigil.exe on Windows)
make install                      # copies to /usr/local/bin  (Linux/macOS)
```

### 4. Verify everything is connected

```bash
vigil config set api_url http://localhost:8001
vigil doctor                      # all checks should be green
```

### 5. Run the agent (Windows, requires admin)

```bash
vigil agent register --name MY-BOX   # registers endpoint, saves API key
vigil agent start                     # foreground collection
vigil agent install                   # or: install as Windows Service
```

### 6. Run the agent (Linux)

```bash
vigil agent start --profile standard  # journald + auth.log
```

---

## Stack

| Component | Technology | Purpose |
|---|---|---|
| CLI | Go + Cobra | Single static binary for users and agents |
| API | Python 3.12 + FastAPI | Backend, detection engine, alert management |
| Event DB | ClickHouse (self-hosted) | High-performance event storage and search |
| Config DB | PostgreSQL | Detection rules, alerts, endpoints |

All components are open source and self-hostable. No cloud account required.

---

## Key commands

| Command | Description |
|---|---|
| `vigil ingest` | POST a single event |
| `vigil search` | Query the event store |
| `vigil hunt` | HQL threat-hunting queries with aggregation + timeline |
| `vigil alerts list` | List active alerts |
| `vigil detections list` | List Sigma detection rules |
| `vigil forensic collect` | Point-in-time artifact sweep |
| `vigil endpoints list` | List registered endpoints |
| `vigil web start` | Launch embedded web UI |
| `vigil doctor` | Diagnose connectivity and config |

Every command accepts `--output json` for AI-agent-friendly output.

---

## Documentation

- [Installation guide](docs/installation.md)
- [Configuration reference](docs/configuration.md)
- [Multi-endpoint setup](docs/multi-endpoint.md)
- [Detection rules (Sigma)](docs/detections.md)
- [API reference](docs/api-reference.md)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture overview, how to add a collector, and the PR checklist.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
