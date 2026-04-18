//go:build !agentonly

package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type connectorResponse struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	SIEMType    string                 `json:"siem_type"`
	Config      map[string]interface{} `json:"config"`
	Enabled     bool                   `json:"enabled"`
	LastPolled  string                 `json:"last_polled"`
	LastError   string                 `json:"last_error"`
	CreatedAt   string                 `json:"created_at"`
}

type connectorListResponse struct {
	Connectors []connectorResponse `json:"connectors"`
	Total      int                 `json:"total"`
}

type connectorTestResult struct {
	OK          bool   `json:"ok"`
	Message     string `json:"message"`
	ConnectorID string `json:"connector_id"`
	LatencyMS   *int   `json:"latency_ms"`
}

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

var connectorCmd = &cobra.Command{
	Use:   "connector",
	Short: "Manage SIEM connectors",
	Long: `Add and manage connections to external SIEM systems.

Subcommands:
  add wazuh    Add a Wazuh connector
  add elastic  Add an Elastic Security connector
  list         List all configured connectors
  test <id>    Test a connector connection
  remove <id>  Remove a connector`,
}

// ---------------------------------------------------------------------------
// connector add
// ---------------------------------------------------------------------------

var connectorAddCmd = &cobra.Command{
	Use:   "add <type>",
	Short: "Add a new SIEM connector (wazuh | elastic)",
	Long: `Add a connector to an external SIEM.

Examples:
  vigil connector add wazuh --name prod-wazuh \
    --indexer-url https://wazuh-indexer:9200 \
    --indexer-user admin --indexer-pass secret

  vigil connector add elastic --name prod-elastic \
    --url https://elastic:9200 --api-key <base64-key>`,
	Args:      cobra.ExactArgs(1),
	ValidArgs: []string{"wazuh", "elastic"},
	RunE: func(cmd *cobra.Command, args []string) error {
		siemType := strings.ToLower(args[0])

		name, _ := cmd.Flags().GetString("name")
		noVerifySSL, _ := cmd.Flags().GetBool("no-verify-ssl")
		verifySSL := !noVerifySSL

		config := map[string]interface{}{
			"verify_ssl": verifySSL,
		}

		switch siemType {
		case "wazuh":
			indexerURL, _ := cmd.Flags().GetString("indexer-url")
			indexerUser, _ := cmd.Flags().GetString("indexer-user")
			indexerPass, _ := cmd.Flags().GetString("indexer-pass")
			if indexerURL == "" || indexerUser == "" || indexerPass == "" {
				output.PrintErrorFromErr(&errorStub{
					code:    "MISSING_FLAGS",
					message: "wazuh requires --indexer-url, --indexer-user, and --indexer-pass",
				})
				return nil
			}
			config["indexer_url"] = indexerURL
			config["indexer_user"] = indexerUser
			config["indexer_password"] = indexerPass

			// optional manager API fields
			if v, _ := cmd.Flags().GetString("manager-url"); v != "" {
				config["manager_url"] = v
			}
			if v, _ := cmd.Flags().GetString("manager-user"); v != "" {
				config["manager_user"] = v
			}
			if v, _ := cmd.Flags().GetString("manager-pass"); v != "" {
				config["manager_password"] = v
			}
			if v, _ := cmd.Flags().GetInt("min-rule-level"); v > 0 {
				config["min_rule_level"] = v
			}

		case "elastic":
			url, _ := cmd.Flags().GetString("url")
			apiKey, _ := cmd.Flags().GetString("api-key")
			if url == "" || apiKey == "" {
				output.PrintErrorFromErr(&errorStub{
					code:    "MISSING_FLAGS",
					message: "elastic requires --url and --api-key",
				})
				return nil
			}
			config["url"] = url
			config["api_key"] = apiKey

		default:
			output.PrintErrorFromErr(&errorStub{
				code:    "UNSUPPORTED_SIEM_TYPE",
				message: fmt.Sprintf("unsupported SIEM type %q — supported: wazuh, elastic", siemType),
			})
			return nil
		}

		body := map[string]interface{}{
			"name":      name,
			"siem_type": siemType,
			"config":    config,
		}

		var resp connectorResponse
		if err := apiClient.Post("/v1/connectors", body, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		fmt.Printf("Connector %q added (id: %s)\n", resp.Name, resp.ID[:8]+"...")
		fmt.Printf("SIEM type: %s\n", resp.SIEMType)
		fmt.Printf("Run 'vigil connector test %s' to verify the connection.\n", resp.ID)
		return nil
	},
}

// ---------------------------------------------------------------------------
// connector list
// ---------------------------------------------------------------------------

var connectorListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all configured SIEM connectors",
	RunE: func(cmd *cobra.Command, args []string) error {
		var resp connectorListResponse
		if err := apiClient.Get("/v1/connectors", nil, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		if len(resp.Connectors) == 0 {
			output.Println("No connectors configured.")
			output.Println("Add one with: vigil connector add wazuh --help")
			return nil
		}

		t := output.NewTable([]string{"ID", "Name", "Type", "Enabled", "Last Polled", "Last Error"})
		for _, c := range resp.Connectors {
			lastPolled := c.LastPolled
			if len(lastPolled) > 19 {
				lastPolled = lastPolled[:19]
			}
			lastErr := c.LastError
			if len(lastErr) > 40 {
				lastErr = lastErr[:37] + "..."
			}
			enabled := "yes"
			if !c.Enabled {
				enabled = "no"
			}
			t.Append([]string{c.ID[:8] + "...", c.Name, c.SIEMType, enabled, lastPolled, lastErr})
		}
		t.Render()
		fmt.Printf("\n%d connector(s) configured\n", resp.Total)
		return nil
	},
}

// ---------------------------------------------------------------------------
// connector test <id>
// ---------------------------------------------------------------------------

var connectorTestCmd = &cobra.Command{
	Use:   "test <id>",
	Short: "Test a connector connection",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		var resp connectorTestResult
		if err := apiClient.Post("/v1/connectors/"+args[0]+"/test", map[string]string{}, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		status := "OK"
		if !resp.OK {
			status = "FAILED"
		}
		fmt.Printf("[%s] %s\n", status, resp.Message)
		if resp.LatencyMS != nil {
			fmt.Printf("Latency: %dms\n", *resp.LatencyMS)
		}
		return nil
	},
}

// ---------------------------------------------------------------------------
// connector remove <id>
// ---------------------------------------------------------------------------

var connectorRemoveCmd = &cobra.Command{
	Use:   "remove <id>",
	Short: "Remove a SIEM connector",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := apiClient.Delete("/v1/connectors/" + args[0]); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(map[string]string{"status": "deleted", "id": args[0]})
			return nil
		}
		fmt.Printf("Connector %s removed.\n", args[0])
		return nil
	},
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

func init() {
	// add <type> flags — all defined here, used selectively per type
	connectorAddCmd.Flags().String("name", "", "Connector display name (required)")
	connectorAddCmd.Flags().Bool("no-verify-ssl", false, "Skip TLS certificate verification (insecure)")

	// Wazuh flags
	connectorAddCmd.Flags().String("indexer-url", "", "[wazuh] OpenSearch indexer URL, e.g. https://wazuh-indexer:9200")
	connectorAddCmd.Flags().String("indexer-user", "", "[wazuh] OpenSearch username")
	connectorAddCmd.Flags().String("indexer-pass", "", "[wazuh] OpenSearch password")
	connectorAddCmd.Flags().String("manager-url", "", "[wazuh] Optional: Wazuh manager REST API URL")
	connectorAddCmd.Flags().String("manager-user", "", "[wazuh] Optional: Wazuh manager username")
	connectorAddCmd.Flags().String("manager-pass", "", "[wazuh] Optional: Wazuh manager password")
	connectorAddCmd.Flags().Int("min-rule-level", 0, "[wazuh] Minimum rule level to include (default: 3)")

	// Elastic flags
	connectorAddCmd.Flags().String("url", "", "[elastic] Elasticsearch URL, e.g. https://elastic:9200")
	connectorAddCmd.Flags().String("api-key", "", "[elastic] API key (base64 id:key from Kibana)")

	_ = connectorAddCmd.MarkFlagRequired("name")

	connectorCmd.AddCommand(connectorAddCmd)
	connectorCmd.AddCommand(connectorListCmd)
	connectorCmd.AddCommand(connectorTestCmd)
	connectorCmd.AddCommand(connectorRemoveCmd)
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

type errorStub struct {
	code    string
	message string
}

func (e *errorStub) Error() string {
	return fmt.Sprintf(`{"error_code":%q,"message":%q}`, e.code, e.message)
}
