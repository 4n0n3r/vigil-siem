package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// endpointDetail is the full shape returned by GET /v1/endpoints/{id}.
type endpointDetail struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Hostname  string                 `json:"hostname"`
	OS        string                 `json:"os"`
	LastSeen  string                 `json:"last_seen"`
	CreatedAt string                 `json:"created_at"`
	Metadata  map[string]interface{} `json:"metadata"`
}

// endpointListResponse mirrors GET /v1/endpoints.
type endpointListResponse struct {
	Endpoints []endpointDetail `json:"endpoints"`
	Total     int              `json:"total"`
}

// endpointsCmd — the parent "vigil endpoints" group
var endpointsCmd = &cobra.Command{
	Use:   "endpoints",
	Short: "Manage registered endpoints",
	Long: `List and inspect registered Vigil endpoints.

Subcommands:
  list   List all registered endpoints
  get    Get details for a specific endpoint`,
}

// vigil endpoints list
var endpointsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all registered endpoints",
	RunE: func(cmd *cobra.Command, args []string) error {
		var resp endpointListResponse
		if err := apiClient.Get("/v1/endpoints", nil, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(resp)
			return nil
		}

		if len(resp.Endpoints) == 0 {
			output.Println("No endpoints registered.")
			output.Println("Register one with: vigil agent register --name <name>")
			return nil
		}

		t := output.NewTable([]string{"ID", "Name", "Hostname", "OS", "Last Seen"})
		for _, e := range resp.Endpoints {
			lastSeen := e.LastSeen
			if len(lastSeen) > 19 {
				lastSeen = lastSeen[:19]
			}
			t.Append([]string{e.ID[:8] + "...", e.Name, e.Hostname, e.OS, lastSeen})
		}
		t.Render()
		fmt.Printf("\n%d endpoint(s) registered\n", resp.Total)
		return nil
	},
}

// vigil endpoints get <id>
var endpointsGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get details for a registered endpoint",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		var resp endpointDetail
		if err := apiClient.Get("/v1/endpoints/"+args[0], nil, &resp); err != nil {
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
		t.Append([]string{"Hostname", resp.Hostname})
		t.Append([]string{"OS", resp.OS})
		t.Append([]string{"Last Seen", resp.LastSeen})
		t.Append([]string{"Created At", resp.CreatedAt})
		t.Render()
		return nil
	},
}

func init() {
	endpointsCmd.AddCommand(endpointsListCmd)
	endpointsCmd.AddCommand(endpointsGetCmd)
}
