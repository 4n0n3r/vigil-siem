//go:build !windows

package cmd

func isWindowsService() bool { return false }
