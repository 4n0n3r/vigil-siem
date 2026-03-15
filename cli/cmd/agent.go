package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/agent"
	"github.com/vigil/vigil/internal/output"
)

// ----------------------------------------------------------------------------
// Flag vars for vigil agent start
// ----------------------------------------------------------------------------

var (
	agentChannels      []string
	agentBatchSize     int
	agentFlushInterval time.Duration
	agentBookmarkFile  string
	agentProfile       string
)

// ----------------------------------------------------------------------------
// agentCmd — the parent "vigil agent" group
// ----------------------------------------------------------------------------

var agentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Event log collection agent (Windows & Linux)",
	Long: `The Vigil agent collects system events and streams them to the API.

Subcommands:
  start      Start collecting events (foreground)
  install    Install as a Windows Service (auto-start)
  uninstall  Remove the Windows Service
  status     Show agent health and statistics`,
}

// ----------------------------------------------------------------------------
// vigil agent start
// ----------------------------------------------------------------------------

var agentStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start collecting events (foreground, Ctrl+C to stop)",
	Long: `Start the Vigil agent in the foreground.

On Windows: collects Windows Event Log channels.
On Linux:   collects systemd journal and syslog files.

Use --profile to select a preset collector set, or --channels to override
the Windows channel list explicitly.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg := agent.DefaultConfig()

		// --channels explicitly overrides cfg.Channels (Windows only; on Linux
		// the profile controls which collectors are added).
		if len(agentChannels) > 0 {
			cfg.Channels = agentChannels
		} else {
			// Clear the default so agent_windows.go profile mapping takes over.
			cfg.Channels = nil
		}
		if agentBatchSize > 0 {
			cfg.BatchSize = agentBatchSize
		}
		if agentFlushInterval > 0 {
			cfg.FlushInterval = agentFlushInterval
		}
		if agentBookmarkFile != "" {
			cfg.BookmarkFile = agentBookmarkFile
		}

		a := agent.New(apiClient, cfg)

		// Wire platform-specific collectors (defined in agent_windows.go / agent_linux.go).
		addPlatformCollectors(a, cfg, agentProfile)

		// Detect Windows Service invocation.
		if agent.RunningAsService() {
			if err := agent.RunAsService(a); err != nil {
				output.PrintError("SERVICE_RUN_ERROR", "failed to run as Windows Service", err.Error())
				return nil
			}
			return nil
		}

		// Foreground mode: run until Ctrl+C / SIGTERM.
		ctx, cancel := context.WithCancel(context.Background())

		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
		go func() {
			<-sigCh
			fmt.Fprintln(os.Stderr, "\nShutting down agent…")
			cancel()
		}()

		// Get the actual collector names for display.
		collectors := a.Stats().Channels

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			type startMsg struct {
				Status     string   `json:"status"`
				Profile    string   `json:"profile"`
				Collectors []string `json:"collectors"`
			}
			output.PrintJSON(startMsg{Status: "started", Profile: agentProfile, Collectors: collectors})
		} else {
			fmt.Printf("Vigil agent started. Profile: %s. Watching %d collector(s). Press Ctrl+C to stop.\n",
				agentProfile, len(collectors))
			for _, ch := range collectors {
				fmt.Printf("  • %s\n", ch)
			}
		}

		if err := a.Run(ctx); err != nil {
			output.PrintError("AGENT_ERROR", "agent exited with error", err.Error())
			return nil
		}

		if mode == output.ModeJSON {
			type stopMsg struct {
				Status string `json:"status"`
			}
			output.PrintJSON(stopMsg{Status: "stopped"})
		} else {
			fmt.Println("Agent stopped.")
		}
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil agent install
// ----------------------------------------------------------------------------

var agentInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Install Vigil agent as a Windows Service (auto-start, LocalSystem)",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := agent.InstallService(); err != nil {
			output.PrintError("INSTALL_ERROR", "failed to install Windows Service", err.Error())
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			type result struct {
				Status      string `json:"status"`
				ServiceName string `json:"service_name"`
			}
			output.PrintJSON(result{Status: "installed", ServiceName: "VIGILAgent"})
		} else {
			t := output.NewTable([]string{"Field", "Value"})
			t.Append([]string{"Status", "installed"})
			t.Append([]string{"Service Name", "VIGILAgent"})
			t.Append([]string{"Display Name", "Vigil Security Agent"})
			t.Append([]string{"Start Type", "Automatic"})
			t.Render()
			fmt.Println()
			fmt.Println("Start the service with:  sc start VIGILAgent")
		}
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil agent uninstall
// ----------------------------------------------------------------------------

var agentUninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Remove the Vigil agent Windows Service",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := agent.UninstallService(); err != nil {
			output.PrintError("UNINSTALL_ERROR", "failed to uninstall Windows Service", err.Error())
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			type result struct {
				Status      string `json:"status"`
				ServiceName string `json:"service_name"`
			}
			output.PrintJSON(result{Status: "uninstalled", ServiceName: "VIGILAgent"})
		} else {
			t := output.NewTable([]string{"Field", "Value"})
			t.Append([]string{"Status", "uninstalled"})
			t.Append([]string{"Service Name", "VIGILAgent"})
			t.Render()
			fmt.Println()
		}
		return nil
	},
}

// ----------------------------------------------------------------------------
// vigil agent status
// ----------------------------------------------------------------------------

var agentStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show agent health: collectors, events/sec, last flush, errors",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg := agent.DefaultConfig()

		stats, err := agent.ReadStatusFile(cfg.StatusFile)
		if err != nil {
			output.PrintError(
				"STATUS_UNAVAILABLE",
				"could not read agent status file — is the agent running?",
				err.Error(),
			)
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			output.PrintJSON(stats)
			return nil
		}

		now := time.Now().UTC()
		uptime := now.Sub(stats.StartedAt).Truncate(time.Second)

		lastFlush := "never"
		if !stats.LastFlushAt.IsZero() {
			lastFlush = fmt.Sprintf("%s ago", now.Sub(stats.LastFlushAt).Truncate(time.Second))
		}

		lastError := "none"
		if stats.LastError != "" {
			lastError = stats.LastError
		}

		channels := "none"
		if len(stats.Channels) > 0 {
			channels = ""
			for i, ch := range stats.Channels {
				if i > 0 {
					channels += ", "
				}
				channels += ch
			}
		}

		t := output.NewTable([]string{"Stat", "Value"})
		t.Append([]string{"Started At", stats.StartedAt.Format("2006-01-02 15:04:05")})
		t.Append([]string{"Uptime", uptime.String()})
		t.Append([]string{"Events Collected", fmt.Sprintf("%d", stats.EventsCollected)})
		t.Append([]string{"Events Flushed", fmt.Sprintf("%d", stats.EventsFlushed)})
		t.Append([]string{"Flush Errors", fmt.Sprintf("%d", stats.FlushErrors)})
		t.Append([]string{"Last Flush", lastFlush})
		t.Append([]string{"Last Error", lastError})
		t.Append([]string{"Collectors", channels})
		t.Render()
		fmt.Println()
		return nil
	},
}

// ----------------------------------------------------------------------------
// init: wire flags and subcommands
// ----------------------------------------------------------------------------

func init() {
	// Flags for vigil agent start.
	agentStartCmd.Flags().StringSliceVar(
		&agentChannels, "channels", nil,
		"Windows Event Log channels to monitor (comma-separated; overrides --profile on Windows)",
	)
	agentStartCmd.Flags().StringVar(
		&agentProfile, "profile", "standard",
		"Collector profile: minimal|standard|full",
	)
	agentStartCmd.Flags().IntVar(
		&agentBatchSize, "batch-size", 100,
		"Number of events to accumulate before flushing to the API",
	)
	agentStartCmd.Flags().DurationVar(
		&agentFlushInterval, "flush-interval", 5*time.Second,
		"Maximum time between flushes (e.g. 5s, 30s, 1m)",
	)
	agentStartCmd.Flags().StringVar(
		&agentBookmarkFile, "bookmark-file", "",
		"Path to bookmark file (default: %%APPDATA%%\\Vigil\\agent_bookmark.xml)",
	)

	// Register subcommands under agentCmd.
	agentCmd.AddCommand(agentStartCmd)
	agentCmd.AddCommand(agentInstallCmd)
	agentCmd.AddCommand(agentUninstallCmd)
	agentCmd.AddCommand(agentStatusCmd)

	// Register agentCmd under rootCmd.
	rootCmd.AddCommand(agentCmd)
}
