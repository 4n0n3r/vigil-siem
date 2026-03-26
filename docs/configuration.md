# Configuration

## Environment variables (API)

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLICKHOUSE_DSN` | No | — | ClickHouse connection string. Falls back to in-memory storage if absent. |
| `POSTGRES_DSN` | Yes* | — | PostgreSQL connection string. Alerts and detections are disabled without it. |
| `VIGIL_REQUIRE_AUTH` | No | `false` | Set to `true` to require `X-Vigil-Key` on all non-public endpoints. |
| `VIGIL_LOG_LEVEL` | No | `info` | API log verbosity: `debug`, `info`, `warning`, `error`. |

*Postgres is technically optional; the API starts without it but all alert/detection endpoints return 503.

### DSN formats

**ClickHouse:**
```
clickhouses://user:password@host:8443/database
clickhouse://user:password@host:9000/database
```

**PostgreSQL:**
```
postgresql://user:password@host:5432/vigil
```

---

## Environment variables (CLI / agent)

| Variable | Description |
|---|---|
| `VIGIL_API_URL` | Base URL of the Vigil API. Overrides config file. |
| `VIGIL_API_KEY` | API key for authentication. Overrides config file. |

---

## Config file

The CLI stores persistent settings in a YAML file:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\vigil\config.yaml` |
| Linux / macOS | `~/.config/vigil/config.yaml` |

### Format

```yaml
api_url: http://localhost:8001
api_key: vig_abc123...
endpoint_id: 550e8400-e29b-41d4-a716-446655440000
endpoint_name: MY-WORKSTATION
```

### Key management

```bash
vigil config set api_url http://my-vigil-server:8001
vigil config set api_key vig_abc123...
vigil config get             # show all values
vigil config get api_url     # show a single key
```

Valid keys: `api_url`, `api_key`, `endpoint_id`, `endpoint_name`.

---

## Priority resolution

For `api_url`:
1. `--api-url` CLI flag
2. `VIGIL_API_URL` environment variable
3. `api_url` in config file
4. Default: `http://localhost:8001`

For `api_key`:
1. `VIGIL_API_KEY` environment variable
2. `api_key` in config file

---

## Storage backend options

### ClickHouse (recommended for production)

- All events are stored in a `vigil_events` MergeTree table.
- Monthly partitioning. ngrambf index for full-text search.
- The `endpoint_id` column is added automatically on first startup.

### In-memory fallback

- Used when `CLICKHOUSE_DSN` is not set.
- Events are stored in a Python list (lost on restart).
- Useful for development and testing.

---

## Production checklist

- [ ] `VIGIL_REQUIRE_AUTH=true` — enable auth and register all agents via `vigil agent register`
- [ ] `VIGIL_LOG_LEVEL=info` — avoid `debug` in production (verbose, impacts performance)
- [ ] Reverse proxy (nginx / Caddy) in front of port 8001 for TLS termination
- [ ] Postgres and ClickHouse ports not exposed externally — use `make prod-up` (`docker-compose.prod.yml` handles this)
- [ ] `api/.env` not committed to version control (`.gitignore` covers this)
- [ ] Backup strategy for `postgres_data` and `clickhouse_data` Docker volumes

Need managed infrastructure, backups, and HA out of the box? → **[Vigil Cloud](https://vigil.so)**

---

## api/.env.example

```
CLICKHOUSE_DSN=clickhouses://default:password@host:8443/default
POSTGRES_DSN=postgresql://vigil:password@localhost:5432/vigil
VIGIL_REQUIRE_AUTH=false  # set true to require X-Vigil-Key on all endpoints
```
