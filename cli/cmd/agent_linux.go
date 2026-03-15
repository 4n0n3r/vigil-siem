//go:build linux

package cmd

import (
	"path/filepath"

	"github.com/vigil/vigil/internal/agent"
)

// addPlatformCollectors wires Linux log collectors into the agent.
// profile controls which collectors are enabled:
//
//	minimal  — journald only
//	standard — journald + /var/log/auth.log
//	full     — journald + /var/log/auth.log + /var/log/syslog
func addPlatformCollectors(a *agent.Agent, cfg agent.Config, profile string) {
	// Journald is always included.
	cursorFile := filepath.Join(cfg.BookmarkDir, "journald_cursor")
	a.AddCollector(agent.NewJournaldCollector(cursorFile))

	if profile == "minimal" {
		return
	}

	// standard and full: add auth.log
	authOffset := filepath.Join(cfg.BookmarkDir, "syslog_auth.offset")
	a.AddCollector(agent.NewSyslogCollector("/var/log/auth.log", "syslog:auth", authOffset))

	if profile == "full" {
		syslogOffset := filepath.Join(cfg.BookmarkDir, "syslog_syslog.offset")
		a.AddCollector(agent.NewSyslogCollector("/var/log/syslog", "syslog:syslog", syslogOffset))
	}
}
