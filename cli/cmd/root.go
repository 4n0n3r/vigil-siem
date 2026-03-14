package cmd

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/client"
	"github.com/vigil/vigil/internal/output"
)

var (
	globalAPIURL string
	globalOutput string

	// apiClient is initialised in PersistentPreRun so every subcommand gets it.
	apiClient *client.Client
)

var rootCmd = &cobra.Command{
	Use:   "vigil",
	Short: "Vigil — CLI-first SIEM for AI agents",
	Long: `Vigil is a CLI-first SIEM built for AI agents and humans alike.

Every command supports --output json for machine-readable output.
Set VIGIL_API_URL to point at your Vigil API instance.`,
	// Silence default error output — we print structured JSON ourselves.
	SilenceErrors: true,
	SilenceUsage:  true,
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		// Resolve API URL: flag > env > default.
		baseURL := globalAPIURL
		if baseURL == "" {
			baseURL = os.Getenv("VIGIL_API_URL")
		}
		if baseURL == "" {
			baseURL = "http://localhost:8001"
		}
		apiClient = client.New(baseURL)
	},
}

// Execute is the entry point called from main.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		output.PrintError("COMMAND_ERROR", err.Error(), "")
	}
}

func init() {
	rootCmd.PersistentFlags().StringVar(
		&globalAPIURL, "api-url", "",
		"Vigil API base URL (overrides VIGIL_API_URL env var, default: http://localhost:8001)",
	)
	rootCmd.PersistentFlags().StringVar(
		&globalOutput, "output", "table",
		"Output format: json|table",
	)

	rootCmd.AddCommand(ingestCmd)
	rootCmd.AddCommand(searchCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(agentCmd)
	rootCmd.AddCommand(detectionsCmd)
	rootCmd.AddCommand(alertsCmd)
}
