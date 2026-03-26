# Onboarding: Azure Activity Log

## Prerequisites

| Requirement | Notes |
|---|---|
| Azure subscription | With Activity Log |
| Storage Account | For Diagnostic Settings export |
| Service Principal | With required RBAC roles |
| `vigil-cloud` binary | Built with `make build-cloud` |

## Permissions required

| Role | Scope | Purpose |
|---|---|---|
| `Reader` | Subscription | Read subscription metadata |
| `Storage Blob Data Reader` | Storage Account | Read Activity Log blobs |

## Step-by-step setup

### 1. Create a Storage Account for logs

```bash
az storage account create \
  --name vigilactivitylogs \
  --resource-group your-rg \
  --location eastus \
  --sku Standard_LRS
```

### 2. Configure Diagnostic Settings to export Activity Log

```bash
# Get the storage account ID
STORAGE_ID=$(az storage account show \
  --name vigilactivitylogs \
  --resource-group your-rg \
  --query id -o tsv)

# Get the subscription ID
SUB_ID=$(az account show --query id -o tsv)

# Create diagnostic setting
az monitor diagnostic-settings create \
  --name vigil-activity-export \
  --resource /subscriptions/$SUB_ID \
  --storage-account $STORAGE_ID \
  --logs '[{"category":"Administrative","enabled":true},{"category":"Security","enabled":true},{"category":"Policy","enabled":true}]'
```

### 3. Create a Service Principal

```bash
az ad sp create-for-rbac \
  --name vigil-collector \
  --role "Storage Blob Data Reader" \
  --scopes /subscriptions/$SUB_ID/resourceGroups/your-rg/providers/Microsoft.Storage/storageAccounts/vigilactivitylogs

# Save: appId (CLIENT_ID), password (CLIENT_SECRET), tenant (TENANT_ID)
```

### 4. Assign Reader role on the subscription

```bash
CLIENT_ID=<appId from above>
az role assignment create \
  --assignee $CLIENT_ID \
  --role "Reader" \
  --scope /subscriptions/$SUB_ID
```

### 5. Configure environment

```bash
export AZURE_CLIENT_ID=<appId>
export AZURE_CLIENT_SECRET=<password>
export AZURE_TENANT_ID=<tenant>
export VIGIL_API_URL=https://your-vigil-api
```

### 6. Start collection

```bash
vigil cloud start \
  --provider azure \
  --subscription $SUB_ID \
  --storage-account vigilactivitylogs \
  --container insights-activity-logs \
  --output json
```

### 7. Verify collection

```bash
vigil search --query "azure:activity" --limit 5 --output json
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No events | No recent Azure activity | Perform an admin action and wait 5 min |
| `AuthorizationFailed` | Missing RBAC role | Verify `Storage Blob Data Reader` assignment |
| Empty container | Diagnostic settings not configured | Check Azure portal → Monitor → Diagnostic settings |
| Wrong container name | Default varies by region | Check storage account for actual container name |
