//go:build !windows && !linux

package agent

import "context"

// NetconnCollector is a stub on unsupported platforms.
type NetconnCollector struct{}

func NewNetconnCollector() *NetconnCollector { return &NetconnCollector{} }

func (c *NetconnCollector) Name() string              { return "netconn:stub" }
func (c *NetconnCollector) SaveBookmark(_ string) error { return nil }

func (c *NetconnCollector) Start(_ context.Context) (<-chan Event, error) {
	return nil, &PlatformError{}
}
