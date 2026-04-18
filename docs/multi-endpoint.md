# Multi-Endpoint Setup

## Architecture

```
  ┌─────────────────────────────────────────────────────────────┐
  │                        Vigil API                            │
  │                                                             │
  │  POST /v1/endpoints/register  ←──── vigil agent register   │
  │  POST /v1/events/batch        ←──── vigil agent start       │
  │  PATCH /v1/endpoints/{id}/heartbeat  (on each batch flush)  │
  │                                                             │
  │  GET  /v1/endpoints           ←──── vigil endpoints list    │
  │  GET  /v1/events/search?endpoint_id=...                     │
  │  GET  /v1/alerts?endpoint_id=...                            │
  └─────────────────────────────────────────────────────────────┘
          ▲              ▲              ▲
          │              │              │
   WORKSTATION-1   WORKSTATION-2   LINUX-SERVER
```

Each endpoint has:
- A **UUID** (`endpoint_id`) — stable identifier
- An **API key** (`vig_...`) — presented on every request
- A **last_seen** timestamp — updated on every batch flush

---

## Registration flow

1. On a new endpoint, run:
   ```bash
   vigil agent register --name HOSTNAME
   ```
2. The API creates an endpoint record and returns a one-time API key.
3. The CLI saves the key to `~/.config/vigil/config.yaml` (or `%APPDATA%\vigil\config.yaml`).
4. All subsequent requests include `X-Vigil-Key: vig_...` automatically.

**The API key is shown only once.** Save it. If lost, register a new endpoint.

---

## Enabling authentication

By default, authentication is disabled (all endpoints are public). To require keys:

```bash
# In api/.env
VIGIL_REQUIRE_AUTH=true
```

Then restart the API. Public endpoints that remain accessible without a key:
- `GET /v1/status`
- `POST /v1/endpoints/register`

---

## Per-endpoint filtering

Filter events and alerts by endpoint:

```bash
# Events from a specific endpoint
vigil search --endpoint <endpoint_id> --output json

# Alerts from a specific endpoint
vigil alerts list --endpoint <endpoint_id> --output json

# Hunt on a specific endpoint
vigil hunt --query "event_id:4625" --endpoint <endpoint_id> --output json
```

---

## Key rotation

There is no in-place key rotation. To rotate:

1. Register a new endpoint with the same name:
   ```bash
   vigil agent register --name HOSTNAME
   ```
2. Update any scripts or systemd units that reference the old key.
3. The old endpoint record will remain but stop receiving events.

---

## Listing endpoints

```bash
vigil endpoints list --output json
# → {"endpoints":[{"id":"...","name":"...","hostname":"...","os":"...","last_seen":"..."}],"total":N}

vigil endpoints get <id> --output json
```
