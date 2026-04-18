//go:build linux

package agent

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ForensicCollector performs a one-shot sweep of forensic artifacts on Linux.
// It emits all collected artifacts onto the channel, then closes it.
// Artifacts: cron jobs, systemd services, SUID binaries, SSH authorized keys,
// user accounts, listening network services, bash history, installed packages.
type ForensicCollector struct{}

// NewForensicCollector creates a forensic sweep collector.
func NewForensicCollector() *ForensicCollector { return &ForensicCollector{} }

func (fc *ForensicCollector) Name() string { return "forensic:sweep" }

// Start launches the sweep goroutine and returns immediately.
// The returned channel is closed when the sweep completes.
func (fc *ForensicCollector) Start(ctx context.Context) (<-chan Event, error) {
	out := make(chan Event, 1024)
	go fc.sweep(ctx, out)
	return out, nil
}

func (fc *ForensicCollector) sweep(ctx context.Context, out chan<- Event) {
	defer close(out)
	fc.collectCron(ctx, out)
	fc.collectServices(ctx, out)
	fc.collectSUID(ctx, out)
	fc.collectSSHKeys(ctx, out)
	fc.collectUsers(ctx, out)
	fc.collectNetwork(ctx, out)
	fc.collectBashHistory(ctx, out)
	fc.collectPackages(ctx, out)
}

// ----------------------------------------------------------------------------
// Cron jobs
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectCron(ctx context.Context, out chan<- Event) {
	// System cron dirs.
	dirs := []string{"/etc/cron.d", "/etc/cron.daily", "/etc/cron.weekly", "/etc/cron.monthly", "/etc/cron.hourly"}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if ctx.Err() != nil {
				return
			}
			if entry.IsDir() {
				continue
			}
			path := filepath.Join(dir, entry.Name())
			fc.emitFileLines(ctx, out, "forensic:cron", path, map[string]interface{}{
				"artifact": "cron",
				"source":   path,
			})
		}
	}

	// /etc/crontab
	fc.emitFileLines(ctx, out, "forensic:cron", "/etc/crontab", map[string]interface{}{
		"artifact": "cron",
		"source":   "/etc/crontab",
	})

	// User crontabs.
	spoolDir := "/var/spool/cron/crontabs"
	entries, err := os.ReadDir(spoolDir)
	if err != nil {
		// RHEL path
		spoolDir = "/var/spool/cron"
		entries, err = os.ReadDir(spoolDir)
	}
	if err == nil {
		for _, entry := range entries {
			if ctx.Err() != nil {
				return
			}
			if entry.IsDir() {
				continue
			}
			path := filepath.Join(spoolDir, entry.Name())
			fc.emitFileLines(ctx, out, "forensic:cron", path, map[string]interface{}{
				"artifact": "cron",
				"source":   path,
				"user":     entry.Name(),
			})
		}
	}
}

func (fc *ForensicCollector) emitFileLines(ctx context.Context, out chan<- Event, source, path string, base map[string]interface{}) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		payload := make(map[string]interface{}, len(base)+2)
		for k, v := range base {
			payload[k] = v
		}
		payload["line"] = line
		fc.emit(ctx, out, source, payload)
	}
}

// ----------------------------------------------------------------------------
// Systemd services
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectServices(ctx context.Context, out chan<- Event) {
	tctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(tctx, "systemctl", "list-units", "--type=service", "--state=enabled", "--no-pager", "--plain", "--no-legend")
	data, err := cmd.Output()
	if err != nil {
		return
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := scanner.Text()
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		unitName := fields[0]
		// Get the ExecStart for this unit.
		execStart := fc.getServiceExecStart(ctx, unitName)
		fc.emit(ctx, out, "forensic:services", map[string]interface{}{
			"artifact":    "service",
			"unit":        unitName,
			"load":        fields[1],
			"active":      fields[2],
			"sub":         fields[3],
			"exec_start":  execStart,
		})
	}
}

func (fc *ForensicCollector) getServiceExecStart(ctx context.Context, unit string) string {
	tctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(tctx, "systemctl", "show", unit, "--property=ExecStart", "--no-pager")
	data, err := cmd.Output()
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(data))
	// ExecStart={ path=/usr/bin/foo ; argv[]=...
	if idx := strings.Index(line, "path="); idx >= 0 {
		rest := line[idx+5:]
		if end := strings.IndexAny(rest, " ;"); end >= 0 {
			return rest[:end]
		}
		return rest
	}
	return line
}

// ----------------------------------------------------------------------------
// SUID binaries
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectSUID(ctx context.Context, out chan<- Event) {
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(tctx, "find", "/", "-perm", "/4000", "-type", "f",
		"-not", "-path", "/proc/*",
		"-not", "-path", "/sys/*",
		"-not", "-path", "/dev/*",
		"2>/dev/null")
	// find doesn't support shell redirects; stderr will just produce noise, ignore it.
	cmd = exec.CommandContext(tctx, "find", "/", "-perm", "/4000", "-type", "f",
		"-not", "-path", "/proc/*",
		"-not", "-path", "/sys/*",
		"-not", "-path", "/dev/*")
	data, err := cmd.Output()
	if err != nil && len(data) == 0 {
		return
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		path := strings.TrimSpace(scanner.Text())
		if path == "" {
			continue
		}
		info, err := os.Stat(path)
		payload := map[string]interface{}{
			"artifact": "suid_binary",
			"path":     path,
		}
		if err == nil {
			payload["size_bytes"] = info.Size()
			payload["modified_at"] = info.ModTime().UTC().Format(time.RFC3339)
		}
		fc.emit(ctx, out, "forensic:suid", payload)
	}
}

// ----------------------------------------------------------------------------
// SSH authorized keys
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectSSHKeys(ctx context.Context, out chan<- Event) {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := scanner.Text()
		parts := strings.Split(line, ":")
		if len(parts) < 6 {
			continue
		}
		username := parts[0]
		homeDir := parts[5]
		if homeDir == "" || homeDir == "/" {
			continue
		}

		authKeysPath := filepath.Join(homeDir, ".ssh", "authorized_keys")
		keysFile, err := os.Open(authKeysPath)
		if err != nil {
			continue
		}

		ks := bufio.NewScanner(keysFile)
		for ks.Scan() {
			keyLine := strings.TrimSpace(ks.Text())
			if keyLine == "" || strings.HasPrefix(keyLine, "#") {
				continue
			}
			// Extract key type and comment (first two fields + rest as comment).
			keyFields := strings.Fields(keyLine)
			keyType := ""
			comment := ""
			if len(keyFields) >= 1 {
				keyType = keyFields[0]
			}
			if len(keyFields) >= 3 {
				comment = keyFields[2]
			}
			fc.emit(ctx, out, "forensic:ssh_keys", map[string]interface{}{
				"artifact": "ssh_authorized_key",
				"user":     username,
				"home":     homeDir,
				"key_type": keyType,
				"comment":  comment,
				"raw_line": keyLine,
			})
		}
		keysFile.Close()
	}
}

// ----------------------------------------------------------------------------
// User accounts
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectUsers(ctx context.Context, out chan<- Event) {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := scanner.Text()
		parts := strings.Split(line, ":")
		if len(parts) < 7 {
			continue
		}
		fc.emit(ctx, out, "forensic:users", map[string]interface{}{
			"artifact": "user_account",
			"name":     parts[0],
			"uid":      parts[2],
			"gid":      parts[3],
			"home":     parts[5],
			"shell":    parts[6],
		})
	}
}

// ----------------------------------------------------------------------------
// Listening network services
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectNetwork(ctx context.Context, out chan<- Event) {
	tctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(tctx, "ss", "-tlnp")
	data, err := cmd.Output()
	if err != nil {
		return
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
	first := true
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		if first {
			first = false
			continue // skip header
		}
		line := scanner.Text()
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		localAddr := fields[3]
		process := ""
		if len(fields) >= 6 {
			process = fields[5]
		}
		fc.emit(ctx, out, "forensic:network", map[string]interface{}{
			"artifact":   "listening_port",
			"state":      fields[0],
			"local_addr": localAddr,
			"process":    process,
		})
	}
}

// ----------------------------------------------------------------------------
// Bash history
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectBashHistory(ctx context.Context, out chan<- Event) {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := scanner.Text()
		parts := strings.Split(line, ":")
		if len(parts) < 6 {
			continue
		}
		username := parts[0]
		homeDir := parts[5]
		if homeDir == "" {
			continue
		}

		histPath := filepath.Join(homeDir, ".bash_history")
		fc.emitLastNLines(ctx, out, "forensic:bash_history", histPath, username, 200)
	}
}

func (fc *ForensicCollector) emitLastNLines(ctx context.Context, out chan<- Event, source, path, username string, n int) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	// Read all lines, keep last n.
	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}

	for _, l := range lines {
		if ctx.Err() != nil {
			return
		}
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		fc.emit(ctx, out, source, map[string]interface{}{
			"artifact": "bash_history",
			"user":     username,
			"command":  l,
		})
	}
}

// ----------------------------------------------------------------------------
// Installed packages
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectPackages(ctx context.Context, out chan<- Event) {
	// Try dpkg first (Debian/Ubuntu), then rpm (RHEL/CentOS).
	if _, err := exec.LookPath("dpkg-query"); err == nil {
		fc.collectDpkgPackages(ctx, out)
		return
	}
	if _, err := exec.LookPath("rpm"); err == nil {
		fc.collectRpmPackages(ctx, out)
	}
}

func (fc *ForensicCollector) collectDpkgPackages(ctx context.Context, out chan<- Event) {
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(tctx, "dpkg-query", "-W", "-f=${Package}\t${Version}\t${Architecture}\n")
	data, err := cmd.Output()
	if err != nil {
		return
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		fields := strings.Split(scanner.Text(), "\t")
		if len(fields) < 3 {
			continue
		}
		fc.emit(ctx, out, "forensic:packages", map[string]interface{}{
			"artifact":    "package",
			"manager":     "dpkg",
			"name":        fields[0],
			"version":     fields[1],
			"arch":        fields[2],
		})
	}
}

func (fc *ForensicCollector) collectRpmPackages(ctx context.Context, out chan<- Event) {
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(tctx, "rpm", "-qa", "--queryformat", "%{NAME}\t%{VERSION}\t%{ARCH}\n")
	data, err := cmd.Output()
	if err != nil {
		return
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		fields := strings.Split(scanner.Text(), "\t")
		if len(fields) < 3 {
			continue
		}
		fc.emit(ctx, out, "forensic:packages", map[string]interface{}{
			"artifact": "package",
			"manager":  "rpm",
			"name":     fields[0],
			"version":  fields[1],
			"arch":     fields[2],
		})
	}
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) emit(ctx context.Context, out chan<- Event, source string, payload map[string]interface{}) {
	ev := Event{Source: source, Event: payload, Timestamp: time.Now().UTC()}
	select {
	case out <- ev:
	case <-ctx.Done():
	}
}

// SaveBookmark is a no-op — forensic sweeps have no resume state.
func (fc *ForensicCollector) SaveBookmark(_ string) error { return nil }

func (fc *ForensicCollector) logErr(code, msg string) {
	fmt.Fprintf(os.Stderr, "{\"error_code\":%q,\"message\":%q}\n", code, msg)
}
