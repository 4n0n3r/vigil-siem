//go:build !agentonly

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type suppressionItem struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	FieldPath   string  `json:"field_path"`
	FieldValue  string  `json:"field_value"`
	MatchType   string  `json:"match_type"`
	Scope       string  `json:"scope"`
	Enabled     bool    `json:"enabled"`
	HitCount    int     `json:"hit_count"`
	LastHitAt   *string `json:"last_hit_at"`
	CreatedAt   string  `json:"created_at"`
}

type suppressionListResponse struct {
	Suppressions []suppressionItem `json:"suppressions"`
	Total        int               `json:"total"`
}

// ---------------------------------------------------------------------------
// vigil suppressions
// ---------------------------------------------------------------------------

var suppressionsCmd = &cobra.Command{
	Use:   "suppressions",
	Short: "Manage global alert suppressions",
	Long: `Create and manage global suppressions (allowlists) that prevent
false-positive alerts from being raised for known-good activity.

Subcommands:
  list     List all suppressions
  create   Create a new suppression rule
  delete   Delete a suppression by ID
  disable  Disable a suppression without deleting it
  enable   Re-enable a disabled suppression`,
}

// ---------------------------------------------------------------------------
// vigil suppressions list
// ---------------------------------------------------------------------------

var suppressionsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all suppressions",
	RunE: func(cmd *cobra.Command, args []string) error {
		includeDisabled, _ := cmd.Flags().GetBool("all")

		params := map[string]string{}
		if includeDisabled {
			params["include_disabled"] = "true"
		}

		var resp suppressionListResponse
		if err := apiClient.Get("/v1/suppressions", params, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		if len(resp.Suppressions) == 0 {
			output.Println("No suppressions configured.")
			output.Println("Add one with: vigil suppressions create --name <name> --field <path> --value <val>")
			return nil
		}

		t := output.NewTable([]string{"ID", "Name", "Field", "Value", "Match", "Enabled", "Hits"})
		for _, s := range resp.Suppressions {
			enabled := "yes"
			if !s.Enabled {
				enabled = "no"
			}
			t.Append([]string{
				s.ID[:8] + "...",
				s.Name,
				s.FieldPath,
				s.FieldValue,
				s.MatchType,
				enabled,
				fmt.Sprintf("%d", s.HitCount),
			})
		}
		t.Render()
		fmt.Printf("\n%d suppression(s)\n", resp.Total)
		return nil
	},
}

// ---------------------------------------------------------------------------
// vigil suppressions create
// ---------------------------------------------------------------------------

var suppressionsCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new suppression rule",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		field, _ := cmd.Flags().GetString("field")
		value, _ := cmd.Flags().GetString("value")
		matchType, _ := cmd.Flags().GetString("match")
		scope, _ := cmd.Flags().GetString("scope")
		description, _ := cmd.Flags().GetString("description")

		if name == "" || field == "" || value == "" {
			output.PrintError("MISSING_FLAGS", "Required flags: --name, --field, --value", "")
			return nil
		}

		body := map[string]interface{}{
			"name":        name,
			"field_path":  field,
			"field_value": value,
			"match_type":  matchType,
			"scope":       scope,
			"description": description,
		}

		var resp suppressionItem
		if err := apiClient.Post("/v1/suppressions", body, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		fmt.Printf("Suppression created: %s\n", resp.ID)
		fmt.Printf("  Name:   %s\n", resp.Name)
		fmt.Printf("  Field:  %s\n", resp.FieldPath)
		fmt.Printf("  Value:  %s\n", resp.FieldValue)
		fmt.Printf("  Match:  %s\n", resp.MatchType)
		fmt.Printf("  Scope:  %s\n", resp.Scope)
		return nil
	},
}

// ---------------------------------------------------------------------------
// vigil suppressions delete <id>
// ---------------------------------------------------------------------------

var suppressionsDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a suppression by ID",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := apiClient.Delete("/v1/suppressions/" + args[0]); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(map[string]string{"status": "deleted", "id": args[0]})
			return nil
		}
		fmt.Printf("Suppression %s deleted.\n", args[0])
		return nil
	},
}

// ---------------------------------------------------------------------------
// vigil suppressions disable <id>
// ---------------------------------------------------------------------------

var suppressionsDisableCmd = &cobra.Command{
	Use:   "disable <id>",
	Short: "Disable a suppression (keep it but stop matching)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return toggleSuppression(args[0], false)
	},
}

// ---------------------------------------------------------------------------
// vigil suppressions enable <id>
// ---------------------------------------------------------------------------

var suppressionsEnableCmd = &cobra.Command{
	Use:   "enable <id>",
	Short: "Re-enable a disabled suppression",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return toggleSuppression(args[0], true)
	},
}

func toggleSuppression(id string, enabled bool) error {
	body := map[string]interface{}{"enabled": enabled}
	var resp suppressionItem
	if err := apiClient.Patch("/v1/suppressions/"+id, body, &resp); err != nil {
		output.PrintErrorFromErr(err)
		return nil
	}

	mode := output.ParseMode(globalOutput)
	if mode == output.ModeJSON {
		output.PrintJSON(resp)
		return nil
	}

	state := "enabled"
	if !resp.Enabled {
		state = "disabled"
	}
	fmt.Printf("Suppression %s %s.\n", resp.ID, state)
	return nil
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

func init() {
	// list flags
	suppressionsListCmd.Flags().Bool("all", false, "Include disabled suppressions")

	// create flags
	suppressionsCreateCmd.Flags().String("name", "", "Suppression name (required)")
	suppressionsCreateCmd.Flags().String("field", "", "Event field path in dot notation, e.g. event_data.ServiceName (required)")
	suppressionsCreateCmd.Flags().String("value", "", "Value to match against the field (required)")
	suppressionsCreateCmd.Flags().String("match", "exact", "Match type: exact, contains, or regex")
	suppressionsCreateCmd.Flags().String("scope", "global", "Scope: 'global' or 'rule:<uuid>'")
	suppressionsCreateCmd.Flags().String("description", "", "Optional description")

	suppressionsCmd.AddCommand(suppressionsListCmd)
	suppressionsCmd.AddCommand(suppressionsCreateCmd)
	suppressionsCmd.AddCommand(suppressionsDeleteCmd)
	suppressionsCmd.AddCommand(suppressionsDisableCmd)
	suppressionsCmd.AddCommand(suppressionsEnableCmd)
}
