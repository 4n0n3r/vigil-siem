//go:build windows

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

const winfwPollInterval = 2 * time.Second

// WinfwCollector tails the Windows Firewall log file and emits one event per
// allow/drop decision. Source prefix: netfw:.
//
// Logging must be enabled in Windows Firewall Advanced Security settings.
// Default log path: %SystemRoot%\System32\LogFiles\Firewall\pfirewall.log
type WinfwCollector struct {
	logPath    string
	offsetFile string
	offset     int64
}

func NewWinfwCollector(bookmarkDir string) *WinfwCollector {
	sysRoot := os.Getenv("SystemRoot")
	if sysRoot == "" {
		sysRoot = `C:\Windows`
	}
	logPath := filepath.Join(sysRoot, `System32\LogFiles\Firewall\pfirewall.log`)
	offsetFile := filepath.Join(bookmarkDir, "winfw.offset")
	return &WinfwCollector{logPath: logPath, offsetFile: offsetFile}
}

func (c *WinfwCollector) Name() string              { return "netfw:winfw" }
func (c *WinfwCollector) SaveBookmark(_ string) error { return c.saveOffset() }

func (c *WinfwCollector) Start(ctx context.Context) (<-chan Event, error) {
	c.offset = c.loadOffset()
	out := make(chan Event, 256)
	go c.tail(ctx, out)
	return out, nil
}

func (c *WinfwCollector) tail(ctx context.Context, out chan<- Event) {
	defer close(out)
	for {
		c.readNew(ctx, out)
		select {
		case <-ctx.Done():
			return
		case <-time.After(winfwPollInterval):
		}
	}
}

func (c *WinfwCollector) readNew(ctx context.Context, out chan<- Event) {
	f, err := os.Open(c.logPath)
	if err != nil {
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return
	}
	if info.Size() < c.offset {
		c.offset = 0
	}
	if _, err := f.Seek(c.offset, 0); err != nil {
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
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		ev, ok := parseWinfwLine(line)
		if !ok {
			continue
		}
		select {
		case out <- ev:
		case <-ctx.Done():
			return
		}
	}

	if pos, err := f.Seek(0, 1); err == nil {
		c.offset = pos
	}
}

// parseWinfwLine parses one data line of pfirewall.log.
// Fields: date time action protocol src-ip dst-ip src-port dst-port size
//         tcpflags tcpsyn tcpack tcpwin icmptype icmpcode info path
func parseWinfwLine(line string) (Event, bool) {
	fields := strings.Fields(line)
	if len(fields) < 8 {
		return Event{}, false
	}

	dateStr := fields[0]
	timeStr := fields[1]
	action := strings.ToLower(fields[2])
	if action != "allow" && action != "drop" {
		return Event{}, false
	}

	ts, err := time.Parse("2006-01-02 15:04:05", fmt.Sprintf("%s %s", dateStr, timeStr))
	if err != nil {
		ts = time.Now().UTC()
	} else {
		ts = ts.UTC()
	}

	protocol := strings.ToLower(fields[3])
	srcIP := dashToBlank(fields[4])
	dstIP := dashToBlank(fields[5])
	srcPort, _ := strconv.Atoi(dashToBlank(fields[6]))
	dstPort, _ := strconv.Atoi(dashToBlank(fields[7]))

	direction := ""
	if len(fields) >= 17 {
		direction = strings.ToLower(fields[16])
	}

	return Event{
		Source: "netfw:winfw",
		Event: map[string]interface{}{
			"action":    action,
			"protocol":  protocol,
			"src_ip":    srcIP,
			"dst_ip":    dstIP,
			"src_port":  srcPort,
			"dst_port":  dstPort,
			"direction": direction,
		},
		Timestamp: ts,
	}, true
}

func dashToBlank(s string) string {
	if s == "-" {
		return ""
	}
	return s
}

func (c *WinfwCollector) loadOffset() int64 {
	data, err := os.ReadFile(c.offsetFile)
	if err != nil {
		return 0
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	return n
}

func (c *WinfwCollector) saveOffset() error {
	if err := os.MkdirAll(filepath.Dir(c.offsetFile), 0o755); err != nil {
		return err
	}
	return os.WriteFile(c.offsetFile, []byte(strconv.FormatInt(c.offset, 10)), 0o644)
}
