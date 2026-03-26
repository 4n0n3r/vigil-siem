# Skill: onboard

**Trigger:** "onboard", "set up collection", "add this host", "connect AWS", "connect Azure", "connect GCP", "add Linux host", "add Windows server"

**Goal:** Register the system and verify that events are flowing into the SIEM.

---

## Prerequisites (all platforms)

```bash
vigil status --output json
```

Confirm: `api_status:"ok"`. If not, fix connectivity before continuing.

---

## Linux endpoint

### Prerequisites
- `vigil` binary installed on the target host (download from releases or `make build`)
- `VIGIL_API_URL` set to your Vigil API address
- Root or sudo access for full profile coverage

### Setup

```bash
# 1. Register the endpoint and save credentials to config.
vigil agent register --name "$(hostname)" --output json
# Saves api_key and endpoint_id to ~/.config/vigil/config.yaml

# 2. Start the agent in foreground to verify event flow.
vigil agent start --profile standard --output json
# Ctrl+C after a few seconds

# 3. Confirm events are arriving in the SIEM.
vigil search --query "journald:" --limit 5 --output json

# 4. (Optional) Install as a systemd service for persistent collection.
# See docs/onboarding/linux_endpoint.md for systemd unit file.
```

**Profile guidance:**
- `minimal` — journald only, low overhead
- `standard` — journald + auth.log + /var/log/secure (recommended)
- `full` — + syslog + auditd (requires root)

---

## Windows server

### Prerequisites
- `vigil.exe` installed on the target (run as Administrator)
- `VIGIL_API_URL` set to your Vigil API address
- Sysmon installed (recommended: SwiftOnSecurity config)

### Setup

```bash
# 1. Register the endpoint.
vigil agent register --name "$(hostname)" --output json

# 2. Start in foreground to verify.
vigil agent start --profile standard --output json
# Ctrl+C after a few seconds

# 3. Confirm events.
vigil search --query "winlog:" --limit 5 --output json

# 4. Install as Windows Service.
vigil agent install --output json

# 5. Check service health.
vigil agent status --output json
```

---

## AWS (CloudTrail)

### Prerequisites
- CloudTrail enabled with S3 delivery (multi-region recommended)
- IAM credentials with `s3:GetObject` + `s3:ListBucket` on the CloudTrail bucket
- `vigil` compiled with cloud tag: `make build-cloud`

### Setup

```bash
# Set credentials (or use instance role / AWS profile).
export AWS_ACCESS_KEY_ID=<key>
export AWS_SECRET_ACCESS_KEY=<secret>
export VIGIL_API_URL=https://your-vigil-api

# 1. Confirm API is reachable.
vigil status --output json

# 2. Start CloudTrail collection.
vigil cloud start --provider aws \
  --region us-east-1 \
  --bucket my-cloudtrail-bucket \
  --output json

# 3. Wait ~2 minutes (S3 delivery lag), then verify.
vigil search --query "cloudtrail:" --limit 5 --output json
```

See `docs/onboarding/aws.md` for IAM policy JSON and troubleshooting.

---

## Azure (Activity Log)

### Prerequisites
- Azure Diagnostic Settings configured to export Activity Log to a Storage Account
- Service principal with `Storage Blob Data Reader` + `Reader` on the subscription
- `vigil` compiled with cloud tag: `make build-cloud`

### Setup

```bash
export AZURE_CLIENT_ID=<client-id>
export AZURE_CLIENT_SECRET=<client-secret>
export AZURE_TENANT_ID=<tenant-id>
export VIGIL_API_URL=https://your-vigil-api

vigil status --output json

vigil cloud start --provider azure \
  --subscription <subscription-id> \
  --storage-account <storage-account-name> \
  --container insights-activity-logs \
  --output json

vigil search --query "azure:activity" --limit 5 --output json
```

See `docs/onboarding/azure.md` for full setup steps.

---

## GCP (Cloud Logging)

### Prerequisites
- Cloud Logging sink routing to a Pub/Sub topic
- Service account with `roles/pubsub.subscriber` on the subscription
- `GOOGLE_APPLICATION_CREDENTIALS` pointing to service account JSON
- `vigil` compiled with cloud tag: `make build-cloud`

### Setup

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json
export VIGIL_API_URL=https://your-vigil-api

vigil status --output json

vigil cloud start --provider gcp \
  --project my-gcp-project \
  --subscription vigil-logs-sub \
  --output json

vigil search --query "gcp:logs" --limit 5 --output json
```

See `docs/onboarding/gcp.md` for Pub/Sub sink setup commands.

---

## Verify collection (all platforms)

```bash
vigil status --output json
# events_last_24h should be non-zero

vigil alerts list --status open --output json
# Check for any alerts fired by the new source
```
