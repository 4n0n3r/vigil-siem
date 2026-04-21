//go:build windows

package agent

import (
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"
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

// CollectSysInfo reads static system information. All reads are best-effort.
func CollectSysInfo() SysInfo {
	var s SysInfo
	s.CPUCount = runtime.NumCPU()
	s.OSVersion = readOSVersion()
	s.CPUModel = readCPUModel()
	s.TotalRAMMB = readTotalRAMMB()
	s.DiskTotalGB, s.DiskFreeGB = readDiskGB(`C:\`)
	return s
}

func readOSVersion() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	productName, _, err := k.GetStringValue("ProductName")
	if err != nil {
		return ""
	}
	build, _, _ := k.GetStringValue("CurrentBuildNumber")
	if build != "" {
		return productName + " (build " + build + ")"
	}
	return productName
}

func readCPUModel() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`HARDWARE\DESCRIPTION\System\CentralProcessor\0`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	name, _, err := k.GetStringValue("ProcessorNameString")
	if err != nil {
		return ""
	}
	return name
}

var (
	modKernel32            = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemoryStatus = modKernel32.NewProc("GlobalMemoryStatusEx")
	procGetDiskFreeSpaceEx = modKernel32.NewProc("GetDiskFreeSpaceExW")
)

type memoryStatusEx struct {
	dwLength                uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

func readTotalRAMMB() int64 {
	var ms memoryStatusEx
	ms.dwLength = uint32(unsafe.Sizeof(ms))
	procGlobalMemoryStatus.Call(uintptr(unsafe.Pointer(&ms))) //nolint:errcheck
	return int64(ms.ullTotalPhys) / (1024 * 1024)
}

func readDiskGB(path string) (total, free int64) {
	pathPtr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0
	}
	var freeBytesAvailable, totalBytes, totalFreeBytes uint64
	procGetDiskFreeSpaceEx.Call( //nolint:errcheck
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	total = int64(totalBytes) / (1024 * 1024 * 1024)
	free = int64(freeBytesAvailable) / (1024 * 1024 * 1024)
	return total, free
}
