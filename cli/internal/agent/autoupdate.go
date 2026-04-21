package agent

import (
	"sync"

	"github.com/vigil/vigil/internal/updater"
)

// updateOnce ensures we attempt at most one self-update per process lifetime.
var updateOnce sync.Once

// TryAutoUpdate checks whether latestVersion differs from the running version
// and, if so, downloads, verifies, and applies the update then restarts.
//
// Guards:
//   - Only runs once per process (sync.Once).
//   - Skips if version == "dev" (local / untagged build).
//   - Skips if latestVersion is empty or matches current version.
//
// This function may not return on success — on all platforms it exits the
// process after a successful update so the service manager can restart with
// the new binary.
func TryAutoUpdate(version, binaryFlavor, latestVersion string, logErr func(code, msg string)) {
	if version == "dev" || latestVersion == "" || latestVersion == version {
		return
	}

	updateOnce.Do(func() {
		if binaryFlavor == "" {
			binaryFlavor = "vigil"
		}

		// Resolve the release metadata for the specific version the API advertises.
		release, err := updater.CheckLatestVersion(latestVersion, binaryFlavor)
		if err != nil {
			logErr("AUTO_UPDATE_CHECK", err.Error())
			return
		}

		logErr("AUTO_UPDATE_START",
			"updating from "+version+" to "+release.Version+" — agent will restart")

		// applyAndRestart is platform-specific (see autoupdate_linux.go / autoupdate_windows.go).
		if err := applyAndRestart(release); err != nil {
			logErr("AUTO_UPDATE_FAILED", err.Error())
		}
		// On success applyAndRestart never returns — it calls os.Exit().
	})
}
