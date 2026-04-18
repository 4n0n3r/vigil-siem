//go:build !agentonly

package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

var (
	ingestSource string
	ingestEvent  string
)

// ingestRequest mirrors the API POST /v1/events body.
type ingestRequest struct {
	Source string                 `json:"source"`
	Event  map[string]interface{} `json:"event"`
}

// ingestResponse mirrors the API POST /v1/events success response.
type ingestResponse struct {
	ID        string   `json:"id"`
	Source    string   `json:"source"`
	Timestamp string   `json:"timestamp"`
	Status    string   `json:"status"`
	AlertIDs  []string `json:"alert_ids"`
}

var ingestCmd = &cobra.Command{
	Use:   "ingest",
	Short: "Ingest a single event into Vigil",
	Long: `Send a JSON event to the Vigil API for ingestion.

Example:
  vigil ingest --source firewall --event '{"action":"block","src_ip":"1.2.3.4"}'
  vigil ingest --source auditd --event '{"cmd":"rm -rf /"}' --output json`,
	RunE: func(cmd *cobra.Command, args []string) error {
		// Validate required flags.
		if ingestSource == "" {
			output.PrintError("MISSING_FLAG", "--source is required", "provide a non-empty source identifier")
			return nil
		}
		if ingestEvent == "" {
			output.PrintError("MISSING_FLAG", "--event is required", "provide a JSON string for the event payload")
			return nil
		}

		// Parse the event JSON string into a map.
		var eventMap map[string]interface{}
		if err := json.Unmarshal([]byte(ingestEvent), &eventMap); err != nil {
			output.PrintError(
				"INVALID_JSON",
				"--event value is not valid JSON",
				err.Error(),
			)
			return nil
		}

		body := ingestRequest{
			Source: ingestSource,
			Event:  eventMap,
		}

		var resp ingestResponse
		if err := apiClient.Post("/v1/events", body, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		switch mode {
		case output.ModeJSON:
			output.PrintJSON(resp)
		default:
			t := output.NewTable([]string{"Field", "Value"})
			t.Append([]string{"Status", resp.Status})
			t.Append([]string{"Event ID", resp.ID})
			t.Append([]string{"Source", resp.Source})
			t.Append([]string{"Timestamp", resp.Timestamp})
			if len(resp.AlertIDs) > 0 {
				t.Append([]string{"Alerts Generated", fmt.Sprintf("%d", len(resp.AlertIDs))})
			}
			t.Render()
			fmt.Println()
		}

		return nil
	},
}

func init() {
	ingestCmd.Flags().StringVar(&ingestSource, "source", "", "Event source identifier (required)")
	ingestCmd.Flags().StringVar(&ingestEvent, "event", "", "Event payload as a JSON string (required)")
}
