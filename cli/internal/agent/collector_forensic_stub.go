//go:build !windows && !linux

package agent

import "context"

// ForensicCollector is a stub on non-Windows, non-Linux platforms.
type ForensicCollector struct{}

func NewForensicCollector() *ForensicCollector { return &ForensicCollector{} }

func (fc *ForensicCollector) Name() string { return "forensic:sweep" }

func (fc *ForensicCollector) Start(_ context.Context) (<-chan Event, error) {
	return nil, &PlatformError{}
}

func (fc *ForensicCollector) SaveBookmark(_ string) error { return nil }
