//go:build cloud

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"cloud.google.com/go/pubsub"
)

// GCPLoggingCollector pulls log entries from a GCP Pub/Sub subscription,
// emitting structured events with source "gcp:logs".
// Resume: Pub/Sub ack-based delivery handles exactly-once semantics natively.
// Auth: GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON.
type GCPLoggingCollector struct {
	projectID    string
	subscription string
}

// NewGCPLoggingCollector creates a GCP Cloud Logging collector.
// projectID: the GCP project ID.
// subscription: the Pub/Sub subscription name (short name, not full path).
func NewGCPLoggingCollector(projectID, subscription string) *GCPLoggingCollector {
	return &GCPLoggingCollector{
		projectID:    projectID,
		subscription: subscription,
	}
}

func (gc *GCPLoggingCollector) Name() string { return "gcp:logs" }

func (gc *GCPLoggingCollector) Start(ctx context.Context) (<-chan Event, error) {
	client, err := pubsub.NewClient(ctx, gc.projectID)
	if err != nil {
		return nil, fmt.Errorf("gcp: failed to create pubsub client: %w", err)
	}

	sub := client.Subscription(gc.subscription)

	// Verify the subscription exists.
	ok, err := sub.Exists(ctx)
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("gcp: checking subscription: %w", err)
	}
	if !ok {
		client.Close()
		return nil, fmt.Errorf("gcp: subscription %q does not exist in project %q", gc.subscription, gc.projectID)
	}

	out := make(chan Event, 512)
	go gc.receive(ctx, client, sub, out)
	return out, nil
}

func (gc *GCPLoggingCollector) receive(ctx context.Context, client *pubsub.Client, sub *pubsub.Subscription, out chan<- Event) {
	defer close(out)
	defer client.Close()

	err := sub.Receive(ctx, func(ctx context.Context, msg *pubsub.Message) {
		ev, err := gc.normalizeMessage(msg.Data)
		if err != nil {
			fmt.Fprintf(os.Stderr, "{\"error_code\":\"GCP_DECODE_ERROR\",\"message\":%q}\n", err.Error())
			msg.Nack()
			return
		}
		select {
		case out <- ev:
			msg.Ack()
		case <-ctx.Done():
			msg.Nack()
		}
	})
	if err != nil && ctx.Err() == nil {
		fmt.Fprintf(os.Stderr, "{\"error_code\":\"GCP_RECEIVE_ERROR\",\"message\":%q}\n", err.Error())
	}
}

// logEntry is the minimal GCP LogEntry structure we parse.
type logEntry struct {
	LogName  string          `json:"logName"`
	Severity string          `json:"severity"`
	Timestamp string         `json:"timestamp"`
	Resource struct {
		Type string            `json:"type"`
	} `json:"resource"`
	ProtoPayload *json.RawMessage `json:"protoPayload,omitempty"`
	JSONPayload  *json.RawMessage `json:"jsonPayload,omitempty"`
	TextPayload  string           `json:"textPayload,omitempty"`
	Labels       map[string]string `json:"labels,omitempty"`
}

func (gc *GCPLoggingCollector) normalizeMessage(data []byte) (Event, error) {
	var entry logEntry
	if err := json.Unmarshal(data, &entry); err != nil {
		return Event{}, fmt.Errorf("decode log entry: %w", err)
	}

	ts := time.Now().UTC()
	if entry.Timestamp != "" {
		if t, err := time.Parse(time.RFC3339Nano, entry.Timestamp); err == nil {
			ts = t
		}
	}

	normalized := map[string]interface{}{
		"log_name":      entry.LogName,
		"severity":      entry.Severity,
		"resource_type": entry.Resource.Type,
		"project_id":    gc.projectID,
	}

	// Extract audit log fields from protoPayload if present.
	if entry.ProtoPayload != nil {
		var audit map[string]interface{}
		if err := json.Unmarshal(*entry.ProtoPayload, &audit); err == nil {
			if mn, ok := audit["methodName"].(string); ok {
				normalized["method_name"] = mn
			}
			if pe, ok := audit["authenticationInfo"].(map[string]interface{}); ok {
				if email, ok := pe["principalEmail"].(string); ok {
					normalized["principal_email"] = email
				}
			}
			if ri, ok := audit["requestMetadata"].(map[string]interface{}); ok {
				if ip, ok := ri["callerIp"].(string); ok {
					normalized["caller_ip"] = ip
				}
			}
			if status, ok := audit["status"].(map[string]interface{}); ok {
				if code, ok := status["code"].(float64); ok {
					normalized["status_code"] = int(code)
				}
			}
		}
	}

	return Event{Source: "gcp:logs", Event: normalized, Timestamp: ts}, nil
}

// SaveBookmark is a no-op — Pub/Sub ack handles resume natively.
func (gc *GCPLoggingCollector) SaveBookmark(_ string) error { return nil }
