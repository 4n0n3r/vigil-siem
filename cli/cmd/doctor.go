package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/agent"
	"github.com/vigil/vigil/internal/config"
	"github.com/vigil/vigil/internal/output"
)

type doctorCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"` // "pass" | "fail" | "warn"
	Detail string `json:"detail"`
	Hint   string `json:"hint"`
}

type doctorResult struct {
	Checks []doctorCheck `json:"checks"`
	Passed int           `json:"passed"`
	Failed int           `json:"failed"`
	Warned int           `json:"warned"`
}

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Diagnose API connectivity and local configuration",
	Long: `Run a series of health checks and report pass/fail/warn with actionable hints.

Checks:
  1. API reachability    — GET /v1/status returns 200
  2. ClickHouse          — status.clickhouse_status == "ok"
  3. PostgreSQL          — status.postgres_status == "ok"
  4. Config file         — file exists and parses cleanly
  5. Agent status file   — agent is (or recently was) running locally`,
	RunE: func(cmd *cobra.Command, args []string) error {
		var checks []doctorCheck

		// ------------------------------------------------------------------
		// Check 1: API reachability + parse status response
		// ------------------------------------------------------------------
		type statusResp struct {
			APIStatus        string `json:"api_status"`
			ClickhouseStatus string `json:"clickhouse_status"`
			PostgresStatus   string `json:"postgres_status"`
		}
		var sr statusResp
		apiErr := apiClient.Get("/v1/status", nil, &sr)

		if apiErr != nil {
			checks = append(checks, doctorCheck{
				Name:   "api_reachability",
				Status: "fail",
				Detail: apiErr.Error(),
				Hint:   "check VIGIL_API_URL env or run 'vigil config set api_url <url>'",
			})
			// Skip DB checks — we have no status to inspect.
			checks = append(checks, doctorCheck{
				Name:   "clickhouse",
				Status: "warn",
				Detail: "skipped — API unreachable",
				Hint:   "",
			})
			checks = append(checks, doctorCheck{
				Name:   "postgres",
				Status: "warn",
				Detail: "skipped — API unreachable",
				Hint:   "",
			})
		} else {
			checks = append(checks, doctorCheck{
				Name:   "api_reachability",
				Status: "pass",
				Detail: fmt.Sprintf("api_status=%s", sr.APIStatus),
				Hint:   "",
			})

			// Check 2: ClickHouse
			if sr.ClickhouseStatus == "ok" {
				checks = append(checks, doctorCheck{
					Name:   "clickhouse",
					Status: "pass",
					Detail: "clickhouse_status=ok",
					Hint:   "",
				})
			} else {
				checks = append(checks, doctorCheck{
					Name:   "clickhouse",
					Status: "warn",
					Detail: fmt.Sprintf("clickhouse_status=%s", sr.ClickhouseStatus),
					Hint:   "set CLICKHOUSE_DSN in api/.env (events will use in-memory fallback)",
				})
			}

			// Check 3: PostgreSQL
			if sr.PostgresStatus == "ok" {
				checks = append(checks, doctorCheck{
					Name:   "postgres",
					Status: "pass",
					Detail: "postgres_status=ok",
					Hint:   "",
				})
			} else {
				checks = append(checks, doctorCheck{
					Name:   "postgres",
					Status: "fail",
					Detail: fmt.Sprintf("postgres_status=%s", sr.PostgresStatus),
					Hint:   "set POSTGRES_DSN in api/.env (alerts and detections require PostgreSQL)",
				})
			}
		}

		// ------------------------------------------------------------------
		// Check 4: Config file
		// ------------------------------------------------------------------
		cfgPath := config.DefaultConfigPath()
		cfg, cfgErr := config.Load(cfgPath)
		if cfgErr != nil {
			checks = append(checks, doctorCheck{
				Name:   "config_file",
				Status: "fail",
				Detail: cfgErr.Error(),
				Hint:   "run 'vigil config set api_url http://localhost:8001' to create the file",
			})
		} else if cfg.APIURL == "" && cfg.APIKey == "" && cfg.EndpointID == "" {
			checks = append(checks, doctorCheck{
				Name:   "config_file",
				Status: "warn",
				Detail: fmt.Sprintf("file not found or empty: %s", cfgPath),
				Hint:   "run 'vigil config set api_url http://localhost:8001'",
			})
		} else {
			checks = append(checks, doctorCheck{
				Name:   "config_file",
				Status: "pass",
				Detail: cfgPath,
				Hint:   "",
			})
		}

		// ------------------------------------------------------------------
		// Check 5: Agent status file
		// ------------------------------------------------------------------
		agentCfg := agent.DefaultConfig()
		_, agentErr := agent.ReadStatusFile(agentCfg.StatusFile)
		if agentErr != nil {
			checks = append(checks, doctorCheck{
				Name:   "agent_status",
				Status: "warn",
				Detail: agentErr.Error(),
				Hint:   "agent may not be running locally (not an error for remote agents)",
			})
		} else {
			checks = append(checks, doctorCheck{
				Name:   "agent_status",
				Status: "pass",
				Detail: "agent status file found",
				Hint:   "",
			})
		}

		// ------------------------------------------------------------------
		// Tally
		// ------------------------------------------------------------------
		result := doctorResult{Checks: checks}
		for _, c := range checks {
			switch c.Status {
			case "pass":
				result.Passed++
			case "fail":
				result.Failed++
			case "warn":
				result.Warned++
			}
		}

		// ------------------------------------------------------------------
		// Output
		// ------------------------------------------------------------------
		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(result)
			return nil
		}

		statusIcon := map[string]string{
			"pass": "PASS",
			"fail": "FAIL",
			"warn": "WARN",
		}
		t := output.NewTable([]string{"Check", "Status", "Detail", "Hint"})
		for _, c := range checks {
			icon := statusIcon[c.Status]
			hint := c.Hint
			if len(hint) > 60 {
				hint = hint[:57] + "..."
			}
			t.Append([]string{c.Name, icon, c.Detail, hint})
		}
		t.Render()
		fmt.Printf("\nPassed: %d  Failed: %d  Warned: %d\n",
			result.Passed, result.Failed, result.Warned)

		return nil
	},
}
