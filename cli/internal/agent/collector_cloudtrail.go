//go:build cloud

package agent

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// CloudTrailCollector polls an S3 bucket for CloudTrail JSON log objects,
// processes each one, and emits structured events with source "cloudtrail:<region>".
// Resume: the last processed S3 object key is stored in a bookmark file.
// Auth: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY or instance role / profile.
type CloudTrailCollector struct {
	bucket       string
	region       string
	prefix       string
	bookmarkFile string
	lastKey      string
	pollInterval time.Duration
}

// NewCloudTrailCollector creates a CloudTrail S3 collector.
// bucket: the S3 bucket name where CloudTrail delivers logs.
// region: the AWS region the trail covers (used as source suffix).
// prefix: optional S3 key prefix (e.g. "AWSLogs/123456789012/CloudTrail/us-east-1/").
// bookmarkFile: path to file that stores the last processed S3 key.
func NewCloudTrailCollector(bucket, region, prefix, bookmarkFile string) *CloudTrailCollector {
	return &CloudTrailCollector{
		bucket:       bucket,
		region:       region,
		prefix:       prefix,
		bookmarkFile: bookmarkFile,
		pollInterval: 2 * time.Minute,
	}
}

func (cc *CloudTrailCollector) Name() string { return "cloudtrail:" + cc.region }

func (cc *CloudTrailCollector) Start(ctx context.Context) (<-chan Event, error) {
	cc.lastKey = cc.loadBookmark()

	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(cc.region))
	if err != nil {
		return nil, fmt.Errorf("cloudtrail: failed to load AWS config: %w", err)
	}
	client := s3.NewFromConfig(cfg)

	out := make(chan Event, 512)
	go cc.poll(ctx, client, out)
	return out, nil
}

func (cc *CloudTrailCollector) poll(ctx context.Context, client *s3.Client, out chan<- Event) {
	defer close(out)

	for {
		if err := cc.processNewObjects(ctx, client, out); err != nil {
			fmt.Fprintf(os.Stderr, "{\"error_code\":\"CLOUDTRAIL_POLL_ERROR\",\"message\":%q}\n", err.Error())
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(cc.pollInterval):
		}
	}
}

func (cc *CloudTrailCollector) processNewObjects(ctx context.Context, client *s3.Client, out chan<- Event) error {
	paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
		Bucket: aws.String(cc.bucket),
		Prefix: aws.String(cc.prefix),
	})

	var newKeys []string
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("list objects: %w", err)
		}
		for _, obj := range page.Contents {
			key := aws.ToString(obj.Key)
			if !strings.HasSuffix(key, ".json.gz") && !strings.HasSuffix(key, ".json") {
				continue
			}
			if key > cc.lastKey {
				newKeys = append(newKeys, key)
			}
		}
	}

	for _, key := range newKeys {
		if ctx.Err() != nil {
			return nil
		}
		if err := cc.processObject(ctx, client, key, out); err != nil {
			fmt.Fprintf(os.Stderr, "{\"error_code\":\"CLOUDTRAIL_OBJECT_ERROR\",\"message\":%q,\"key\":%q}\n", err.Error(), key)
			continue
		}
		cc.lastKey = key
	}
	return nil
}

func (cc *CloudTrailCollector) processObject(ctx context.Context, client *s3.Client, key string, out chan<- Event) error {
	resp, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(cc.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("get object: %w", err)
	}
	defer resp.Body.Close()

	var reader io.Reader = resp.Body
	if strings.HasSuffix(key, ".gz") {
		gr, err := gzip.NewReader(resp.Body)
		if err != nil {
			return fmt.Errorf("gzip reader: %w", err)
		}
		defer gr.Close()
		reader = gr
	}

	var payload struct {
		Records []map[string]interface{} `json:"Records"`
	}
	if err := json.NewDecoder(reader).Decode(&payload); err != nil {
		return fmt.Errorf("decode JSON: %w", err)
	}

	source := "cloudtrail:" + cc.region
	for _, record := range payload.Records {
		ev := cc.normalizeRecord(record, source)
		select {
		case out <- ev:
		case <-ctx.Done():
			return nil
		}
	}
	return nil
}

func (cc *CloudTrailCollector) normalizeRecord(record map[string]interface{}, source string) Event {
	ts := time.Now().UTC()
	if evTime, ok := record["eventTime"].(string); ok {
		if t, err := time.Parse(time.RFC3339, evTime); err == nil {
			ts = t
		}
	}

	normalized := map[string]interface{}{
		"event_id":     safeStr(record, "eventID"),
		"event_name":   safeStr(record, "eventName"),
		"event_source": safeStr(record, "eventSource"),
		"aws_region":   safeStr(record, "awsRegion"),
		"source_ip":    safeStr(record, "sourceIPAddress"),
	}

	if ui, ok := record["userIdentity"].(map[string]interface{}); ok {
		normalized["user_identity_type"] = safeStr(ui, "type")
		normalized["user_identity_arn"] = safeStr(ui, "arn")
		if un, ok := ui["userName"].(string); ok {
			normalized["user_identity_name"] = un
		}
	}

	if ec, ok := record["errorCode"].(string); ok {
		normalized["error_code_aws"] = ec
	}

	return Event{Source: source, Event: normalized, Timestamp: ts}
}

func safeStr(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func (cc *CloudTrailCollector) SaveBookmark(_ string) error {
	if err := os.MkdirAll(filepath.Dir(cc.bookmarkFile), 0o755); err != nil {
		return err
	}
	return os.WriteFile(cc.bookmarkFile, []byte(cc.lastKey), 0o644)
}

func (cc *CloudTrailCollector) loadBookmark() string {
	data, err := os.ReadFile(cc.bookmarkFile)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
