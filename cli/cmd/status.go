package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// statusResponse mirrors GET /v1/status response.
type statusResponse struct {
	APIStatus      string `json:"api_status"`
	DBStatus       string `json:"db_status"`
	EventsLast24h  int    `json:"events_last_24h"`
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show Vigil system health",
	Long: `Retrieve the current health of the Vigil API and its dependencies.

Examples:
  vigil status
  vigil status --output json`,
	RunE: func(cmd *cobra.Command, args []string) error {
		var resp statusResponse
		if err := apiClient.Get("/v1/status", nil, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		switch mode {
		case output.ModeJSON:
			output.PrintJSON(resp)
		default:
			t := output.NewTable([]string{"Component", "Status"})
			t.Append([]string{"API", resp.APIStatus})
			t.Append([]string{"Database", resp.DBStatus})
			t.Append([]string{"Events (last 24h)", fmt.Sprintf("%d", resp.EventsLast24h)})
			t.Render()
			fmt.Println()
		}

		return nil
	},
}
