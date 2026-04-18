package cmd

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/client"
	"github.com/vigil/vigil/internal/config"
	"github.com/vigil/vigil/internal/output"
)

var (
	globalAPIURL string
	globalOutput string

	// globalConfig holds the loaded config file (set in PersistentPreRun).
	globalConfig config.Config

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
		// Load user config file (missing file is not an error).
		globalConfig, _ = config.Load(config.DefaultConfigPath())

		// Also load machine-wide config (ProgramData on Windows) — used by the
		// Windows Service which runs as LocalSystem and cannot access APPDATA.
		// Machine config fills in any fields that are blank in the user config.
		if machPath := config.MachineConfigPath(); machPath != "" {
			if machCfg, err := config.Load(machPath); err == nil {
				if globalConfig.APIURL == "" {
					globalConfig.APIURL = machCfg.APIURL
				}
				if globalConfig.APIKey == "" {
					globalConfig.APIKey = machCfg.APIKey
				}
				if globalConfig.EndpointID == "" {
					globalConfig.EndpointID = machCfg.EndpointID
				}
				if globalConfig.EndpointName == "" {
					globalConfig.EndpointName = machCfg.EndpointName
				}
			}
		}

		// Resolve API URL: flag > env > config > default.
		baseURL := globalAPIURL
		if baseURL == "" {
			baseURL = os.Getenv("VIGIL_API_URL")
		}
		if baseURL == "" {
			baseURL = globalConfig.APIURL
		}
		if baseURL == "" {
			baseURL = "http://localhost:8001"
		}

		// Resolve API key: env > config (user then machine).
		apiKey := os.Getenv("VIGIL_API_KEY")
		if apiKey == "" {
			apiKey = globalConfig.APIKey
		}

		apiClient = client.New(baseURL, apiKey)
		apiClient.AdminKey = os.Getenv("VIGIL_ADMIN_KEY")
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

	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(configCmd)
	rootCmd.AddCommand(doctorCmd)
}
