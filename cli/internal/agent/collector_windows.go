//go:build windows

package agent

import (
	"context"
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// ----------------------------------------------------------------------------
// wevtapi.dll bindings via syscall.LazyDLL (no CGO)
// ----------------------------------------------------------------------------

var (
	wevtapi = syscall.NewLazyDLL("wevtapi.dll")

	procEvtQuery          = wevtapi.NewProc("EvtQuery")
	procEvtNext           = wevtapi.NewProc("EvtNext")
	procEvtRender         = wevtapi.NewProc("EvtRender")
	procEvtClose          = wevtapi.NewProc("EvtClose")
	procEvtSeek           = wevtapi.NewProc("EvtSeek")
	procEvtCreateBookmark = wevtapi.NewProc("EvtCreateBookmark")
	procEvtUpdateBookmark = wevtapi.NewProc("EvtUpdateBookmark")
)

const (
	evtQueryChannelPath      uintptr = 0x1
	evtQueryForwardDirection uintptr = 0x100

	evtSeekRelativeToBookmark uintptr = 0x3
	evtSeekStrict             uintptr = 0x10000

	evtRenderEventXml = uintptr(1)
	evtRenderBookmark = uintptr(2)

	// pollInterval is how often the collector checks for new events after draining.
	pollInterval = 2 * time.Second

	// backfillQuery reads events from the last 24 hours on first start.
	backfillQuery = "*[System[TimeCreated[timediff(@SystemTime) <= 86400000]]]"
)

// ----------------------------------------------------------------------------
// XML structures for parsing Windows Event Log XML
// ----------------------------------------------------------------------------

type evtXML struct {
	XMLName   xml.Name  `xml:"Event"`
	System    sysBlock  `xml:"System"`
	EventData dataBlock `xml:"EventData"`
	UserData  struct {
		InnerXML string `xml:",innerxml"`
	} `xml:"UserData"`
}

type sysBlock struct {
	EventID       uint32      `xml:"EventID"`
	Channel       string      `xml:"Channel"`
	Computer      string      `xml:"Computer"`
	TimeCreated   timeCreated `xml:"TimeCreated"`
	EventRecordID uint64      `xml:"EventRecordID"`
}

type timeCreated struct {
	SystemTime string `xml:"SystemTime,attr"`
}

type dataBlock struct {
	Data []dataItem `xml:"Data"`
}

type dataItem struct {
	Name  string `xml:"Name,attr"`
	Value string `xml:",chardata"`
}

// ----------------------------------------------------------------------------
// WindowsCollector — EvtQuery polling model
// ----------------------------------------------------------------------------

// WindowsCollector reads a single Windows Event Log channel using a
// poll loop (EvtQuery + EvtNext). This avoids the fragile signal-event
// mechanism of EvtSubscribe and is straightforward to reason about.
type WindowsCollector struct {
	channel     string
	bookmarkXML string // persisted XML, empty = fresh start

	mu             sync.Mutex
	bookmarkHandle syscall.Handle
}

func NewWindowsCollector(channel, bookmarkXML string) *WindowsCollector {
	return &WindowsCollector{
		channel:     channel,
		bookmarkXML: bookmarkXML,
	}
}

func (wc *WindowsCollector) Name() string { return wc.channel }

// Start begins polling the channel and emitting events on the returned channel.
// It closes the channel when ctx is cancelled.
func (wc *WindowsCollector) Start(ctx context.Context) (<-chan Event, error) {
	// Verify the channel is accessible with a quick probe query.
	if err := wc.probe(); err != nil {
		return nil, err
	}

	// Initialise (or restore) the bookmark handle.
	bh, err := wc.initBookmark()
	if err != nil {
		return nil, fmt.Errorf("bookmark init failed: %w", err)
	}
	wc.mu.Lock()
	wc.bookmarkHandle = bh
	wc.mu.Unlock()

	out := make(chan Event, 512)
	go wc.poll(ctx, out)
	return out, nil
}

// probe runs a zero-result query to verify channel access.
func (wc *WindowsCollector) probe() error {
	chPtr, err := syscall.UTF16PtrFromString(wc.channel)
	if err != nil {
		return err
	}
	qPtr, _ := syscall.UTF16PtrFromString("*")
	h, _, callErr := procEvtQuery.Call(
		0,
		uintptr(unsafe.Pointer(chPtr)),
		uintptr(unsafe.Pointer(qPtr)),
		evtQueryChannelPath|evtQueryForwardDirection,
	)
	if h == 0 {
		return fmt.Errorf("EvtQuery(%s) failed: %v", wc.channel, callErr)
	}
	procEvtClose.Call(h)
	return nil
}

// initBookmark creates or restores the bookmark handle.
// Returns a valid bookmark handle or 0 if no bookmark exists yet.
func (wc *WindowsCollector) initBookmark() (syscall.Handle, error) {
	if wc.bookmarkXML == "" {
		// Fresh start — create an empty bookmark.
		bh, _, _ := procEvtCreateBookmark.Call(0)
		return syscall.Handle(bh), nil
	}
	xmlPtr, err := syscall.UTF16PtrFromString(wc.bookmarkXML)
	if err != nil {
		return 0, err
	}
	bh, _, callErr := procEvtCreateBookmark.Call(uintptr(unsafe.Pointer(xmlPtr)))
	if bh == 0 {
		return 0, fmt.Errorf("EvtCreateBookmark from XML failed: %v", callErr)
	}
	return syscall.Handle(bh), nil
}

// poll is the main goroutine. It repeatedly queries the channel, drains
// all available events, then sleeps before querying again.
func (wc *WindowsCollector) poll(ctx context.Context, out chan<- Event) {
	defer close(out)
	defer wc.closeBookmark()

	firstRun := wc.bookmarkXML == ""

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		wc.runQuery(ctx, out, firstRun)
		firstRun = false

		select {
		case <-ctx.Done():
			return
		case <-time.After(pollInterval):
		}
	}
}

// runQuery opens a fresh EvtQuery result set, seeks past the bookmark if one
// exists, drains all events, and updates the bookmark.
func (wc *WindowsCollector) runQuery(ctx context.Context, out chan<- Event, useBackfill bool) {
	chPtr, err := syscall.UTF16PtrFromString(wc.channel)
	if err != nil {
		return
	}

	// Choose query: backfill uses a 24h time filter; subsequent polls use "*"
	// (bookmark seek handles position, so we don't need to re-filter by time).
	queryStr := "*"
	if useBackfill {
		queryStr = backfillQuery
	}
	qPtr, _ := syscall.UTF16PtrFromString(queryStr)

	hQuery, _, callErr := procEvtQuery.Call(
		0,
		uintptr(unsafe.Pointer(chPtr)),
		uintptr(unsafe.Pointer(qPtr)),
		evtQueryChannelPath|evtQueryForwardDirection,
	)
	if hQuery == 0 {
		wc.logErr("EVT_QUERY_ERROR", fmt.Sprintf("EvtQuery(%s): %v", wc.channel, callErr))
		return
	}
	defer procEvtClose.Call(hQuery)

	// Seek past bookmark so we only process unseen events.
	wc.mu.Lock()
	bh := wc.bookmarkHandle
	wc.mu.Unlock()

	if bh != 0 && !useBackfill {
		ret, _, _ := procEvtSeek.Call(
			hQuery,
			0,
			uintptr(bh),
			0,
			evtSeekRelativeToBookmark|evtSeekStrict,
		)
		if ret == 0 {
			// Bookmark seek failed (e.g. log was cleared) — start from beginning.
			procEvtSeek.Call(hQuery, 0, 0, 0, 0x1 /* EvtSeekRelativeToFirst */)
		}
	}

	wc.drain(ctx, hQuery, out)
}

// drain calls EvtNext repeatedly until no more events are available,
// emitting each parsed event on out and updating the bookmark.
func (wc *WindowsCollector) drain(ctx context.Context, hQuery uintptr, out chan<- Event) {
	handles := make([]syscall.Handle, 64)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		var returned uint32
		ret, _, _ := procEvtNext.Call(
			hQuery,
			uintptr(len(handles)),
			uintptr(unsafe.Pointer(&handles[0])),
			0, // timeout = 0, non-blocking
			0,
			uintptr(unsafe.Pointer(&returned)),
		)

		if ret == 0 || returned == 0 {
			// ERROR_NO_MORE_ITEMS — done for this poll cycle.
			break
		}

		for i := uint32(0); i < returned; i++ {
			h := handles[i]

			if ev, err := wc.renderEvent(h); err == nil {
				wc.mu.Lock()
				if wc.bookmarkHandle != 0 {
					procEvtUpdateBookmark.Call(uintptr(wc.bookmarkHandle), uintptr(h))
				}
				wc.mu.Unlock()

				select {
				case out <- ev:
				case <-ctx.Done():
					procEvtClose.Call(uintptr(h))
					for j := i + 1; j < returned; j++ {
						procEvtClose.Call(uintptr(handles[j]))
					}
					return
				}
			}

			procEvtClose.Call(uintptr(h))
		}
	}
}

// renderEvent calls EvtRender to get the XML and parses it.
func (wc *WindowsCollector) renderEvent(h syscall.Handle) (Event, error) {
	var used, propCount uint32

	// First call: size query.
	procEvtRender.Call(
		0, uintptr(h), evtRenderEventXml,
		0, 0,
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if used == 0 {
		return Event{}, fmt.Errorf("EvtRender size query returned 0")
	}

	buf := make([]uint16, (used/2)+2)
	ret, _, callErr := procEvtRender.Call(
		0, uintptr(h), evtRenderEventXml,
		uintptr(used),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if ret == 0 {
		return Event{}, fmt.Errorf("EvtRender failed: %v", callErr)
	}

	return parseEventXML(syscall.UTF16ToString(buf), wc.channel)
}

// parseEventXML parses Windows Event Log XML into an agent Event.
func parseEventXML(xmlStr, channel string) (Event, error) {
	var evx evtXML
	if err := xml.Unmarshal([]byte(xmlStr), &evx); err != nil {
		return Event{}, fmt.Errorf("xml.Unmarshal: %w", err)
	}

	ts, err := time.Parse(time.RFC3339Nano, evx.System.TimeCreated.SystemTime)
	if err != nil {
		ts, err = time.Parse("2006-01-02T15:04:05.9999999Z", evx.System.TimeCreated.SystemTime)
		if err != nil {
			ts = time.Now().UTC()
		}
	}

	eventData := make(map[string]interface{})
	for _, d := range evx.EventData.Data {
		if d.Name != "" {
			eventData[d.Name] = d.Value
		} else if d.Value != "" {
			eventData["value"] = d.Value
		}
	}

	payload := map[string]interface{}{
		"event_id":  evx.System.EventID,
		"channel":   evx.System.Channel,
		"computer":  evx.System.Computer,
		"record_id": evx.System.EventRecordID,
	}
	if len(eventData) > 0 {
		payload["event_data"] = eventData
	} else if ud := evx.UserData.InnerXML; ud != "" {
		payload["user_data"] = ud
	}

	src := evx.System.Channel
	if src == "" {
		src = channel
	}

	return Event{
		Source:    "winlog:" + src,
		Event:     payload,
		Timestamp: ts.UTC(),
	}, nil
}

// SaveBookmark renders the current bookmark to XML and writes it to
// <dir>/<sanitizedChannelName>.xml, creating dir if necessary.
func (wc *WindowsCollector) SaveBookmark(dir string) error {
	wc.mu.Lock()
	bh := wc.bookmarkHandle
	wc.mu.Unlock()

	if bh == 0 {
		return nil
	}

	var used, propCount uint32
	procEvtRender.Call(
		0, uintptr(bh), evtRenderBookmark,
		0, 0,
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if used == 0 {
		return fmt.Errorf("EvtRender(bookmark) returned 0 bytes")
	}

	buf := make([]uint16, (used/2)+2)
	ret, _, callErr := procEvtRender.Call(
		0, uintptr(bh), evtRenderBookmark,
		uintptr(used),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if ret == 0 {
		return fmt.Errorf("EvtRender(bookmark) failed: %v", callErr)
	}

	path := filepath.Join(dir, sanitizeChannelName(wc.channel)+".xml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(syscall.UTF16ToString(buf)), 0o644)
}

// sanitizeChannelName converts a Windows Event Log channel name into a safe
// filename component by replacing path separators and colons with underscores
// and lower-casing the result.
func sanitizeChannelName(ch string) string {
	replacer := strings.NewReplacer("/", "_", `\`, "_", ":", "_", " ", "_")
	return strings.ToLower(replacer.Replace(ch))
}

func (wc *WindowsCollector) closeBookmark() {
	wc.mu.Lock()
	defer wc.mu.Unlock()
	if wc.bookmarkHandle != 0 {
		procEvtClose.Call(uintptr(wc.bookmarkHandle))
		wc.bookmarkHandle = 0
	}
}

func (wc *WindowsCollector) logErr(code, msg string) {
	fmt.Fprintf(os.Stderr, `{"error_code":%q,"message":%q}`+"\n", code, msg)
}

// ----------------------------------------------------------------------------
// Helpers used by cmd/agent.go
// ----------------------------------------------------------------------------

// LoadBookmarkXML reads the per-channel bookmark file from dir and returns its
// XML content. Returns "" if the file does not exist (fresh start for that channel).
func LoadBookmarkXML(dir, channel string) string {
	path := filepath.Join(dir, sanitizeChannelName(channel)+".xml")
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

// NewWindowsCollectors creates one WindowsCollector per channel, each loading
// its own bookmark from bookmarkDir so positions are never shared.
func NewWindowsCollectors(channels []string, bookmarkDir string) []Collector {
	cols := make([]Collector, 0, len(channels))
	for _, ch := range channels {
		xml := LoadBookmarkXML(bookmarkDir, ch)
		cols = append(cols, NewWindowsCollector(ch, xml))
	}
	return cols
}
