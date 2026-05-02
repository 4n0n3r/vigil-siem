//go:build windows

package agent

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const netconnPollInterval = 30 * time.Second

// NetconnCollector polls active TCP/UDP connections every 30s via netstat -ano,
// diffs against the previous snapshot, and emits netconn:new / netconn:closed events.
// The first snapshot is consumed silently as a baseline so startup does not flood the API.
type NetconnCollector struct{}

func NewNetconnCollector() *NetconnCollector { return &NetconnCollector{} }

func (c *NetconnCollector) Name() string         { return "netconn:poll" }
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

func (c *NetconnCollector) poll(ctx context.Context, out chan<- Event) {
	defer close(out)

	prev, _ := snapshotNetstat()
	if prev == nil {
		prev = map[string]netconn{}
	}

	select {
	case <-ctx.Done():
		return
	case <-time.After(netconnPollInterval):
	}

	for {
		curr, err := snapshotNetstat()
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

func snapshotNetstat() (map[string]netconn, error) {
	raw, err := exec.Command("netstat", "-ano").Output()
	if err != nil {
		return nil, err
	}
	result := map[string]netconn{}
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	for scanner.Scan() {
		conn, ok := parseNetstatLine(strings.TrimSpace(scanner.Text()))
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

// parseNetstatLine parses one line of "netstat -ano" output.
// TCP: Proto LocalAddr ForeignAddr State PID  (5+ fields)
// UDP: Proto LocalAddr ForeignAddr PID        (4 fields)
func parseNetstatLine(line string) (netconn, bool) {
	fields := strings.Fields(line)
	if len(fields) < 4 {
		return netconn{}, false
	}
	proto := strings.ToLower(fields[0])
	if proto != "tcp" && proto != "udp" {
		return netconn{}, false
	}

	localAddr, localPort := splitAddrPort(fields[1])
	remoteAddr, remotePort := splitAddrPort(fields[2])

	var state, pidStr string
	if proto == "tcp" {
		if len(fields) < 5 {
			return netconn{}, false
		}
		state = fields[3]
		pidStr = fields[4]
	} else {
		pidStr = fields[3]
	}
	pid, _ := strconv.Atoi(pidStr)

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

// splitAddrPort splits "1.2.3.4:80", "[::1]:80", or "*:*" into addr and port.
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
			"channel":     "netconn",
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
