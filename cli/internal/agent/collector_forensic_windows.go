//go:build windows

package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc/mgr"
)

// ForensicCollector performs a one-shot sweep of forensic artifacts on Windows.
// It emits all collected artifacts onto the channel, then closes it.
// Artifacts: Prefetch metadata, Registry Run keys, Services, Scheduled Tasks, Shimcache.
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
	fc.collectPrefetch(ctx, out)
	fc.collectRunKeys(ctx, out)
	fc.collectServices(ctx, out)
	fc.collectScheduledTasks(ctx, out)
	fc.collectShimcache(ctx, out)
	fc.collectNetworkConnections(ctx, out)
}

// ----------------------------------------------------------------------------
// Prefetch — file metadata only (no file contents)
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectPrefetch(ctx context.Context, out chan<- Event) {
	entries, err := os.ReadDir(`C:\Windows\Prefetch`)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if ctx.Err() != nil {
			return
		}
		name := entry.Name()
		if len(name) < 3 || name[len(name)-3:] != ".pf" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fc.emit(ctx, out, "forensic:prefetch", map[string]interface{}{
			"artifact":    "prefetch",
			"file_name":   name,
			"size_bytes":  info.Size(),
			"modified_at": info.ModTime().UTC().Format(time.RFC3339),
		})
	}
}

// ----------------------------------------------------------------------------
// Registry Run keys
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectRunKeys(ctx context.Context, out chan<- Event) {
	targets := []struct {
		hive  registry.Key
		scope string
		path  string
	}{
		{registry.LOCAL_MACHINE, "HKLM", `SOFTWARE\Microsoft\Windows\CurrentVersion\Run`},
		{registry.LOCAL_MACHINE, "HKLM", `SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce`},
		{registry.CURRENT_USER, "HKCU", `SOFTWARE\Microsoft\Windows\CurrentVersion\Run`},
		{registry.CURRENT_USER, "HKCU", `SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce`},
	}

	for _, t := range targets {
		if ctx.Err() != nil {
			return
		}
		k, err := registry.OpenKey(t.hive, t.path, registry.READ)
		if err != nil {
			continue
		}

		names, _ := k.ReadValueNames(0)
		for _, name := range names {
			if ctx.Err() != nil {
				k.Close()
				return
			}
			val, _, err := k.GetStringValue(name)
			if err != nil {
				continue
			}
			fc.emit(ctx, out, "forensic:registry", map[string]interface{}{
				"artifact":   "run_key",
				"hive":       t.scope,
				"path":       t.path,
				"value_name": name,
				"value_data": val,
			})
		}
		k.Close()
	}
}

// ----------------------------------------------------------------------------
// Services via SCM
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectServices(ctx context.Context, out chan<- Event) {
	m, err := mgr.Connect()
	if err != nil {
		return
	}
	defer m.Disconnect()

	names, err := m.ListServices()
	if err != nil {
		return
	}

	for _, name := range names {
		if ctx.Err() != nil {
			return
		}
		payload := map[string]interface{}{
			"artifact":     "service",
			"service_name": name,
		}

		s, err := m.OpenService(name)
		if err == nil {
			if conf, err := s.Config(); err == nil {
				payload["display_name"] = conf.DisplayName
				payload["binary_path"] = conf.BinaryPathName
				payload["start_type"] = uint32(conf.StartType)
				payload["service_type"] = uint32(conf.ServiceType)
				payload["description"] = conf.Description
			}
			s.Close()
		}

		fc.emit(ctx, out, "forensic:services", payload)
	}
}

// ----------------------------------------------------------------------------
// Scheduled Tasks via registry TaskCache
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectScheduledTasks(ctx context.Context, out chan<- Event) {
	const taskRoot = `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tasks`
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, taskRoot, registry.READ)
	if err != nil {
		return
	}
	defer k.Close()

	taskIDs, err := k.ReadSubKeyNames(0)
	if err != nil {
		return
	}

	for _, id := range taskIDs {
		if ctx.Err() != nil {
			return
		}
		tk, err := registry.OpenKey(k, id, registry.READ)
		if err != nil {
			continue
		}
		path, _, _ := tk.GetStringValue("Path")
		actions, _, _ := tk.GetBinaryValue("Actions")
		tk.Close()

		fc.emit(ctx, out, "forensic:tasks", map[string]interface{}{
			"artifact":    "scheduled_task",
			"task_id":     id,
			"task_path":   path,
			"actions_hex": hex.EncodeToString(actions),
		})
	}
}

// ----------------------------------------------------------------------------
// Shimcache (AppCompatCache) — raw bytes only
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectShimcache(ctx context.Context, out chan<- Event) {
	const shimKey = `SYSTEM\CurrentControlSet\Control\Session Manager\AppCompatCache`
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, shimKey, registry.READ)
	if err != nil {
		return
	}
	defer k.Close()

	data, _, err := k.GetBinaryValue("AppCompatCache")
	if err != nil {
		return
	}

	fc.emit(ctx, out, "forensic:shimcache", map[string]interface{}{
		"artifact":   "shimcache",
		"size_bytes": len(data),
		"data_hex":   hex.EncodeToString(data),
	})
}

// ----------------------------------------------------------------------------
// Network connections — point-in-time snapshot via netstat -ano
// ----------------------------------------------------------------------------

func (fc *ForensicCollector) collectNetworkConnections(ctx context.Context, out chan<- Event) {
	tctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	raw, err := exec.CommandContext(tctx, "netstat", "-ano").Output()
	if err != nil {
		return
	}

	scanner := bufio.NewScanner(bytes.NewReader(raw))
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		fields := strings.Fields(scanner.Text())
		if len(fields) < 4 {
			continue
		}
		proto := strings.ToLower(fields[0])
		if proto != "tcp" && proto != "udp" {
			continue
		}

		localAddr, localPort := splitAddrPort(fields[1])
		remoteAddr, remotePort := splitAddrPort(fields[2])

		var state, pid string
		if proto == "tcp" {
			if len(fields) < 5 {
				continue
			}
			state = fields[3]
			pid = fields[4]
		} else {
			pid = fields[3]
		}

		fc.emit(ctx, out, "forensic:network", map[string]interface{}{
			"artifact":    "network_connection",
			"protocol":    proto,
			"local_addr":  localAddr,
			"local_port":  localPort,
			"remote_addr": remoteAddr,
			"remote_port": remotePort,
			"state":       state,
			"pid":         pid,
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
