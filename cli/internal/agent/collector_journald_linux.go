//go:build linux

package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"time"
)

// JournaldCollector tails the systemd journal using journalctl -f -o json.
// The journalctl process manages its own cursor file for bookmark/resume.
type JournaldCollector struct {
	cursorFile string
}

// NewJournaldCollector creates a collector that reads from the systemd journal.
// cursorFile is passed to journalctl --cursor-file so restarts resume from the
// last-seen position.
func NewJournaldCollector(cursorFile string) *JournaldCollector {
	return &JournaldCollector{cursorFile: cursorFile}
}

func (jc *JournaldCollector) Name() string { return "journald:system" }

// Start launches journalctl and streams its JSON output.
func (jc *JournaldCollector) Start(ctx context.Context) (<-chan Event, error) {
	if _, err := exec.LookPath("journalctl"); err != nil {
		return nil, fmt.Errorf("journalctl not found in PATH: %w", err)
	}

	out := make(chan Event, 512)
	go jc.tail(ctx, out)
	return out, nil
}

func (jc *JournaldCollector) tail(ctx context.Context, out chan<- Event) {
	defer close(out)

	// -n 1000: backfill last 1000 entries on startup; -f: follow new entries.
	args := []string{"-f", "-o", "json", "-n", "1000"}
	if jc.cursorFile != "" {
		if _, err := os.Stat(jc.cursorFile); err == nil {
			// Resume from cursor if file exists.
			args = append(args, "--cursor-file", jc.cursorFile)
		}
	}

	cmd := exec.CommandContext(ctx, "journalctl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		jc.logErr("JOURNALD_PIPE_ERROR", err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		jc.logErr("JOURNALD_START_ERROR", err.Error())
		return
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 1<<20), 1<<20) // 1 MiB per line max

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
			cmd.Wait()
			return
		default:
		}

		var raw map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			continue
		}

		ev := jc.parseEntry(raw)
		select {
		case out <- ev:
		case <-ctx.Done():
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
			cmd.Wait()
			return
		}
	}

	cmd.Wait()
}

func (jc *JournaldCollector) parseEntry(raw map[string]interface{}) Event {
	ts := time.Now().UTC()
	if usec, ok := raw["__REALTIME_TIMESTAMP"].(string); ok {
		var usecInt int64
		if _, err := fmt.Sscanf(usec, "%d", &usecInt); err == nil {
			ts = time.Unix(usecInt/1_000_000, (usecInt%1_000_000)*1000).UTC()
		}
	}

	payload := map[string]interface{}{}
	// Include common journald fields; skip internal __ fields except timestamp.
	for _, key := range []string{"MESSAGE", "PRIORITY", "SYSLOG_IDENTIFIER",
		"_HOSTNAME", "_SYSTEMD_UNIT", "_COMM", "_PID", "_UID", "_GID",
		"_EXE", "_CMDLINE", "SYSLOG_FACILITY"} {
		if v, ok := raw[key]; ok {
			payload[key] = v
		}
	}

	return Event{
		Source:    "journald:system",
		Event:     payload,
		Timestamp: ts,
	}
}

// SaveBookmark is a no-op because journalctl manages its own cursor file.
func (jc *JournaldCollector) SaveBookmark(_ string) error { return nil }

func (jc *JournaldCollector) logErr(code, msg string) {
	fmt.Fprintf(os.Stderr, "{\"error_code\":%q,\"message\":%q}\n", code, msg)
}
