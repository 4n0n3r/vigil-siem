//go:build !cloud

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// cloudCmd is a stub when the binary is not compiled with -tags cloud.
// It informs the user how to get cloud support.
var cloudCmd = &cobra.Command{
	Use:   "cloud",
	Short: "Collect events from cloud providers (requires -tags cloud build)",
	RunE: func(cmd *cobra.Command, args []string) error {
		output.PrintError(
			"CLOUD_NOT_COMPILED",
			"cloud collection is not available in this build",
			"recompile with: make build-cloud  (adds AWS CloudTrail, Azure Activity Log, GCP Cloud Logging)",
		)
		return nil
	},
}

func init() {
	// The start subcommand is shown in help so users know what's available.
	cloudCmd.AddCommand(&cobra.Command{
		Use:   "start",
		Short: "Start collecting from a cloud provider (requires -tags cloud build)",
		RunE:  cloudCmd.RunE,
	})
}
