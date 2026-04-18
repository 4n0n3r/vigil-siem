//go:build !agentonly

package cmd

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type feedAlert struct {
	ConnectorID   string                 `json:"connector_id"`
	ConnectorName string                 `json:"connector_name"`
	SourceSIEM    string                 `json:"source_siem"`
	NativeID      string                 `json:"native_id"`
	Severity      string                 `json:"severity"`
	Title         string                 `json:"title"`
	Hostname      string                 `json:"hostname"`
	SourceIP      string                 `json:"source_ip"`
	DetectedAt    string                 `json:"detected_at"`
	Raw           map[string]interface{} `json:"raw"`
}

type feedAlertsResponse struct {
	Alerts             []feedAlert `json:"alerts"`
	Total              int         `json:"total"`
	ConnectorsQueried  int         `json:"connectors_queried"`
	Errors             []string    `json:"errors"`
}

type feedContextResponse struct {
	Alert        feedAlert                `json:"alert"`
	Events       []map[string]interface{} `json:"events"`
	TotalEvents  int                      `json:"total_events"`
	WindowMinutes int                     `json:"window_minutes"`
}

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

var feedCmd = &cobra.Command{
	Use:   "feed",
	Short: "Pull alerts and context from connected SIEMs",
	Long: `Fetch live alerts and log context from all configured SIEM connectors.

Subcommands:
  alerts              List recent alerts from all enabled connectors
  context <id> <aid>  Get raw log context for a specific alert`,
}

// ---------------------------------------------------------------------------
// feed alerts
// ---------------------------------------------------------------------------

var feedAlertsCmd = &cobra.Command{
	Use:   "alerts",
	Short: "Pull recent alerts from all connected SIEMs",
	RunE: func(cmd *cobra.Command, args []string) error {
		sinceStr, _ := cmd.Flags().GetString("since")
		severity, _ := cmd.Flags().GetString("severity")
		limit, _ := cmd.Flags().GetInt("limit")

		sinceMinutes, err := parseDurationToMinutes(sinceStr)
		if err != nil {
			output.PrintErrorFromErr(&errorStub{
				code:    "INVALID_DURATION",
				message: fmt.Sprintf("invalid --since value %q — use format like 30m, 2h, 24h", sinceStr),
			})
			return nil
		}

		params := map[string]string{
			"since_minutes": fmt.Sprintf("%d", sinceMinutes),
			"limit":         fmt.Sprintf("%d", limit),
		}
		if severity != "" {
			params["severity"] = severity
		}

		var resp feedAlertsResponse
		if err := apiClient.Get("/v1/feed/alerts", params, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		if len(resp.Errors) > 0 {
			for _, e := range resp.Errors {
				fmt.Printf("  [warn] %s\n", e)
			}
		}

		if len(resp.Alerts) == 0 {
			fmt.Printf("No alerts in the last %s", sinceStr)
			if severity != "" {
				fmt.Printf(" with severity %q", severity)
			}
			fmt.Println(".")
			fmt.Printf("Connectors queried: %d\n", resp.ConnectorsQueried)
			return nil
		}

		t := output.NewTable([]string{"CONNECTOR", "SIEM", "SEVERITY", "TITLE", "HOST", "TIME"})
		for _, a := range resp.Alerts {
			title := a.Title
			if len(title) > 45 {
				title = title[:42] + "..."
			}
			host := a.Hostname
			if host == "" {
				host = a.SourceIP
			}
			ts := a.DetectedAt
			if len(ts) > 16 {
				ts = ts[:16]
			}
			t.Append([]string{a.ConnectorName, a.SourceSIEM, strings.ToUpper(a.Severity), title, host, ts})
		}
		t.Render()

		fmt.Printf("\n%d alert(s) from %d connector(s)", resp.Total, resp.ConnectorsQueried)
		if len(resp.Errors) > 0 {
			fmt.Printf(" (%d connector(s) failed)", len(resp.Errors))
		}
		fmt.Println()
		fmt.Println()
		fmt.Println("To investigate an alert:")
		fmt.Println("  vigil feed alerts --output json | jq '.alerts[0]'")
		fmt.Println("  vigil feed context <connector-id> <native-id>")
		return nil
	},
}

// ---------------------------------------------------------------------------
// feed context <connector-id> <alert-id>
// ---------------------------------------------------------------------------

var feedContextCmd = &cobra.Command{
	Use:   "context <connector-id> <alert-id>",
	Short: "Get raw log context for a SIEM alert",
	Long: `Fetch raw log events surrounding a specific alert from its originating SIEM.

The connector-id and native alert-id come from 'vigil feed alerts --output json'.

Example:
  vigil feed alerts --output json | jq -r '.alerts[0] | "\(.connector_id) \(.native_id)"'
  vigil feed context abc-123-... AV1234xyz --window 15m`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		connectorID := args[0]
		alertID := args[1]
		windowStr, _ := cmd.Flags().GetString("window")

		windowMinutes, err := parseDurationToMinutes(windowStr)
		if err != nil {
			output.PrintErrorFromErr(&errorStub{
				code:    "INVALID_DURATION",
				message: fmt.Sprintf("invalid --window value %q — use format like 10m, 1h", windowStr),
			})
			return nil
		}

		params := map[string]string{
			"connector": connectorID,
			"alert":     alertID,
			"window":    fmt.Sprintf("%d", windowMinutes),
		}

		var resp feedContextResponse
		if err := apiClient.Get("/v1/feed/context", params, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		a := resp.Alert
		fmt.Printf("Alert:      %s\n", a.Title)
		fmt.Printf("Severity:   %s\n", strings.ToUpper(a.Severity))
		fmt.Printf("Host:       %s\n", a.Hostname)
		fmt.Printf("Source IP:  %s\n", a.SourceIP)
		fmt.Printf("Detected:   %s\n", a.DetectedAt)
		fmt.Printf("SIEM:       %s (%s)\n", a.ConnectorName, a.SourceSIEM)
		fmt.Println()
		fmt.Printf("Context events (%d, window: %dm):\n", resp.TotalEvents, resp.WindowMinutes)
		fmt.Println(strings.Repeat("-", 60))

		for i, ev := range resp.Events {
			b, _ := json.MarshalIndent(ev, "  ", "  ")
			fmt.Printf("  [%d] %s\n\n", i+1, string(b))
		}

		if resp.TotalEvents == 0 {
			fmt.Println("  No log events found in the context window.")
			fmt.Println("  Tip: widen the window with --window 30m")
			fmt.Println("       or enable wazuh-archives for richer context.")
		}
		return nil
	},
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

func init() {
	feedAlertsCmd.Flags().String("since", "1h", "Alerts from the last duration (e.g. 30m, 2h, 24h)")
	feedAlertsCmd.Flags().String("severity", "", "Filter by severity: critical, high, medium, low")
	feedAlertsCmd.Flags().Int("limit", 50, "Maximum number of alerts to return")

	feedContextCmd.Flags().String("window", "10m", "Log context window around the alert (e.g. 5m, 30m, 1h)")

	feedCmd.AddCommand(feedAlertsCmd)
	feedCmd.AddCommand(feedContextCmd)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func parseDurationToMinutes(s string) (int, error) {
	s = strings.TrimSpace(s)
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, err
	}
	minutes := int(d.Minutes())
	if minutes < 1 {
		minutes = 1
	}
	return minutes, nil
}
