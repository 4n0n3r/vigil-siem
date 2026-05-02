//go:build !windows

package agent

import "context"

// WinfwCollector is a stub on non-Windows platforms.
type WinfwCollector struct{}

func NewWinfwCollector(_ string) *WinfwCollector { return &WinfwCollector{} }

func (c *WinfwCollector) Name() string              { return "netfw:stub" }
func (c *WinfwCollector) SaveBookmark(_ string) error { return nil }

func (c *WinfwCollector) Start(_ context.Context) (<-chan Event, error) {
	return nil, &PlatformError{}
}
