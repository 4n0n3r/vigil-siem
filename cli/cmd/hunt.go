package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

var (
	huntQuery      string
	huntFrom       string
	huntTo         string
	huntLimit      int
	huntAgg        string
	huntTimeline   bool
	huntEndpointID string
)

// huntAggBucket mirrors the API aggregation bucket.
type huntAggBucket struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

// huntTimelineBucket mirrors the API timeline bucket.
type huntTimelineBucket struct {
	Ts    string `json:"ts"`
	Count int    `json:"count"`
}

// huntEvent is a single event in the hunt response.
type huntEvent struct {
	ID        string                 `json:"id"`
	Source    string                 `json:"source"`
	Event     map[string]interface{} `json:"event"`
	Timestamp string                 `json:"timestamp"`
}

// huntResponse mirrors GET /v1/hunt response.
type huntResponse struct {
	Events       []huntEvent          `json:"events"`
	Total        int                  `json:"total"`
	QueryTimeMs  int                  `json:"query_time_ms"`
	Aggregations []huntAggBucket      `json:"aggregations"`
	Timeline     []huntTimelineBucket `json:"timeline"`
	Query        string               `json:"query"`
}

var huntCmd = &cobra.Command{
	Use:   "hunt",
	Short: "Hunt through events using HQL",
	Long: `Hunt through the Vigil event store using the Hunt Query Language (HQL).

HQL supports field:value pairs, wildcards (*), boolean operators (AND/OR/NOT),
grouping with parentheses, and multi-value groups (field:(v1 OR v2)).

Field examples:
  event_id:4625                          single field match
  event_id:(4625 OR 4648)                multi-value OR
  event_data.IpAddress:10.0.*            wildcard
  source:winlog:Security                 source filter
  event_data.SubjectUserName:admin*      prefix wildcard
  NOT event_data.SubjectUserName:SYSTEM$ negation
  event_id:4625 AND event_data.LogonType:3  compound

Full-text (no field prefix):
  mshta.exe                              substring search across all fields

Aggregation:
  vigil hunt --query "event_id:4625" --agg event_data.IpAddress
  → top attacker IPs by count

Timeline:
  vigil hunt --query "event_id:4625" --timeline
  → hourly event counts`,
	RunE: func(cmd *cobra.Command, args []string) error {
		params := map[string]string{
			"limit": fmt.Sprintf("%d", huntLimit),
		}
		if huntQuery != "" {
			params["q"] = huntQuery
		}
		if huntFrom != "" {
			params["from"] = huntFrom
		}
		if huntTo != "" {
			params["to"] = huntTo
		}
		if huntAgg != "" {
			params["agg"] = huntAgg
		}
		if huntTimeline {
			params["timeline"] = "true"
		}
		if huntEndpointID != "" {
			params["endpoint_id"] = huntEndpointID
		}

		var resp huntResponse
		if err := apiClient.Get("/v1/hunt", params, &resp); err != nil {
			output.PrintErrorFromErr(err)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		switch mode {
		case output.ModeJSON:
			output.PrintJSON(resp)
		default:
			printHuntTable(resp)
		}

		return nil
	},
}

func printHuntTable(resp huntResponse) {
	// Summary line
	qDisplay := resp.Query
	if qDisplay == "" {
		qDisplay = "(all events)"
	}
	fmt.Printf("Hunt: %s  |  %d event(s)  |  %dms\n\n", qDisplay, resp.Total, resp.QueryTimeMs)

	// Aggregation table (shown first when --agg is set)
	if len(resp.Aggregations) > 0 {
		fmt.Println("── Aggregations ──")
		t := output.NewTable([]string{"Value", "Count"})
		for _, a := range resp.Aggregations {
			t.Append([]string{a.Value, fmt.Sprintf("%d", a.Count)})
		}
		t.Render()
		fmt.Println()
	}

	// Timeline table
	if len(resp.Timeline) > 0 {
		fmt.Println("── Timeline (hourly) ──")
		t := output.NewTable([]string{"Hour (UTC)", "Count"})
		for _, b := range resp.Timeline {
			ts := b.Ts
			if len(ts) > 16 {
				ts = ts[:16]
			}
			t.Append([]string{ts, fmt.Sprintf("%d", b.Count)})
		}
		t.Render()
		fmt.Println()
	}

	// Events table
	if len(resp.Events) == 0 {
		fmt.Println("No events matched.")
		return
	}

	fmt.Println("── Events ──")
	t := output.NewTable([]string{"Timestamp", "Source", "EventID", "Summary"})
	for _, e := range resp.Events {
		ts := e.Timestamp
		if len(ts) > 19 {
			ts = ts[:19]
		}
		eventID := ""
		if eid, ok := e.Event["event_id"]; ok {
			eventID = fmt.Sprintf("%v", eid)
		}
		// Build a short summary from common fields
		summary := buildHuntSummary(e.Event)
		t.Append([]string{ts, e.Source, eventID, summary})
	}
	t.Render()
}

// buildHuntSummary extracts a short human-readable summary from an event dict.
func buildHuntSummary(ev map[string]interface{}) string {
	parts := []string{}
	priorityFields := []string{
		"event_data.SubjectUserName",
		"event_data.TargetUserName",
		"event_data.IpAddress",
		"event_data.ProcessName",
		"event_data.CommandLine",
	}
	for _, path := range priorityFields {
		val := getNestedField(ev, path)
		if val != "" && val != "-" && !strings.HasSuffix(val, "$") {
			parts = append(parts, val)
		}
		if len(parts) >= 3 {
			break
		}
	}
	summary := strings.Join(parts, " | ")
	if len(summary) > 80 {
		summary = summary[:77] + "..."
	}
	return summary
}

// getNestedField walks a dotted path into a map, returns "" if not found.
func getNestedField(ev map[string]interface{}, path string) string {
	segs := strings.SplitN(path, ".", 2)
	val, ok := ev[segs[0]]
	if !ok {
		return ""
	}
	if len(segs) == 1 {
		return fmt.Sprintf("%v", val)
	}
	if sub, ok := val.(map[string]interface{}); ok {
		return getNestedField(sub, segs[1])
	}
	return ""
}

func init() {
	huntCmd.Flags().StringVar(&huntQuery, "query", "", "HQL query (field:value, wildcards, AND/OR/NOT)")
	huntCmd.Flags().StringVar(&huntFrom, "from", "", "Start time in RFC3339 format")
	huntCmd.Flags().StringVar(&huntTo, "to", "", "End time in RFC3339 format")
	huntCmd.Flags().IntVar(&huntLimit, "limit", 100, "Max events returned (1-1000)")
	huntCmd.Flags().StringVar(&huntAgg, "agg", "", "Aggregate by field (e.g. event_data.IpAddress)")
	huntCmd.Flags().BoolVar(&huntTimeline, "timeline", false, "Include hourly event timeline")
	huntCmd.Flags().StringVar(&huntEndpointID, "endpoint", "", "Filter by endpoint ID")
}
