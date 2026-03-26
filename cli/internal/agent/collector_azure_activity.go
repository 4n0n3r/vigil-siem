//go:build cloud

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"
)

// AzureActivityCollector polls an Azure Blob Storage container for Activity Log
// JSON blobs and emits structured events with source "azure:activity".
// Resume: the last processed blob timestamp is stored in a bookmark file.
// Auth: AZURE_CLIENT_ID + AZURE_CLIENT_SECRET + AZURE_TENANT_ID env vars.
type AzureActivityCollector struct {
	storageAccount string
	container      string
	subscriptionID string
	bookmarkFile   string
	lastTimestamp  string
	pollInterval   time.Duration
}

// NewAzureActivityCollector creates an Azure Activity Log collector.
func NewAzureActivityCollector(storageAccount, container, subscriptionID, bookmarkFile string) *AzureActivityCollector {
	return &AzureActivityCollector{
		storageAccount: storageAccount,
		container:      container,
		subscriptionID: subscriptionID,
		bookmarkFile:   bookmarkFile,
		pollInterval:   5 * time.Minute,
	}
}

func (ac *AzureActivityCollector) Name() string { return "azure:activity" }

func (ac *AzureActivityCollector) Start(ctx context.Context) (<-chan Event, error) {
	ac.lastTimestamp = ac.loadBookmark()

	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, fmt.Errorf("azure: failed to create credential: %w", err)
	}

	serviceURL := fmt.Sprintf("https://%s.blob.core.windows.net/", ac.storageAccount)
	client, err := azblob.NewClient(serviceURL, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("azure: failed to create blob client: %w", err)
	}

	out := make(chan Event, 512)
	go ac.poll(ctx, client, out)
	return out, nil
}

func (ac *AzureActivityCollector) poll(ctx context.Context, client *azblob.Client, out chan<- Event) {
	defer close(out)

	for {
		if err := ac.processNewBlobs(ctx, client, out); err != nil {
			fmt.Fprintf(os.Stderr, "{\"error_code\":\"AZURE_POLL_ERROR\",\"message\":%q}\n", err.Error())
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(ac.pollInterval):
		}
	}
}

func (ac *AzureActivityCollector) processNewBlobs(ctx context.Context, client *azblob.Client, out chan<- Event) error {
	pager := client.NewListBlobsFlatPager(ac.container, nil)

	var newBlobs []string
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("list blobs: %w", err)
		}
		for _, blob := range page.Segment.BlobItems {
			if blob.Name == nil {
				continue
			}
			name := *blob.Name
			if !strings.HasSuffix(name, ".json") {
				continue
			}
			if name > ac.lastTimestamp {
				newBlobs = append(newBlobs, name)
			}
		}
	}

	for _, name := range newBlobs {
		if ctx.Err() != nil {
			return nil
		}
		if err := ac.processBlob(ctx, client, name, out); err != nil {
			fmt.Fprintf(os.Stderr, "{\"error_code\":\"AZURE_BLOB_ERROR\",\"message\":%q,\"blob\":%q}\n", err.Error(), name)
			continue
		}
		ac.lastTimestamp = name
	}
	return nil
}

func (ac *AzureActivityCollector) processBlob(ctx context.Context, client *azblob.Client, name string, out chan<- Event) error {
	resp, err := client.DownloadStream(ctx, ac.container, name, nil)
	if err != nil {
		return fmt.Errorf("download blob: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read blob: %w", err)
	}

	// Azure Activity Log blobs may be wrapped in {"records": [...]} or be a bare array.
	var records []map[string]interface{}
	var wrapper struct {
		Records []map[string]interface{} `json:"records"`
	}
	if err := json.Unmarshal(data, &wrapper); err == nil && len(wrapper.Records) > 0 {
		records = wrapper.Records
	} else if err := json.Unmarshal(data, &records); err != nil {
		return fmt.Errorf("decode blob JSON: %w", err)
	}

	for _, record := range records {
		ev := ac.normalizeRecord(record)
		select {
		case out <- ev:
		case <-ctx.Done():
			return nil
		}
	}
	return nil
}

func (ac *AzureActivityCollector) normalizeRecord(record map[string]interface{}) Event {
	ts := time.Now().UTC()
	if evTime, ok := record["time"].(string); ok {
		if t, err := time.Parse(time.RFC3339, evTime); err == nil {
			ts = t
		}
	}

	props := map[string]interface{}{}
	if p, ok := record["properties"].(map[string]interface{}); ok {
		props = p
	}

	normalized := map[string]interface{}{
		"operation_name":  safeStrMap(record, "operationName"),
		"resource_id":     safeStrMap(record, "resourceId"),
		"status":          safeStrMap(record, "status"),
		"caller":          safeStrMap(props, "caller"),
		"caller_ip":       safeStrMap(props, "httpRequest.clientIpAddress"),
		"subscription_id": ac.subscriptionID,
		"category":        safeStrMap(record, "category"),
	}

	// Extract resource group from resource ID.
	if rg := extractResourceGroup(normalized["resource_id"].(string)); rg != "" {
		normalized["resource_group"] = rg
	}

	return Event{Source: "azure:activity", Event: normalized, Timestamp: ts}
}

func safeStrMap(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func extractResourceGroup(resourceID string) string {
	parts := strings.Split(strings.ToLower(resourceID), "/")
	for i, p := range parts {
		if p == "resourcegroups" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func (ac *AzureActivityCollector) SaveBookmark(_ string) error {
	if err := os.MkdirAll(filepath.Dir(ac.bookmarkFile), 0o755); err != nil {
		return err
	}
	return os.WriteFile(ac.bookmarkFile, []byte(ac.lastTimestamp), 0o644)
}

func (ac *AzureActivityCollector) loadBookmark() string {
	data, err := os.ReadFile(ac.bookmarkFile)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
