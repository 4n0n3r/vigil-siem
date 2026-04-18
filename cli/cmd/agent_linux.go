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
//	standard — journald + /var/log/auth.log + /var/log/secure
//	full     — journald + /var/log/auth.log + /var/log/secure + /var/log/syslog + auditd
func addPlatformCollectors(a *agent.Agent, cfg agent.Config, profile string) {
	// Journald is always included.
	cursorFile := filepath.Join(cfg.BookmarkDir, "journald_cursor")
	a.AddCollector(agent.NewJournaldCollector(cursorFile))

	if profile == "minimal" {
		return
	}

	// standard and full: add auth.log and /var/log/secure.
	authOffset := filepath.Join(cfg.BookmarkDir, "syslog_auth.offset")
	a.AddCollector(agent.NewSyslogCollector("/var/log/auth.log", "syslog:auth", authOffset))

	secureOffset := filepath.Join(cfg.BookmarkDir, "syslog_secure.offset")
	a.AddCollector(agent.NewSyslogCollector("/var/log/secure", "syslog:secure", secureOffset))

	if profile == "full" {
		syslogOffset := filepath.Join(cfg.BookmarkDir, "syslog_syslog.offset")
		a.AddCollector(agent.NewSyslogCollector("/var/log/syslog", "syslog:syslog", syslogOffset))

		auditdOffset := filepath.Join(cfg.BookmarkDir, "auditd.offset")
		a.AddCollector(agent.NewAuditdCollector(auditdOffset))
	}
}
