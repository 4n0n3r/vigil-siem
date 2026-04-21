//go:build linux

package agent

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

// SysInfo holds discoverable endpoint metadata collected cheaply via syscalls.
type SysInfo struct {
	OSVersion   string `json:"os_version,omitempty"`
	Kernel      string `json:"kernel,omitempty"`
	CPUCount    int    `json:"cpu_count,omitempty"`
	CPUModel    string `json:"cpu_model,omitempty"`
	TotalRAMMB  int64  `json:"total_ram_mb,omitempty"`
	DiskTotalGB int64  `json:"disk_total_gb,omitempty"`
	DiskFreeGB  int64  `json:"disk_free_gb,omitempty"`
}

// CollectSysInfo reads static system information. All reads are best-effort;
// missing fields are left zero/empty rather than returning an error.
func CollectSysInfo() SysInfo {
	var s SysInfo
	s.CPUCount = runtime.NumCPU()
	s.OSVersion = readOSVersion()
	s.Kernel = readKernel()
	s.CPUModel = readCPUModel()
	s.TotalRAMMB = readTotalRAMMB()
	s.DiskTotalGB, s.DiskFreeGB = readDiskGB("/")
	return s
}

func readOSVersion() string {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			v := strings.TrimPrefix(line, "PRETTY_NAME=")
			return strings.Trim(v, `"`)
		}
	}
	return ""
}

func readKernel() string {
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return ""
	}
	// Format: "Linux version 5.15.0-... (gcc ...) #1 SMP ..."
	parts := strings.Fields(string(data))
	if len(parts) >= 3 {
		return parts[2]
	}
	return strings.TrimSpace(string(data))
}

func readCPUModel() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "model name") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return ""
}

func readTotalRAMMB() int64 {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				kb, err := strconv.ParseInt(fields[1], 10, 64)
				if err == nil {
					return kb / 1024
				}
			}
			break
		}
	}
	return 0
}

func readDiskGB(path string) (total, free int64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0
	}
	blockSize := int64(stat.Bsize)
	total = (int64(stat.Blocks) * blockSize) / (1024 * 1024 * 1024)
	free = (int64(stat.Bavail) * blockSize) / (1024 * 1024 * 1024)
	return total, free
}
