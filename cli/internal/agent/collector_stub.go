//go:build !windows

package agent

import (
	"context"
)

// WindowsCollector is a stub on non-Windows platforms.
type WindowsCollector struct {
	channel string
}

// NewWindowsCollector returns a stub collector that always fails to start.
func NewWindowsCollector(channel, bookmarkXML string) *WindowsCollector {
	return &WindowsCollector{channel: channel}
}

func (wc *WindowsCollector) Name() string { return wc.channel }

func (wc *WindowsCollector) Start(_ context.Context) (<-chan Event, error) {
	return nil, &PlatformError{}
}

func (wc *WindowsCollector) SaveBookmark(_ string) error { return nil }

// LoadBookmarkXML always returns empty on non-Windows.
func LoadBookmarkXML(_ string) string { return "" }

// NewWindowsCollectors returns stub collectors on non-Windows.
func NewWindowsCollectors(channels []string, _ string) []Collector {
	cols := make([]Collector, 0, len(channels))
	for _, ch := range channels {
		cols = append(cols, NewWindowsCollector(ch, ""))
	}
	return cols
}
