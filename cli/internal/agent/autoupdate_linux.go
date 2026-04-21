//go:build linux

package agent

import (
	"os"

	"github.com/vigil/vigil/internal/updater"
)

// applyAndRestart on Linux uses an atomic rename (safe even while running),
// then exits so systemd restarts the process with the new binary.
// DOES NOT RETURN on success.
func applyAndRestart(release *updater.Release) error {
	if err := updater.Apply(release, nil); err != nil {
		return err
	}
	// os.Exit causes systemd (Restart=on-failure) to respawn with the new binary.
	os.Exit(0)
	return nil // unreachable
}
