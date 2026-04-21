//go:build windows

package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/vigil/vigil/internal/updater"
)

const psScriptTmpl = `
$ErrorActionPreference = 'Stop'
Start-Sleep -Seconds 3

$exePath    = '{{.ExePath}}'
$updatePath = '{{.UpdatePath}}'
$backupPath = '{{.BackupPath}}'
$scriptPath = $MyInvocation.MyCommand.Path

try {
    # Old exe is now unlocked (agent exited). Move it aside, then install update.
    if (Test-Path $backupPath) { Remove-Item $backupPath -Force }
    if (Test-Path $exePath)    { Move-Item $exePath $backupPath -Force }
    Move-Item $updatePath $exePath -Force

    # Restart service if installed; silently skip if not.
    $svc = Get-Service -Name 'VIGILAgent' -ErrorAction SilentlyContinue
    if ($svc) { Start-Service -Name 'VIGILAgent' -ErrorAction SilentlyContinue }
} catch {
    # Rollback: restore the backup so the operator can manually retry.
    if ((Test-Path $backupPath) -and -not (Test-Path $exePath)) {
        Move-Item $backupPath $exePath -Force
    }
} finally {
    Remove-Item $scriptPath -Force -ErrorAction SilentlyContinue
}
`

// applyAndRestart on Windows:
//  1. Downloads the new binary to {exe}.update (verified via SHA256).
//  2. Writes a temporary PowerShell script that renames files and restarts the service.
//  3. Launches the script detached (it runs after this process exits).
//  4. Calls os.Exit(0) — releasing the exe lock so the script can rename.
//
// DOES NOT RETURN on success.
func applyAndRestart(release *updater.Release) error {
	exePath, err := resolveExePath()
	if err != nil {
		return err
	}

	updatePath := exePath + ".update"
	backupPath := exePath + ".old"

	// Clean up any leftover update file from a previous attempt.
	_ = os.Remove(updatePath)

	if err := updater.Download(release, updatePath); err != nil {
		return err
	}

	// Render the PowerShell script into a temp file.
	type scriptVars struct {
		ExePath    string
		UpdatePath string
		BackupPath string
	}
	vars := scriptVars{
		ExePath:    toPSPath(exePath),
		UpdatePath: toPSPath(updatePath),
		BackupPath: toPSPath(backupPath),
	}

	scriptPath := filepath.Join(os.TempDir(), "vigil_update.ps1")
	sf, err := os.Create(scriptPath)
	if err != nil {
		_ = os.Remove(updatePath)
		return fmt.Errorf("could not write update script: %w", err)
	}
	tmpl := template.Must(template.New("ps").Parse(psScriptTmpl))
	if err := tmpl.Execute(sf, vars); err != nil {
		sf.Close()
		_ = os.Remove(updatePath)
		_ = os.Remove(scriptPath)
		return fmt.Errorf("could not render update script: %w", err)
	}
	sf.Close()

	// Launch PowerShell detached so it outlives this process.
	cmd := exec.Command("powershell",
		"-NonInteractive",
		"-WindowStyle", "Hidden",
		"-ExecutionPolicy", "Bypass",
		"-File", scriptPath,
	)
	if err := cmd.Start(); err != nil {
		_ = os.Remove(updatePath)
		_ = os.Remove(scriptPath)
		return fmt.Errorf("could not launch update script: %w", err)
	}

	// Exit immediately so the exe lock is released.
	// The PowerShell script waits 3 s before renaming to be safe.
	os.Exit(0)
	return nil // unreachable
}

// resolveExePath returns the absolute real path of the current executable.
func resolveExePath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("could not determine executable path: %w", err)
	}
	return filepath.EvalSymlinks(exe)
}

// toPSPath escapes a Windows path for embedding in a PowerShell single-quoted string.
func toPSPath(p string) string {
	return strings.ReplaceAll(p, "'", "''")
}
