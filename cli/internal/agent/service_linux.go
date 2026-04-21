//go:build linux

package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/vigil/vigil/internal/config"
)

const (
	ServiceName = "vigil-agent"
	unitPath    = "/etc/systemd/system/vigil-agent.service"
	envFilePath = "/etc/vigil/env"
)

// InstallService writes a systemd unit file, an env credentials file, and
// enables the service to start on boot.
func InstallService() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not determine executable path: %w", err)
	}

	if _, err := os.Stat(unitPath); err == nil {
		return fmt.Errorf("service already installed — run 'vigil agent uninstall' first")
	}

	unitContent := fmt.Sprintf(`[Unit]
Description=Vigil Security Agent
After=network.target

[Service]
ExecStart=%s agent start
Restart=on-failure
RestartSec=5
EnvironmentFile=-%s

[Install]
WantedBy=multi-user.target
`, exePath, envFilePath)

	if err := os.WriteFile(unitPath, []byte(unitContent), 0644); err != nil {
		return fmt.Errorf("could not write unit file %s: %w", unitPath, err)
	}

	// Write credentials to env file so the service can authenticate.
	cfgPath := config.DefaultConfigPath()
	if cfg, err := config.Load(cfgPath); err == nil {
		if err := writeEnvFile(cfg.APIURL, cfg.APIKey, cfg.EndpointID); err != nil {
			// Non-fatal: service will still start, just won't have credentials baked in.
			fmt.Fprintf(os.Stderr, "warning: could not write env file: %v\n", err)
		}
	}

	if out, err := exec.Command("systemctl", "daemon-reload").CombinedOutput(); err != nil {
		_ = os.Remove(unitPath)
		return fmt.Errorf("systemctl daemon-reload failed: %s: %w", out, err)
	}
	if out, err := exec.Command("systemctl", "enable", "--now", ServiceName).CombinedOutput(); err != nil {
		_ = os.Remove(unitPath)
		return fmt.Errorf("systemctl enable failed: %s: %w", out, err)
	}
	return nil
}

// UninstallService stops, disables, and removes the systemd unit.
func UninstallService() error {
	if _, err := os.Stat(unitPath); os.IsNotExist(err) {
		return fmt.Errorf("service not installed — unit file %s not found", unitPath)
	}

	// Stop and disable. Ignore errors if the service isn't running.
	exec.Command("systemctl", "disable", "--now", ServiceName).Run() //nolint:errcheck

	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("could not remove unit file: %w", err)
	}

	// Remove env file if present (best effort).
	os.Remove(envFilePath) //nolint:errcheck

	if out, err := exec.Command("systemctl", "daemon-reload").CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl daemon-reload failed: %s: %w", out, err)
	}
	return nil
}

// RestartService restarts the systemd service.
func RestartService() error {
	out, err := exec.Command("systemctl", "restart", ServiceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl restart failed: %s: %w", out, err)
	}
	return nil
}

// RunningAsService returns false on Linux. Systemd runs the process in the
// foreground, so the normal signal-handling path in agentStartCmd is used.
func RunningAsService() bool { return false }

// RunAsService is unreachable on Linux (RunningAsService always returns false).
func RunAsService(_ *Agent) error {
	return &PlatformError{}
}

// writeEnvFile writes API credentials to envFilePath (mode 0600).
func writeEnvFile(apiURL, apiKey, endpointID string) error {
	if err := os.MkdirAll(filepath.Dir(envFilePath), 0755); err != nil {
		return err
	}
	content := fmt.Sprintf("VIGIL_API_URL=%s\nVIGIL_API_KEY=%s\nVIGIL_ENDPOINT_ID=%s\n",
		apiURL, apiKey, endpointID)
	return os.WriteFile(envFilePath, []byte(content), 0600)
}

