# vigil CLI

Command-line interface for the Vigil SIEM. Compiles to a single static binary with no runtime dependencies.

## Requirements

- Go 1.22+
- A running Vigil API (see `../api/`)

## Install

### From source

```bash
cd cli
make tidy    # downloads dependencies and generates go.sum
make build   # produces bin/vigil
make install # copies bin/vigil to /usr/local/bin/vigil
```

### Verify

```bash
vigil --help
```

## Configuration

| Method | Example |
|--------|---------|
| Environment variable | `export VIGIL_API_URL=http://localhost:8001` |
| Per-command flag | `vigil status --api-url http://my-api:8001` |

The `--api-url` flag takes precedence over the environment variable.
Default when neither is set: `http://localhost:8001`.

## Commands

### vigil ingest

Ingest a single event into Vigil.

```bash
# Table output (default)
vigil ingest --source firewall --event '{"action":"block","src_ip":"1.2.3.4"}'

# JSON output
vigil ingest --source auditd --event '{"cmd":"rm -rf /"}' --output json
```

Flags:

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--source` | yes | — | Event source identifier |
| `--event` | yes | — | Event payload as a JSON string |
| `--output` | no | `table` | `json` or `table` |

### vigil search

Search ingested events.

```bash
# Search with a query
vigil search --query "action:block"

# Time-bounded search, JSON output
vigil search --query "src_ip:1.2.3.4" \
  --from 2024-01-01T00:00:00Z \
  --to   2024-12-31T23:59:59Z \
  --limit 50 \
  --output json
```

Flags:

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--query` | no | — | Search query string |
| `--from` | no | — | Start time (RFC3339) |
| `--to` | no | — | End time (RFC3339) |
| `--limit` | no | `100` | Max events to return |
| `--output` | no | `table` | `json` or `table` |

### vigil status

Show system health.

```bash
vigil status
vigil status --output json
```

## Error handling

All errors are printed to **stderr** as structured JSON and the process exits with code 1:

```json
{
  "error_code": "CONNECTION_ERROR",
  "message": "could not reach API at http://localhost:8001",
  "detail": "..."
}
```

This makes it safe to pipe `vigil` output to downstream tools — stdout is always clean data.

## Global flags

| Flag | Description |
|------|-------------|
| `--api-url` | Override API base URL |
| `--output` | `json` or `table` (default: `table`) |
