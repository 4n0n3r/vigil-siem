# Onboarding: GCP Cloud Logging

## Prerequisites

| Requirement | Notes |
|---|---|
| GCP project | With Cloud Logging enabled |
| Pub/Sub topic + subscription | For log routing |
| Service Account | With Pub/Sub subscriber role |
| `vigil-cloud` binary | Built with `make build-cloud` |

## Permissions required

| Role | Scope | Purpose |
|---|---|---|
| `roles/pubsub.subscriber` | Pub/Sub subscription | Pull and acknowledge messages |
| `roles/logging.viewer` | Project (optional) | For verification only |

## Step-by-step setup

### 1. Create Pub/Sub topic and subscription

```bash
PROJECT=my-gcp-project

gcloud pubsub topics create vigil-logs --project=$PROJECT

gcloud pubsub subscriptions create vigil-logs-sub \
  --topic=vigil-logs \
  --project=$PROJECT \
  --ack-deadline=60 \
  --expiration-period=never
```

### 2. Create a Cloud Logging sink

```bash
gcloud logging sinks create vigil-sink \
  pubsub.googleapis.com/projects/$PROJECT/topics/vigil-logs \
  --log-filter='protoPayload.@type="type.googleapis.com/google.cloud.audit.AuditLog"' \
  --project=$PROJECT

# Grant the sink's service account permission to publish to the topic
SINK_SA=$(gcloud logging sinks describe vigil-sink \
  --project=$PROJECT \
  --format="value(writerIdentity)")

gcloud pubsub topics add-iam-policy-binding vigil-logs \
  --member="$SINK_SA" \
  --role=roles/pubsub.publisher \
  --project=$PROJECT
```

### 3. Create a Service Account for Vigil

```bash
gcloud iam service-accounts create vigil-collector \
  --display-name="Vigil Log Collector" \
  --project=$PROJECT

# Grant Pub/Sub subscriber role
gcloud pubsub subscriptions add-iam-policy-binding vigil-logs-sub \
  --member="serviceAccount:vigil-collector@$PROJECT.iam.gserviceaccount.com" \
  --role=roles/pubsub.subscriber \
  --project=$PROJECT

# Create and download key
gcloud iam service-accounts keys create vigil-sa-key.json \
  --iam-account="vigil-collector@$PROJECT.iam.gserviceaccount.com" \
  --project=$PROJECT
```

### 4. Configure environment

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/vigil-sa-key.json
export VIGIL_API_URL=https://your-vigil-api
```

### 5. Start collection

```bash
vigil cloud start \
  --provider gcp \
  --project $PROJECT \
  --subscription vigil-logs-sub \
  --output json
```

### 6. Verify collection

```bash
vigil search --query "gcp:logs" --limit 5 --output json
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No events | No recent GCP activity | Trigger an API call and wait 1 min |
| `PermissionDenied` | Missing subscriber role | Verify IAM binding on subscription |
| Sink not routing | Log filter too narrow | Check sink filter in Cloud Console |
| `GOOGLE_APPLICATION_CREDENTIALS` error | Wrong path | Verify file exists and is valid JSON |
| Messages accumulating | Vigil stopped mid-run | Restart — Pub/Sub ack resumes automatically |
