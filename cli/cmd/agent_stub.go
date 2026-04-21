//go:build !windows && !linux

package cmd

import (
	"github.com/vigil/vigil/internal/agent"
)

// addPlatformCollectors is a no-op on platforms other than Windows and Linux.
func addPlatformCollectors(_ *agent.Agent, _ agent.Config, _ string) {}

// platformServiceInfo returns empty strings on unsupported platforms.
func platformServiceInfo() (name, startHint string) { return "", "" }
