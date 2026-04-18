//go:build linux

package agent

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// AuditdCollector tails /var/log/audit/audit.log, parses key=value pairs,
// and emits structured events with source "auditd:system".
// Requires root or the auditd group for file access.
type AuditdCollector struct {
	path       string
	offsetFile string
	offset     int64
}

// NewAuditdCollector creates a collector that reads the auditd log.
// offsetFile stores the resume byte offset between runs.
func NewAuditdCollector(offsetFile string) *AuditdCollector {
	return &AuditdCollector{
		path:       "/var/log/audit/audit.log",
		offsetFile: offsetFile,
	}
}

func (ac *AuditdCollector) Name() string { return "auditd:system" }

func (ac *AuditdCollector) Start(ctx context.Context) (<-chan Event, error) {
	if _, err := os.Stat(ac.path); err != nil {
		return nil, fmt.Errorf("auditd log not accessible: %s: %w", ac.path, err)
	}
	ac.offset = ac.loadOffset()

	out := make(chan Event, 512)
	go ac.tail(ctx, out)
	return out, nil
}

func (ac *AuditdCollector) tail(ctx context.Context, out chan<- Event) {
	defer close(out)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		ac.readNew(ctx, out)

		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (ac *AuditdCollector) readNew(ctx context.Context, out chan<- Event) {
	f, err := os.Open(ac.path)
	if err != nil {
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return
	}

	// Handle log rotation: if file shrank, reset offset.
	if info.Size() < ac.offset {
		ac.offset = 0
	}

	// First run: backfill the last ~200 KB.
	if ac.offset == 0 && info.Size() > 0 {
		const backfill = 200 * 1024
		if info.Size() > backfill {
			ac.offset = ac.findLineStart(f, info.Size()-backfill)
		}
	}

	if _, err := f.Seek(ac.offset, 0); err != nil {
		return
	}

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		ev := parseAuditLine(line)
		select {
		case out <- ev:
		case <-ctx.Done():
			return
		}
	}

	// Update offset to end of file.
	if pos, err := f.Seek(0, 1); err == nil {
		ac.offset = pos
	}
}

func (ac *AuditdCollector) findLineStart(f *os.File, pos int64) int64 {
	buf := make([]byte, 512)
	if _, err := f.ReadAt(buf, pos); err != nil {
		return pos
	}
	idx := strings.Index(string(buf), "\n")
	if idx < 0 {
		return pos
	}
	return pos + int64(idx) + 1
}

// parseAuditLine parses an auditd key=value line.
// Auditd format: type=SYSCALL msg=audit(1234567890.123:456): key=value ...
func parseAuditLine(line string) Event {
	fields := make(map[string]interface{})
	ts := time.Now().UTC()

	// Parse type=VALUE at the start.
	if strings.HasPrefix(line, "type=") {
		rest := line[5:]
		if idx := strings.Index(rest, " "); idx >= 0 {
			fields["type"] = rest[:idx]
			line = rest[idx+1:]
		}
	}

	// Parse msg=audit(timestamp.ms:seq): to extract sequence number.
	if strings.HasPrefix(line, "msg=audit(") {
		end := strings.Index(line, ")")
		if end >= 0 {
			inner := line[10:end] // timestamp.ms:seq
			if colonIdx := strings.LastIndex(inner, ":"); colonIdx >= 0 {
				fields["msg_seq"] = inner[colonIdx+1:]
				if dotIdx := strings.Index(inner, "."); dotIdx >= 0 {
					sec := inner[:dotIdx]
					if secs, err := strconv.ParseInt(sec, 10, 64); err == nil {
						ts = time.Unix(secs, 0).UTC()
					}
				}
			}
			// Advance past the msg= token.
			if spaceIdx := strings.Index(line[end:], " "); spaceIdx >= 0 {
				line = line[end+spaceIdx+1:]
			} else {
				line = ""
			}
		}
	}

	// Parse remaining key=value pairs.
	for _, token := range strings.Fields(line) {
		if idx := strings.Index(token, "="); idx >= 0 {
			key := token[:idx]
			val := token[idx+1:]
			// Strip surrounding quotes.
			val = strings.Trim(val, `"`)
			fields[key] = val
		}
	}

	return Event{Source: "auditd:system", Event: fields, Timestamp: ts}
}

func (ac *AuditdCollector) SaveBookmark(_ string) error {
	return ac.saveOffset()
}

func (ac *AuditdCollector) loadOffset() int64 {
	data, err := os.ReadFile(ac.offsetFile)
	if err != nil {
		return 0
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	return n
}

func (ac *AuditdCollector) saveOffset() error {
	if err := os.MkdirAll(filepath.Dir(ac.offsetFile), 0o755); err != nil {
		return err
	}
	return os.WriteFile(ac.offsetFile, []byte(strconv.FormatInt(ac.offset, 10)), 0o644)
}
