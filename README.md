# Vigil

**CLI-first SIEM for AI agents.** Ingest, detect, hunt, and investigate — all via `--output json`.
Built to be driven by Claude, GPT-4, or any agent that can run a shell command.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](docs/installation.md)

---

## Self-hosted vs Vigil Cloud

| Self-hosted (this repo) | Vigil Cloud *(coming soon)* |
|---|---|
| Unlimited endpoints, unlimited events | Managed ClickHouse + PostgreSQL |
| Wazuh + Elastic connectors | HITL approval engine (Slack/email/Teams) |
| All Sigma detection rules | Splunk + Sentinel connectors |
| Full SIEM + Connect mode in one binary | Multi-user RBAC + SSO |
| Apache 2.0 | Compliance exports (SOC2/ISO27001) |

**[Join the Vigil Cloud waitlist →](https://vigil.so)**

---

## 5-minute quickstart (Docker)

```bash
git clone https://github.com/4n0n3r/vigil.git
cd vigil
docker-compose -f api/docker-compose.yml up -d

cd cli && make build
./bin/vigil doctor        # all checks green = ready
```

That's it. ClickHouse + PostgreSQL run in Docker with persistent volumes.
Events are stored in ClickHouse. Detection rules and alerts in PostgreSQL.

For production (auth enforced, no hot-reload):

```bash
make prod-up
```

---

## Using Vigil with Claude Code or any AI agent

Install the Vigil skill into your Claude Code project:

```bash
npx @vigil/skill
```

Then talk to Claude:

```
"Triage the current alerts"
"Hunt for brute-force activity in the last 6 hours"
"Deploy this Sigma rule and verify it fires"
"Connect to our Wazuh instance at wazuh.internal"
```

Claude reads `AGENT.md` and runs the right `vigil` commands with `--output json`.
No prompt engineering required. Every command returns structured data the agent can reason about directly.

---

## Key commands

| Command | What it does |
|---|---|
| `vigil ingest` | POST a single event |
| `vigil search` | Substring search across the event store |
| `vigil hunt` | HQL threat-hunting with aggregation + timeline |
| `vigil alerts list` | List open alerts by severity |
| `vigil detections create` | Deploy a Sigma detection rule |
| `vigil forensic collect` | Point-in-time artifact sweep (Windows + Linux) |
| `vigil endpoints list` | List registered endpoints |
| `vigil connector add wazuh` | Connect to a Wazuh deployment |
| `vigil feed alerts` | Unified alert stream from all connected SIEMs |
| `vigil web start` | Launch the embedded web dashboard |
| `vigil doctor` | Diagnose connectivity and config |

Every command accepts `--output json`.

---

## Two modes, one binary

**SIEM mode** — deploy Vigil from scratch.
No existing infrastructure required. One binary on each endpoint. Full log storage and search.

```bash
vigil agent register --name my-server
vigil agent start --profile standard
vigil alerts list --severity high --output json
```

**Connect mode** — point Vigil at a SIEM you already run.
No new agents on endpoints. API-only. Works today with Wazuh and Elastic Security.

```bash
vigil connector add wazuh --name prod --indexer-url https://wazuh:9200 \
  --indexer-user admin --indexer-pass <pass>
vigil feed alerts --severity high --since 1h --output json
```

---

## Stack

| Component | Technology | Purpose |
|---|---|---|
| CLI | Go + Cobra | Single static binary for users and agents |
| API | Python 3.12 + FastAPI | Detection engine, alert management, connector layer |
| Event DB | ClickHouse | High-performance event storage and search |
| Config DB | PostgreSQL | Detection rules, alerts, endpoints, connectors |

---

## Testing and detection coverage

Run the full detection stress test against a local API instance:

```bash
pip install requests
VIGIL_API_URL=http://localhost:8001 VIGIL_API_KEY=<key> python detection_stress_test.py
```

This runs 9 phases covering credential access, execution, persistence, defense evasion,
privilege escalation, lateral movement, and web attacks — both positive (must fire) and
negative (must not fire) assertions. Reports a detection coverage score at the end.

For live attack simulation against a Windows test VM (requires WinRM):

```bash
# Edit TARGET/USER/PASS in attack_runner.py first
python attack_runner.py
```

---

## Documentation

- [Installation guide](docs/installation.md)
- [Configuration reference](docs/configuration.md)
- [SIEM connector setup](docs/connectors.md)
- [Connect mode quickstart](docs/connect-quickstart.md)
- [Detection rules (Sigma)](docs/detections.md)
- [Multi-endpoint setup](docs/multi-endpoint.md)
- [API reference](docs/api-reference.md)
- [Agent reference (AGENT.md)](AGENT.md) — read this if you are an AI agent

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture overview, how to add a collector,
how to add a SIEM connector, and the PR checklist.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
