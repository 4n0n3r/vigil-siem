//go:build windows

package cmd

import (
	"github.com/vigil/vigil/internal/agent"
)

// windowsProfileChannels maps a profile name to the Windows Event Log channels
// that should be monitored for that profile.
func windowsProfileChannels(profile string) []string {
	switch profile {
	case "minimal":
		return []string{"Security"}
	case "full":
		return []string{
			"Security",
			"System",
			"Application",
			"Microsoft-Windows-Sysmon/Operational",
			"Microsoft-Windows-PowerShell/Operational",
			"Microsoft-Windows-WMI-Activity/Operational",
			"Microsoft-Windows-TaskScheduler/Operational",
			"Microsoft-Windows-Windows Defender/Operational",
			"Microsoft-Windows-Bits-Client/Operational",
		}
	default: // "standard"
		return []string{
			"Security",
			"System",
			"Application",
			"Microsoft-Windows-Sysmon/Operational",
			"Microsoft-Windows-PowerShell/Operational",
		}
	}
}

// addPlatformCollectors wires Windows Event Log collectors into the agent.
// If explicit channels were set via --channels, those take precedence over profile.
func addPlatformCollectors(a *agent.Agent, cfg agent.Config, profile string) {
	channels := cfg.Channels
	if len(channels) == 0 {
		channels = windowsProfileChannels(profile)
	}
	bookmarkXML := agent.LoadBookmarkXML(cfg.BookmarkFile)
	for _, col := range agent.NewWindowsCollectors(channels, bookmarkXML) {
		a.AddCollector(col)
	}
}
