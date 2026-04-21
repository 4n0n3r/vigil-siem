//go:build !linux && !windows

package agent

import "runtime"

// SysInfo holds discoverable endpoint metadata.
type SysInfo struct {
	OSVersion   string `json:"os_version,omitempty"`
	Kernel      string `json:"kernel,omitempty"`
	CPUCount    int    `json:"cpu_count,omitempty"`
	CPUModel    string `json:"cpu_model,omitempty"`
	TotalRAMMB  int64  `json:"total_ram_mb,omitempty"`
	DiskTotalGB int64  `json:"disk_total_gb,omitempty"`
	DiskFreeGB  int64  `json:"disk_free_gb,omitempty"`
}

// CollectSysInfo returns a minimal stub on unsupported platforms.
func CollectSysInfo() SysInfo {
	return SysInfo{CPUCount: runtime.NumCPU()}
}
