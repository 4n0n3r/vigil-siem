# Onboarding: AWS CloudTrail

## Prerequisites

| Requirement | Notes |
|---|---|
| CloudTrail enabled | Multi-region trail recommended |
| S3 bucket for logs | Configured in CloudTrail settings |
| IAM credentials | See permissions table below |
| `vigil-cloud` binary | Built with `make build-cloud` |

## Permissions required

| Permission | Minimum | Recommended |
|---|---|---|
| `s3:ListBucket` | On CloudTrail bucket | Yes |
| `s3:GetObject` | On CloudTrail bucket prefix | Yes |
| `s3:GetBucketLocation` | On CloudTrail bucket | Yes |

### Minimum IAM policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::your-cloudtrail-bucket",
        "arn:aws:s3:::your-cloudtrail-bucket/*"
      ]
    }
  ]
}
```

## Step-by-step setup

### 1. Enable CloudTrail

```bash
aws cloudtrail create-trail \
  --name vigil-trail \
  --s3-bucket-name your-cloudtrail-bucket \
  --is-multi-region-trail \
  --enable-log-file-validation

aws cloudtrail start-logging --name vigil-trail
```

### 2. Create an IAM user for Vigil (or use an instance role)

```bash
aws iam create-user --user-name vigil-collector
aws iam put-user-policy \
  --user-name vigil-collector \
  --policy-name VIGILCloudTrailRead \
  --policy-document file://vigil-iam-policy.json

aws iam create-access-key --user-name vigil-collector
# Save the AccessKeyId and SecretAccessKey
```

### 3. Configure environment

```bash
export AWS_ACCESS_KEY_ID=<AccessKeyId>
export AWS_SECRET_ACCESS_KEY=<SecretAccessKey>
export VIGIL_API_URL=https://your-vigil-api
```

### 4. Start collection

```bash
vigil cloud start \
  --provider aws \
  --region us-east-1 \
  --bucket your-cloudtrail-bucket \
  --output json
```

The collector polls S3 every 2 minutes. Initial run processes the most recent 24 hours of logs.

### 5. Verify collection

Wait approximately 2 minutes after any AWS activity, then:

```bash
vigil search --query "cloudtrail:" --limit 5 --output json
vigil status --output json
# Check events_last_24h
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No events after 5 minutes | No recent AWS activity | Trigger an API call (e.g. `aws s3 ls`) and wait |
| `AccessDenied` errors | IAM policy too restrictive | Verify `s3:ListBucket` and `s3:GetObject` both granted |
| Region mismatch | Trail in different region | Use `--region` matching the trail's region |
| Duplicate events on restart | Expected behaviour | Bookmark file tracks last processed key |
| `CONNECTION_ERROR` | Vigil API unreachable | Check `VIGIL_API_URL`, run `vigil doctor` |
