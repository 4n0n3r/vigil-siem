//go:build !linux

package agent

import "context"

// JournaldCollector is a stub on non-Linux platforms.
type JournaldCollector struct{}

func NewJournaldCollector(_ string) *JournaldCollector { return &JournaldCollector{} }

func (jc *JournaldCollector) Name() string { return "journald:system" }

func (jc *JournaldCollector) Start(_ context.Context) (<-chan Event, error) {
	return nil, &PlatformError{}
}

func (jc *JournaldCollector) SaveBookmark(_ string) error { return nil }
