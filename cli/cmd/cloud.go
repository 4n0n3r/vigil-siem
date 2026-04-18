//go:build cloud && !agentonly

package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/agent"
	"github.com/vigil/vigil/internal/output"
)

var (
	cloudProvider       string
	cloudRegion         string
	cloudBucket         string
	cloudPrefix         string
	cloudSubscription   string
	cloudStorageAccount string
	cloudContainer      string
	cloudProject        string
)

var cloudCmd = &cobra.Command{
	Use:   "cloud",
	Short: "Collect events from cloud providers (AWS, Azure, GCP)",
	Long: `Stream events from cloud audit logs into the Vigil SIEM.

Requires vigil compiled with the 'cloud' build tag (make build-cloud).

Supported providers:
  aws    — AWS CloudTrail via S3 polling
  azure  — Azure Activity Log via Blob Storage polling
  gcp    — GCP Cloud Logging via Pub/Sub

Auth is via environment variables:
  AWS:   AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (or instance role)
  Azure: AZURE_CLIENT_ID + AZURE_CLIENT_SECRET + AZURE_TENANT_ID
  GCP:   GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)`,
}

var cloudStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start collecting from a cloud provider",
	RunE: func(cmd *cobra.Command, args []string) error {
		switch cloudProvider {
		case "aws":
			return runCloudAWS(cmd.Context())
		case "azure":
			return runCloudAzure(cmd.Context())
		case "gcp":
			return runCloudGCP(cmd.Context())
		default:
			output.PrintError("CLOUD_UNKNOWN_PROVIDER",
				fmt.Sprintf("unknown provider %q — use aws, azure, or gcp", cloudProvider), "")
			return nil
		}
	},
}

func runCloudAWS(ctx context.Context) error {
	if cloudBucket == "" {
		output.PrintError("MISSING_FLAG", "--bucket is required for AWS provider", "")
		return nil
	}
	if cloudRegion == "" {
		output.PrintError("MISSING_FLAG", "--region is required for AWS provider", "")
		return nil
	}

	agentCfg := agent.DefaultConfig()
	bookmarkFile := fmt.Sprintf("%s/cloudtrail_%s.bookmark", agentCfg.BookmarkDir, cloudRegion)

	col := agent.NewCloudTrailCollector(cloudBucket, cloudRegion, cloudPrefix, bookmarkFile)
	return runCloudCollector(ctx, col)
}

func runCloudAzure(ctx context.Context) error {
	if cloudStorageAccount == "" {
		output.PrintError("MISSING_FLAG", "--storage-account is required for Azure provider", "")
		return nil
	}
	if cloudSubscription == "" {
		output.PrintError("MISSING_FLAG", "--subscription is required for Azure provider", "")
		return nil
	}
	container := cloudContainer
	if container == "" {
		container = "insights-activity-logs"
	}

	agentCfg := agent.DefaultConfig()
	bookmarkFile := agentCfg.BookmarkDir + "/azure_activity.bookmark"

	col := agent.NewAzureActivityCollector(cloudStorageAccount, container, cloudSubscription, bookmarkFile)
	return runCloudCollector(ctx, col)
}

func runCloudGCP(ctx context.Context) error {
	if cloudProject == "" {
		output.PrintError("MISSING_FLAG", "--project is required for GCP provider", "")
		return nil
	}
	if cloudSubscription == "" {
		output.PrintError("MISSING_FLAG", "--subscription is required for GCP provider", "")
		return nil
	}

	col := agent.NewGCPLoggingCollector(cloudProject, cloudSubscription)
	return runCloudCollector(ctx, col)
}

func runCloudCollector(ctx context.Context, col agent.Collector) error {
	cfg := agent.DefaultConfig()
	a := agent.New(apiClient, cfg)
	a.AddCollector(col)

	mode := output.ParseMode(globalOutput)
	if mode == output.ModeJSON {
		output.PrintJSON(map[string]interface{}{
			"status":   "starting",
			"source":   col.Name(),
			"provider": cloudProvider,
		})
	} else {
		fmt.Printf("Starting cloud collection from %s (source: %s)\n", cloudProvider, col.Name())
		fmt.Println("Press Ctrl+C to stop.")
	}

	return a.Run(ctx)
}

func init() {
	cloudStartCmd.Flags().StringVar(&cloudProvider, "provider", "", "Cloud provider: aws, azure, or gcp (required)")
	cloudStartCmd.Flags().StringVar(&cloudRegion, "region", "us-east-1", "AWS region (used with --provider aws)")
	cloudStartCmd.Flags().StringVar(&cloudBucket, "bucket", "", "AWS S3 bucket name containing CloudTrail logs")
	cloudStartCmd.Flags().StringVar(&cloudPrefix, "prefix", "", "AWS S3 key prefix (optional)")
	cloudStartCmd.Flags().StringVar(&cloudSubscription, "subscription", "", "Azure subscription ID or GCP Pub/Sub subscription name")
	cloudStartCmd.Flags().StringVar(&cloudStorageAccount, "storage-account", "", "Azure storage account name")
	cloudStartCmd.Flags().StringVar(&cloudContainer, "container", "", "Azure blob container (default: insights-activity-logs)")
	cloudStartCmd.Flags().StringVar(&cloudProject, "project", "", "GCP project ID")
	_ = cloudStartCmd.MarkFlagRequired("provider")

	cloudCmd.AddCommand(cloudStartCmd)
}
