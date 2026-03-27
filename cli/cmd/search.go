//go:build !agentonly

package cmd

import (
	"fmt"
	"strconv"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

var (
	searchQuery      string
	searchFrom       string
	searchTo         string
	searchLimit      int
	searchEndpointID string
)

// searchEvent is a single event in the search response.
type searchEvent struct {
	ID        string                 `json:"id"`
	Timestamp string                 `json:"timestamp"`
	Source    string                 `json:"source"`
	EventType string                 `json:"event_type"`
	Summary   string                 `json:"summary"`
	Event     map[string]interface{} `json:"event"`
}

// searchResponse mirrors GET /v1/events/search response.
type searchResponse struct {
	Events      []searchEvent `json:"events"`
	Total       int           `json:"total"`
	QueryTimeMs int           `json:"query_time_ms"`
}

var searchCmd = &cobra.Command{
	Use:   "search",
	Short: "Search ingested events",
	Long: `Query the Vigil event store for matching events.

Times must be in RFC3339 format, e.g. 2024-01-15T00:00:00Z

Examples:
  vigil search --query "action:block"
  vigil search --query "src_ip:1.2.3.4" --from 2024-01-01T00:00:00Z --limit 50
  vigil search --output json`,
	RunE: func(cmd *cobra.Command, args []string) error {
		params := map[string]string{
			"query":       searchQuery,
			"from_time":   searchFrom,
			"to_time":     searchTo,
			"limit":       strconv.Itoa(searchLimit),
			"endpoint_id": searchEndpointID,
		}

		var resp searchResponse
		if err := apiClient.Get("/v1/events/search", params, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		switch mode {
		case output.ModeJSON:
			output.PrintJSON(resp)
		default:
			if len(resp.Events) == 0 {
				output.Println("No events matched your query.")
				return nil
			}

			t := output.NewTable([]string{"Timestamp", "Source", "Event Type", "Summary"})
			for _, e := range resp.Events {
				t.Append([]string{e.Timestamp, e.Source, e.EventType, e.Summary})
			}
			t.Render()
			fmt.Printf("\n%d event(s) found  |  query time: %dms\n", resp.Total, resp.QueryTimeMs)
		}

		return nil
	},
}

func init() {
	searchCmd.Flags().StringVar(&searchQuery, "query", "", "Search query string")
	searchCmd.Flags().StringVar(&searchFrom, "from", "", "Start time in RFC3339 format")
	searchCmd.Flags().StringVar(&searchTo, "to", "", "End time in RFC3339 format")
	searchCmd.Flags().IntVar(&searchLimit, "limit", 100, "Maximum number of events to return")
	searchCmd.Flags().StringVar(&searchEndpointID, "endpoint", "", "Filter by endpoint ID")
}
