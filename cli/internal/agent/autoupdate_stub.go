//go:build !linux && !windows

package agent

import (
	"fmt"

	"github.com/vigil/vigil/internal/updater"
)

// applyAndRestart is not supported on this platform.
func applyAndRestart(_ *updater.Release) error {
	return fmt.Errorf("auto-update not supported on this platform")
}
