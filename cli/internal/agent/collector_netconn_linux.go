//go:build linux

package agent

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const netconnPollInterval = 30 * time.Second

// NetconnCollector polls active TCP/UDP connections every 30s via ss -Htnup,
// diffs against the previous snapshot, and emits netconn:new / netconn:closed events.
// The first snapshot is consumed silently as a baseline so startup does not flood the API.
type NetconnCollector struct{}

func NewNetconnCollector() *NetconnCollector { return &NetconnCollector{} }

func (c *NetconnCollector) Name() string              { return "netconn:poll" }
func (c *NetconnCollector) SaveBookmark(_ string) error { return nil }

func (c *NetconnCollector) Start(ctx context.Context) (<-chan Event, error) {
	out := make(chan Event, 256)
	go c.poll(ctx, out)
	return out, nil
}

type netconn struct {
	proto      string
	localAddr  string
	localPort  int
	remoteAddr string
	remotePort int
	state      string
	pid        int
}

var ssPidRe = regexp.MustCompile(`pid=(\d+)`)

func (c *NetconnCollector) poll(ctx context.Context, out chan<- Event) {
	defer close(out)

	prev, _ := snapshotSS()
	if prev == nil {
		prev = map[string]netconn{}
	}

	select {
	case <-ctx.Done():
		return
	case <-time.After(netconnPollInterval):
	}

	for {
		curr, err := snapshotSS()
		if err == nil {
			ts := time.Now().UTC()
			for k, conn := range curr {
				if _, seen := prev[k]; !seen {
					select {
					case out <- connEvent(conn, "new", ts):
					case <-ctx.Done():
						return
					}
				}
			}
			for k, conn := range prev {
				if _, still := curr[k]; !still {
					select {
					case out <- connEvent(conn, "closed", ts):
					case <-ctx.Done():
						return
					}
				}
			}
			prev = curr
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(netconnPollInterval):
		}
	}
}

func snapshotSS() (map[string]netconn, error) {
	raw, err := exec.Command("ss", "-Htnup").Output()
	if err != nil {
		return nil, err
	}
	result := map[string]netconn{}
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	for scanner.Scan() {
		conn, ok := parseSSLine(scanner.Text())
		if !ok {
			continue
		}
		key := fmt.Sprintf("%s|%s:%d|%s:%d|%d",
			conn.proto, conn.localAddr, conn.localPort,
			conn.remoteAddr, conn.remotePort, conn.pid)
		result[key] = conn
	}
	return result, nil
}

// parseSSLine parses one line of "ss -Htnup" output (no header, TCP+UDP, numeric, with process).
// Format: Netid State Recv-Q Send-Q LocalAddr:Port PeerAddr:Port [Process]
func parseSSLine(line string) (netconn, bool) {
	fields := strings.Fields(line)
	if len(fields) < 6 {
		return netconn{}, false
	}
	proto := strings.ToLower(fields[0])
	if proto != "tcp" && proto != "udp" {
		return netconn{}, false
	}
	state := fields[1]
	localAddr, localPort := splitAddrPort(fields[4])
	remoteAddr, remotePort := splitAddrPort(fields[5])

	pid := 0
	if len(fields) > 6 {
		if m := ssPidRe.FindStringSubmatch(strings.Join(fields[6:], " ")); m != nil {
			pid, _ = strconv.Atoi(m[1])
		}
	}

	return netconn{
		proto:      proto,
		localAddr:  localAddr,
		localPort:  localPort,
		remoteAddr: remoteAddr,
		remotePort: remotePort,
		state:      state,
		pid:        pid,
	}, true
}

// splitAddrPort splits "1.2.3.4:80", "[::1]:80", or "*" into addr and port.
func splitAddrPort(s string) (string, int) {
	if s == "*:*" || s == "*" {
		return "*", 0
	}
	idx := strings.LastIndex(s, ":")
	if idx < 0 {
		return s, 0
	}
	addr := strings.Trim(s[:idx], "[]")
	port, _ := strconv.Atoi(s[idx+1:])
	return addr, port
}

func connEvent(c netconn, action string, ts time.Time) Event {
	return Event{
		Source: "netconn:poll",
		Event: map[string]interface{}{
			"action":      action,
			"protocol":    c.proto,
			"local_addr":  c.localAddr,
			"local_port":  c.localPort,
			"remote_addr": c.remoteAddr,
			"remote_port": c.remotePort,
			"state":       c.state,
			"pid":         c.pid,
		},
		Timestamp: ts,
	}
}
