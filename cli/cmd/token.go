//go:build !agentonly

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// ----------------------------------------------------------------------------
// Flag vars
// ----------------------------------------------------------------------------

var (
	tokenCreateLabel     string
	tokenCreateSingleUse bool
	tokenCreateExpires   int
)

// ----------------------------------------------------------------------------
// vigil token
// ----------------------------------------------------------------------------

var tokenCmd = &cobra.Command{
	Use:   "token",
	Short: "Manage enrollment tokens for agent registration",
	Long: `Enrollment tokens authorize a new agent to call POST /v1/endpoints/register.

When VIGIL_REQUIRE_AUTH=true, agents must present a valid enrollment token
to register. Tokens are single-use and time-limited by default.

Typical workflow:
  1. Server operator generates a token:
       vigil token create --label "office-laptop"
  2. Copy the token to the target machine and register:
       vigil agent register --enroll-token vig_enroll_...
     Or pass it to the install script:
       curl .../install.sh | VIGIL_URL=http://server:8001 VIGIL_ENROLL_TOKEN=vig_enroll_... bash`,
}

// ----------------------------------------------------------------------------
// vigil token create
// ----------------------------------------------------------------------------

var tokenCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new enrollment token",
	Long: `Create a new enrollment token.

The plaintext token is printed once and never stored. Save it immediately.

Set VIGIL_ADMIN_KEY (or use --admin-key on the server side) if the server
has VIGIL_REQUIRE_AUTH=true and VIGIL_ADMIN_KEY configured.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		type req struct {
			Label        string `json:"label"`
			SingleUse    bool   `json:"single_use"`
			ExpiresHours *int   `json:"expires_hours"`
		}
		type resp struct {
			ID        string `json:"id"`
			Label     string `json:"label"`
			Token     string `json:"token"`
			SingleUse bool   `json:"single_use"`
			ExpiresAt string `json:"expires_at,omitempty"`
			CreatedAt string `json:"created_at"`
		}

		var expires *int
		if tokenCreateExpires > 0 {
			expires = &tokenCreateExpires
		}

		body := req{
			Label:        tokenCreateLabel,
			SingleUse:    tokenCreateSingleUse,
			ExpiresHours: expires,
		}

		var result resp
		if err := apiClient.Post("/v1/tokens", body, &result); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(result)
			return nil
		}

		t := output.NewTable([]string{"Field", "Value"})
		t.Append([]string{"ID", result.ID})
		t.Append([]string{"Token", result.Token})
		if result.Label != "" {
			t.Append([]string{"Label", result.Label})
		}
		t.Append([]string{"Single Use", fmt.Sprintf("%v", result.SingleUse)})
		if result.ExpiresAt != "" {
			t.Append([]string{"Expires At", result.ExpiresAt})
		}
		t.Append([]string{"Created At", result.CreatedAt})
		t.Render()
		fmt.Println()
		fmt.Println("IMPORTANT: Save this token — it will not be shown again.")
		fmt.Println()
		fmt.Println("Register an agent with:")
		fmt.Printf("  vigil agent register --enroll-token %s\n", result.Token)
		fmt.Println()
		fmt.Println("Or pass it to the install script:")
		fmt.Printf("  Linux/macOS:  VIGIL_ENROLL_TOKEN=%s bash install.sh\n", result.Token)
		fmt.Printf("  Windows:      irm .../install.ps1 | iex  (with -EnrollToken %s)\n", result.Token)
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil token list
// ----------------------------------------------------------------------------

var tokenListCmd = &cobra.Command{
	Use:   "list",
	Short: "List enrollment tokens",
	RunE: func(cmd *cobra.Command, args []string) error {
		type token struct {
			ID        string `json:"id"`
			Label     string `json:"label"`
			SingleUse bool   `json:"single_use"`
			Used      bool   `json:"used"`
			ExpiresAt string `json:"expires_at,omitempty"`
			CreatedAt string `json:"created_at"`
		}
		type listResp struct {
			Tokens []token `json:"tokens"`
			Total  int     `json:"total"`
		}

		var result listResp
		if err := apiClient.Get("/v1/tokens", nil, &result); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(result)
			return nil
		}

		if len(result.Tokens) == 0 {
			fmt.Println("No enrollment tokens found.")
			return nil
		}

		t := output.NewTable([]string{"ID", "Label", "Single Use", "Used", "Expires At", "Created At"})
		for _, tok := range result.Tokens {
			exp := tok.ExpiresAt
			if exp == "" {
				exp = "never"
			}
			t.Append([]string{
				tok.ID,
				tok.Label,
				fmt.Sprintf("%v", tok.SingleUse),
				fmt.Sprintf("%v", tok.Used),
				exp,
				tok.CreatedAt,
			})
		}
		t.Render()
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil token revoke
// ----------------------------------------------------------------------------

var tokenRevokeCmd = &cobra.Command{
	Use:   "revoke <id>",
	Short: "Revoke (delete) an enrollment token by ID",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := apiClient.Delete("/v1/tokens/" + args[0]); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(map[string]string{"status": "revoked", "id": args[0]})
			return nil
		}
		fmt.Printf("Token %s revoked.\n", args[0])
		return nil
	},
}

// ----------------------------------------------------------------------------
// init
// ----------------------------------------------------------------------------

func init() {
	tokenCreateCmd.Flags().StringVar(&tokenCreateLabel, "label", "", "Human-readable label for this token")
	tokenCreateCmd.Flags().BoolVar(&tokenCreateSingleUse, "single-use", true, "Invalidate the token after first use")
	tokenCreateCmd.Flags().IntVar(&tokenCreateExpires, "expires", 24, "Token lifetime in hours (0 = no expiry)")

	tokenCmd.AddCommand(tokenCreateCmd)
	tokenCmd.AddCommand(tokenListCmd)
	tokenCmd.AddCommand(tokenRevokeCmd)
	rootCmd.AddCommand(tokenCmd)
}
