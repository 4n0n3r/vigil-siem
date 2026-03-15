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

// SyslogCollector tails a syslog file by byte offset.
// It polls for new bytes every 2 seconds and emits parsed log lines as events.
type SyslogCollector struct {
	path       string
	source     string
	offsetFile string
	offset     int64
}

// NewSyslogCollector creates a collector that tails logPath.
// source should be the source prefix (e.g. "syslog:auth").
// offsetFile stores the resume byte offset between runs.
func NewSyslogCollector(logPath, source, offsetFile string) *SyslogCollector {
	return &SyslogCollector{
		path:       logPath,
		source:     source,
		offsetFile: offsetFile,
	}
}

func (sc *SyslogCollector) Name() string { return sc.source }

func (sc *SyslogCollector) Start(ctx context.Context) (<-chan Event, error) {
	if _, err := os.Stat(sc.path); err != nil {
		return nil, fmt.Errorf("syslog file not accessible: %s: %w", sc.path, err)
	}
	sc.offset = sc.loadOffset()

	out := make(chan Event, 512)
	go sc.tail(ctx, out)
	return out, nil
}

func (sc *SyslogCollector) tail(ctx context.Context, out chan<- Event) {
	defer close(out)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		sc.readNew(ctx, out)

		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (sc *SyslogCollector) readNew(ctx context.Context, out chan<- Event) {
	f, err := os.Open(sc.path)
	if err != nil {
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return
	}

	// Handle log rotation: if file shrank, reset offset.
	if info.Size() < sc.offset {
		sc.offset = 0
	}

	// First run: backfill the last ~200 KB to avoid swamping the API.
	if sc.offset == 0 && info.Size() > 0 {
		const backfillBytes = 200 * 1024
		if info.Size() > backfillBytes {
			sc.offset = sc.findLineStart(f, info.Size()-backfillBytes)
		}
	}

	if _, err := f.Seek(sc.offset, 0); err != nil {
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

		ev := parseSyslogLine(line, sc.source)
		select {
		case out <- ev:
		case <-ctx.Done():
			return
		}
	}

	// Update offset to end of file.
	if pos, err := f.Seek(0, 1); err == nil {
		sc.offset = pos
	}
}

// findLineStart seeks backward from pos to find the start of the next complete line.
func (sc *SyslogCollector) findLineStart(f *os.File, pos int64) int64 {
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

func parseSyslogLine(line, source string) Event {
	ts := time.Now().UTC()
	fields := map[string]interface{}{"raw": line}

	// RFC3164 syslog: "Jan 15 10:30:00 hostname proc[pid]: message"
	parts := strings.SplitN(line, " ", 6)
	if len(parts) >= 4 {
		tsPart := parts[0] + " " + parts[1] + " " + parts[2]
		if t, err := time.Parse("Jan  2 15:04:05", tsPart); err == nil {
			ts = t.AddDate(time.Now().Year(), 0, 0).UTC()
		} else if t, err := time.Parse("Jan 02 15:04:05", tsPart); err == nil {
			ts = t.AddDate(time.Now().Year(), 0, 0).UTC()
		}
		fields["hostname"] = parts[3]

		if len(parts) >= 5 {
			proc := parts[4]
			if i := strings.Index(proc, "["); i > 0 {
				fields["process"] = proc[:i]
				if j := strings.Index(proc, "]"); j > i {
					fields["pid"] = proc[i+1 : j]
				}
			} else {
				fields["process"] = strings.TrimSuffix(proc, ":")
			}
		}
		if len(parts) == 6 {
			fields["message"] = parts[5]
		}
	}

	return Event{Source: source, Event: fields, Timestamp: ts}
}

func (sc *SyslogCollector) SaveBookmark(_ string) error {
	return sc.saveOffset()
}

func (sc *SyslogCollector) loadOffset() int64 {
	data, err := os.ReadFile(sc.offsetFile)
	if err != nil {
		return 0
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	return n
}

func (sc *SyslogCollector) saveOffset() error {
	if err := os.MkdirAll(filepath.Dir(sc.offsetFile), 0o755); err != nil {
		return err
	}
	return os.WriteFile(sc.offsetFile, []byte(strconv.FormatInt(sc.offset, 10)), 0o644)
}
