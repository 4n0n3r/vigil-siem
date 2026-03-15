package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/agent"
	"github.com/vigil/vigil/internal/output"
)

// ----------------------------------------------------------------------------
// Parent command: vigil forensic
// ----------------------------------------------------------------------------

var forensicCmd = &cobra.Command{
	Use:   "forensic",
	Short: "Point-in-time forensic artifact collection",
	Long: `Collect forensic artifacts from the local endpoint and ingest them into the SIEM.

Unlike 'vigil agent' which streams events continuously, 'vigil forensic collect'
performs a one-shot sweep of static artifacts:

  - Prefetch file metadata (C:\Windows\Prefetch)
  - Registry Run keys (HKLM + HKCU autorun entries)
  - Windows Services (via SCM)
  - Scheduled Tasks (via registry TaskCache)
  - Shimcache / AppCompatCache (raw bytes, hex-encoded)

Results are ingested as events with source prefix "forensic:".
Run as administrator for complete coverage.`,
}

// ----------------------------------------------------------------------------
// vigil forensic collect
// ----------------------------------------------------------------------------

var forensicCollectCmd = &cobra.Command{
	Use:   "collect",
	Short: "Sweep forensic artifacts and ingest to the API",
	RunE: func(cmd *cobra.Command, args []string) error {
		col := agent.NewForensicCollector()

		ch, err := col.Start(context.Background())
		if err != nil {
			output.PrintError("FORENSIC_PLATFORM_ERROR",
				"forensic collection is not supported on this platform", err.Error())
			return nil
		}

		// Drain all events from the sweep.
		var events []agent.Event
		for ev := range ch {
			events = append(events, ev)
		}

		if len(events) == 0 {
			output.PrintError("FORENSIC_NO_DATA",
				"no forensic artifacts collected — run as administrator for full coverage", "")
			return nil
		}

		// Tally by source for the summary.
		counts := make(map[string]int)
		for _, ev := range events {
			counts[ev.Source]++
		}

		// Batch ingest.
		type batchReq struct {
			Events []agent.Event `json:"events"`
		}
		type batchResp struct {
			Ingested int      `json:"ingested"`
			IDs      []string `json:"ids"`
			Errors   []string `json:"errors,omitempty"`
		}

		var resp batchResp
		if err := apiClient.Post("/v1/events/batch", batchReq{Events: events}, &resp); err != nil {
			output.PrintError("FORENSIC_INGEST_ERROR", "failed to ingest forensic events", err.Error())
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			type jsonResult struct {
				Ingested int            `json:"ingested"`
				Counts   map[string]int `json:"counts"`
				Errors   []string       `json:"errors,omitempty"`
			}
			output.PrintJSON(jsonResult{
				Ingested: resp.Ingested,
				Counts:   counts,
				Errors:   resp.Errors,
			})
			return nil
		}

		// Table output.
		t := output.NewTable([]string{"Artifact Type", "Count"})
		for _, src := range []string{
			"forensic:prefetch",
			"forensic:registry",
			"forensic:services",
			"forensic:tasks",
			"forensic:shimcache",
		} {
			if c, ok := counts[src]; ok {
				t.Append([]string{src, fmt.Sprintf("%d", c)})
			}
		}
		t.Render()
		fmt.Printf("\nTotal ingested: %d\n", resp.Ingested)
		if len(resp.Errors) > 0 {
			fmt.Printf("Ingest errors: %d\n", len(resp.Errors))
		}
		return nil
	},
}

// ----------------------------------------------------------------------------
// init
// ----------------------------------------------------------------------------

func init() {
	forensicCmd.AddCommand(forensicCollectCmd)
}
