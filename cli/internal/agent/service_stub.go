//go:build !windows && !linux

package agent

// ----------------------------------------------------------------------------
// Stubs for non-Windows platforms
// ----------------------------------------------------------------------------

// InstallService always returns a platform error on non-Windows.
func InstallService() error { return &PlatformError{} }

// RestartService always returns a platform error on non-Windows.
func RestartService() error { return &PlatformError{} }

// UninstallService always returns a platform error on non-Windows.
func UninstallService() error { return &PlatformError{} }

// RunningAsService always returns false on non-Windows.
func RunningAsService() bool { return false }

// RunAsService always returns a platform error on non-Windows.
func RunAsService(_ *Agent) error { return &PlatformError{} }
