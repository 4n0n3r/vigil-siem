//go:build !linux

package agent

import "context"

// SyslogCollector is a stub on non-Linux platforms.
type SyslogCollector struct{}

func NewSyslogCollector(_, _, _ string) *SyslogCollector { return &SyslogCollector{} }

func (sc *SyslogCollector) Name() string { return "syslog:stub" }

func (sc *SyslogCollector) Start(_ context.Context) (<-chan Event, error) {
	return nil, &PlatformError{}
}

func (sc *SyslogCollector) SaveBookmark(_ string) error { return nil }
