// Package agent implements the platform-agnostic Vigil event collection agent.
// It owns the batch buffer, flush ticker, stats tracking, and status file writer.
// Platform-specific collectors are wired in via the Collector interface defined here.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/vigil/vigil/internal/client"
)

// ----------------------------------------------------------------------------
// Collector interface — implemented per platform
// ----------------------------------------------------------------------------

// Event is the normalised event payload produced by any collector.
type Event struct {
	Source    string                 `json:"source"`
	Event     map[string]interface{} `json:"event"`
	Timestamp time.Time              `json:"timestamp"`
}

// Collector is the interface that every platform collector must satisfy.
type Collector interface {
	// Name returns a human-readable label (e.g. "Security", "Sysmon/Operational").
	Name() string
	// Start begins collection. Events should be sent on the returned channel.
	// The collector must stop and close the channel when ctx is cancelled.
	Start(ctx context.Context) (<-chan Event, error)
	// SaveBookmark persists a bookmark so the next start can resume from here.
	SaveBookmark(path string) error
}

// ----------------------------------------------------------------------------
// AgentStats — updated atomically so reads from vigil agent status are safe
// ----------------------------------------------------------------------------

// AgentStats holds counters and timestamps that describe agent health.
type AgentStats struct {
	StartedAt       time.Time `json:"started_at"`
	EventsCollected int64     `json:"events_collected"`
	EventsFlushed   int64     `json:"events_flushed"`
	FlushErrors     int64     `json:"flush_errors"`
	LastFlushAt     time.Time `json:"last_flush_at"`
	LastError       string    `json:"last_error"`
	Channels        []string  `json:"channels"`
}

// statusFilePayload is what gets written to the JSON state file.
type statusFilePayload struct {
	StartedAt       time.Time `json:"started_at"`
	EventsCollected int64     `json:"events_collected"`
	EventsFlushed   int64     `json:"events_flushed"`
	FlushErrors     int64     `json:"flush_errors"`
	LastFlushAt     time.Time `json:"last_flush_at"`
	LastError       string    `json:"last_error"`
	Channels        []string  `json:"channels"`
}

// batchIngestRequest mirrors the API POST /v1/events/batch body.
type batchIngestRequest struct {
	Events []Event `json:"events"`
}

// batchIngestResponse mirrors the API POST /v1/events/batch success response.
type batchIngestResponse struct {
	Ingested int      `json:"ingested"`
	IDs      []string `json:"ids"`
	Errors   []string `json:"errors"`
}

// ----------------------------------------------------------------------------
// Agent
// ----------------------------------------------------------------------------

// Config holds all tunable knobs for the agent.
type Config struct {
	Channels      []string
	BatchSize     int
	FlushInterval time.Duration
	BookmarkFile  string
	StatusFile    string
}

// DefaultConfig returns a Config pre-populated with sensible defaults.
func DefaultConfig() Config {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = filepath.Join(os.Getenv("HOME"), ".vigil")
	}
	vigilDir := filepath.Join(appData, "Vigil")
	return Config{
		Channels: []string{
			"Security",
			"Microsoft-Windows-Sysmon/Operational",
			"Microsoft-Windows-PowerShell/Operational",
		},
		BatchSize:     100,
		FlushInterval: 5 * time.Second,
		BookmarkFile:  filepath.Join(vigilDir, "agent_bookmark.xml"),
		StatusFile:    filepath.Join(vigilDir, "agent_status.json"),
	}
}

// Agent is the top-level coordinator.
type Agent struct {
	apiClient  *client.Client
	collectors []Collector
	cfg        Config

	mu     sync.Mutex
	buffer []Event

	// atomic counters — written from multiple goroutines
	eventsCollected int64
	eventsFlushed   int64
	flushErrors     int64

	// protected by mu
	lastFlushAt time.Time
	lastError   string

	startedAt time.Time
}

// New creates an Agent. Collectors must be added via AddCollector before Run is called.
func New(apiClient *client.Client, cfg Config) *Agent {
	return &Agent{
		apiClient: apiClient,
		cfg:       cfg,
	}
}

// AddCollector registers a collector with the agent.
func (a *Agent) AddCollector(c Collector) {
	a.collectors = append(a.collectors, c)
}

// Stats returns a snapshot of the current agent statistics.
func (a *Agent) Stats() AgentStats {
	a.mu.Lock()
	lf := a.lastFlushAt
	le := a.lastError
	a.mu.Unlock()

	channels := make([]string, len(a.collectors))
	for i, c := range a.collectors {
		channels[i] = c.Name()
	}

	return AgentStats{
		StartedAt:       a.startedAt,
		EventsCollected: atomic.LoadInt64(&a.eventsCollected),
		EventsFlushed:   atomic.LoadInt64(&a.eventsFlushed),
		FlushErrors:     atomic.LoadInt64(&a.flushErrors),
		LastFlushAt:     lf,
		LastError:       le,
		Channels:        channels,
	}
}

// Run starts all collectors, the flush ticker, and the status file writer.
// It blocks until ctx is cancelled.
func (a *Agent) Run(ctx context.Context) error {
	a.startedAt = time.Now().UTC()

	// Ensure the Vigil data directory exists.
	if err := os.MkdirAll(filepath.Dir(a.cfg.StatusFile), 0o755); err != nil {
		a.logError("DIR_CREATE_ERROR", fmt.Sprintf("could not create vigil data dir: %v", err))
		// non-fatal — continue without status file
	}

	// Merge all collector channels into one.
	merged := make(chan Event, 512)
	var wg sync.WaitGroup

	for _, col := range a.collectors {
		col := col
		ch, err := col.Start(ctx)
		if err != nil {
			a.logError("COLLECTOR_START_ERROR",
				fmt.Sprintf("collector %q failed to start: %v", col.Name(), err))
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ev := range ch {
				merged <- ev
			}
		}()
	}

	// Close merged when all collectors have stopped.
	go func() {
		wg.Wait()
		close(merged)
	}()

	flushTicker := time.NewTicker(a.cfg.FlushInterval)
	defer flushTicker.Stop()

	statusTicker := time.NewTicker(10 * time.Second)
	defer statusTicker.Stop()

	// Write an initial status file immediately.
	a.writeStatusFile()

	for {
		select {
		case ev, ok := <-merged:
			if !ok {
				// All collectors have stopped — flush what remains and exit.
				a.flush()
				return nil
			}
			a.mu.Lock()
			a.buffer = append(a.buffer, ev)
			bufLen := len(a.buffer)
			a.mu.Unlock()
			atomic.AddInt64(&a.eventsCollected, 1)

			if bufLen >= a.cfg.BatchSize {
				a.flush()
			}

		case <-flushTicker.C:
			a.flush()

		case <-statusTicker.C:
			a.writeStatusFile()

		case <-ctx.Done():
			// Drain remaining events and flush.
			a.flush()
			a.writeStatusFile()
			// Save bookmarks.
			for _, col := range a.collectors {
				if err := col.SaveBookmark(a.cfg.BookmarkFile); err != nil {
					a.logError("BOOKMARK_SAVE_ERROR",
						fmt.Sprintf("collector %q bookmark save failed: %v", col.Name(), err))
				}
			}
			return nil
		}
	}
}

// flush drains the buffer and POSTs events to the API.
func (a *Agent) flush() {
	a.mu.Lock()
	if len(a.buffer) == 0 {
		a.mu.Unlock()
		return
	}
	batch := make([]Event, len(a.buffer))
	copy(batch, a.buffer)
	a.buffer = a.buffer[:0]
	a.mu.Unlock()

	req := batchIngestRequest{Events: batch}
	var resp batchIngestResponse
	if err := a.apiClient.Post("/v1/events/batch", req, &resp); err != nil {
		atomic.AddInt64(&a.flushErrors, 1)
		a.logError("FLUSH_ERROR", err.Error())
		return
	}

	atomic.AddInt64(&a.eventsFlushed, int64(resp.Ingested))
	a.mu.Lock()
	a.lastFlushAt = time.Now().UTC()
	a.mu.Unlock()

	// Save bookmarks after every successful flush so a crash loses at most
	// one flush interval worth of position (default 5s).
	for _, col := range a.collectors {
		if err := col.SaveBookmark(a.cfg.BookmarkFile); err != nil {
			a.logError("BOOKMARK_SAVE_ERROR",
				fmt.Sprintf("collector %q bookmark save failed: %v", col.Name(), err))
		}
	}
}

// logError writes a structured JSON error line to stderr and records the last error.
func (a *Agent) logError(code, message string) {
	type errLine struct {
		ErrorCode string `json:"error_code"`
		Message   string `json:"message"`
	}
	line, _ := json.Marshal(errLine{ErrorCode: code, Message: message})
	fmt.Fprintln(os.Stderr, string(line))

	a.mu.Lock()
	a.lastError = message
	a.mu.Unlock()
}

// writeStatusFile atomically writes the current stats to the JSON status file.
func (a *Agent) writeStatusFile() {
	stats := a.Stats()
	payload := statusFilePayload{
		StartedAt:       stats.StartedAt,
		EventsCollected: stats.EventsCollected,
		EventsFlushed:   stats.EventsFlushed,
		FlushErrors:     stats.FlushErrors,
		LastFlushAt:     stats.LastFlushAt,
		LastError:       stats.LastError,
		Channels:        stats.Channels,
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return
	}

	tmpPath := a.cfg.StatusFile + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return
	}
	// Atomic rename so readers never see a partial file.
	_ = os.Rename(tmpPath, a.cfg.StatusFile)
}

// ReadStatusFile reads the JSON status file written by a running agent.
// Returns an error if the file does not exist or cannot be parsed.
func ReadStatusFile(path string) (*statusFilePayload, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p statusFilePayload
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("corrupt status file: %w", err)
	}
	return &p, nil
}

// PlatformError is returned when a feature is not supported on the current platform.
type PlatformError struct{}

func (e *PlatformError) Error() string {
	return `{"error_code":"UNSUPPORTED_PLATFORM","message":"this feature is not supported on the current platform"}`
}
