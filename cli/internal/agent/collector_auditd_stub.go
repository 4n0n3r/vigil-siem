//go:build !linux

package agent

import "context"

// AuditdCollector is a stub on non-Linux platforms.
type AuditdCollector struct{}

func NewAuditdCollector(_ string) *AuditdCollector { return &AuditdCollector{} }

func (ac *AuditdCollector) Name() string { return "auditd:system" }

func (ac *AuditdCollector) Start(_ context.Context) (<-chan Event, error) {
	return nil, &PlatformError{}
}

func (ac *AuditdCollector) SaveBookmark(_ string) error { return nil }
