//go:build windows

package cmd

import "golang.org/x/sys/windows/svc/mgr"

// isWindowsService returns true when the VIGILAgent service exists, meaning
// the user likely needs to restart it after an update.
func isWindowsService() bool {
	m, err := mgr.Connect()
	if err != nil {
		return false
	}
	defer m.Disconnect()
	s, err := m.OpenService("VIGILAgent")
	if err != nil {
		return false
	}
	s.Close()
	return true
}
