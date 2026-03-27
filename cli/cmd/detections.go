//go:build !agentonly

package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// ----------------------------------------------------------------------------
// Response types
// ----------------------------------------------------------------------------

type detectionRule struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Severity    string `json:"severity"`
	MitreTactic string `json:"mitre_tactic"`
	SigmaYAML   string `json:"sigma_yaml"`
	Enabled     bool   `json:"enabled"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type detectionListResponse struct {
	Rules []detectionRule `json:"rules"`
	Total int             `json:"total"`
}

// ----------------------------------------------------------------------------
// Flag vars
// ----------------------------------------------------------------------------

var (
	detectionsListEnabled  string // "true", "false", or "" (all)
	detectionsListSeverity string
	detectionsListLimit    int

	detectionsCreateFile     string
	detectionsCreateSeverity string
	detectionsCreateEnabled  bool

	detectionsDeleteConfirm bool
)

// ----------------------------------------------------------------------------
// Parent command: vigil detections
// ----------------------------------------------------------------------------

var detectionsCmd = &cobra.Command{
	Use:   "detections",
	Short: "Manage Sigma detection rules",
	Long: `Manage Sigma detection rules stored in Vigil.

Subcommands:
  list      List all detection rules
  get       Get a single detection rule by ID
  create    Upload a new Sigma YAML rule
  enable    Enable a detection rule
  disable   Disable a detection rule
  delete    Delete a detection rule (requires --confirm)`,
}

// ----------------------------------------------------------------------------
// vigil detections list
// ----------------------------------------------------------------------------

var detectionsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List detection rules",
	RunE: func(cmd *cobra.Command, args []string) error {
		params := map[string]string{
			"limit": fmt.Sprintf("%d", detectionsListLimit),
		}
		if detectionsListSeverity != "" {
			params["severity"] = detectionsListSeverity
		}
		// Only send enabled param when the flag was explicitly set.
		if cmd.Flags().Changed("enabled") {
			params["enabled"] = detectionsListEnabled
		}

		var resp detectionListResponse
		if err := apiClient.Get("/v1/detections", params, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		t := output.NewTable([]string{"ID", "Name", "Severity", "Enabled", "MITRE Tactic", "Created"})
		for _, r := range resp.Rules {
			id := r.ID
			if len(id) > 8 {
				id = id[:8]
			}
			enabled := "false"
			if r.Enabled {
				enabled = "true"
			}
			t.Append([]string{id, r.Name, r.Severity, enabled, r.MitreTactic, r.CreatedAt})
		}
		t.Render()
		fmt.Printf("\nTotal: %d\n", resp.Total)
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil detections get <id>
// ----------------------------------------------------------------------------

var detectionsGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get a detection rule by ID",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]

		var resp detectionRule
		if err := apiClient.Get("/v1/detections/"+id, nil, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		sigma := resp.SigmaYAML
		if len(sigma) > 120 {
			sigma = sigma[:120] + "..."
		}

		enabled := "false"
		if resp.Enabled {
			enabled = "true"
		}

		t := output.NewTable([]string{"Field", "Value"})
		t.Append([]string{"ID", resp.ID})
		t.Append([]string{"Name", resp.Name})
		t.Append([]string{"Description", resp.Description})
		t.Append([]string{"Severity", resp.Severity})
		t.Append([]string{"MITRE Tactic", resp.MitreTactic})
		t.Append([]string{"Enabled", enabled})
		t.Append([]string{"Created At", resp.CreatedAt})
		t.Append([]string{"Updated At", resp.UpdatedAt})
		t.Append([]string{"Sigma YAML", sigma})
		t.Render()
		fmt.Println()
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil detections create
// ----------------------------------------------------------------------------

// parseSigmaField does a simple line scan for a top-level YAML key, e.g.
// "title:" or "description:", and returns the trimmed value on that line.
// No external YAML library is used — this is intentionally minimal.
func parseSigmaField(yaml, key string) string {
	prefix := key + ":"
	for _, line := range strings.Split(yaml, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, prefix) {
			value := strings.TrimPrefix(trimmed, prefix)
			return strings.TrimSpace(value)
		}
	}
	return ""
}

type detectionCreateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	SigmaYAML   string `json:"sigma_yaml"`
	Severity    string `json:"severity,omitempty"`
	Enabled     bool   `json:"enabled"`
}

var detectionsCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Upload a new Sigma YAML detection rule",
	RunE: func(cmd *cobra.Command, args []string) error {
		if detectionsCreateFile == "" {
			output.PrintError("MISSING_FLAG", "--file is required", "provide a path to a Sigma YAML file")
			return nil
		}

		data, err := os.ReadFile(detectionsCreateFile)
		if err != nil {
			output.PrintError("FILE_READ_ERROR", "could not read Sigma YAML file", err.Error())
			return nil
		}

		yamlContent := string(data)

		name := parseSigmaField(yamlContent, "title")
		if name == "" {
			name = detectionsCreateFile // fallback to filename
		}
		description := parseSigmaField(yamlContent, "description")

		body := detectionCreateRequest{
			Name:        name,
			Description: description,
			SigmaYAML:   yamlContent,
			Severity:    detectionsCreateSeverity,
			Enabled:     detectionsCreateEnabled,
		}

		var resp detectionRule
		if err := apiClient.Post("/v1/detections", body, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		t := output.NewTable([]string{"Field", "Value"})
		t.Append([]string{"ID", resp.ID})
		t.Append([]string{"Name", resp.Name})
		t.Render()
		fmt.Println()
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil detections enable <id>
// ----------------------------------------------------------------------------

var detectionsEnableCmd = &cobra.Command{
	Use:   "enable <id>",
	Short: "Enable a detection rule",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]

		body := map[string]interface{}{"enabled": true}
		var resp detectionRule
		if err := apiClient.Patch("/v1/detections/"+id, body, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		fmt.Printf("Detection rule %s enabled.\n", id)
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil detections disable <id>
// ----------------------------------------------------------------------------

var detectionsDisableCmd = &cobra.Command{
	Use:   "disable <id>",
	Short: "Disable a detection rule",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]

		body := map[string]interface{}{"enabled": false}
		var resp detectionRule
		if err := apiClient.Patch("/v1/detections/"+id, body, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		fmt.Printf("Detection rule %s disabled.\n", id)
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil detections delete <id>
// ----------------------------------------------------------------------------

var detectionsDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a detection rule (requires --confirm)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]

		if !detectionsDeleteConfirm {
			output.PrintError(
				"CONFIRM_REQUIRED",
				"pass --confirm to delete a detection rule",
				"",
			)
			return nil
		}

		if err := apiClient.Delete("/v1/detections/" + id); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			type result struct {
				Status string `json:"status"`
				ID     string `json:"id"`
			}
			output.PrintJSON(result{Status: "deleted", ID: id})
			return nil
		}

		fmt.Printf("Detection rule %s deleted.\n", id)
		return nil
	},
}

// ----------------------------------------------------------------------------
// init: wire flags and subcommands
// ----------------------------------------------------------------------------

func init() {
	// detections list
	detectionsListCmd.Flags().StringVar(&detectionsListEnabled, "enabled", "", "Filter by enabled status: true|false (omit for all)")
	detectionsListCmd.Flags().StringVar(&detectionsListSeverity, "severity", "", "Filter by severity: low|medium|high|critical")
	detectionsListCmd.Flags().IntVar(&detectionsListLimit, "limit", 100, "Maximum number of rules to return")

	// detections create
	detectionsCreateCmd.Flags().StringVar(&detectionsCreateFile, "file", "", "Path to Sigma YAML file (required)")
	detectionsCreateCmd.Flags().StringVar(&detectionsCreateSeverity, "severity", "", "Override severity: low|medium|high|critical")
	detectionsCreateCmd.Flags().BoolVar(&detectionsCreateEnabled, "enabled", true, "Enable rule on creation")

	// detections delete
	detectionsDeleteCmd.Flags().BoolVar(&detectionsDeleteConfirm, "confirm", false, "Confirm deletion (required)")

	// Register subcommands.
	detectionsCmd.AddCommand(detectionsListCmd)
	detectionsCmd.AddCommand(detectionsGetCmd)
	detectionsCmd.AddCommand(detectionsCreateCmd)
	detectionsCmd.AddCommand(detectionsEnableCmd)
	detectionsCmd.AddCommand(detectionsDisableCmd)
	detectionsCmd.AddCommand(detectionsDeleteCmd)
}
