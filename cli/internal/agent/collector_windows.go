//go:build windows

package agent

import (
	"context"
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
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

	procEvtSubscribe      = wevtapi.NewProc("EvtSubscribe")
	procEvtNext           = wevtapi.NewProc("EvtNext")
	procEvtRender         = wevtapi.NewProc("EvtRender")
	procEvtClose          = wevtapi.NewProc("EvtClose")
	procEvtCreateBookmark = wevtapi.NewProc("EvtCreateBookmark")
	procEvtUpdateBookmark = wevtapi.NewProc("EvtUpdateBookmark")
	procEvtOpenSession    = wevtapi.NewProc("EvtOpenSession") // unused but declared for completeness
)

var (
	kernel32       = syscall.NewLazyDLL("kernel32.dll")
	procCreateEvent = kernel32.NewProc("CreateEventW")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
)

const (
	evtSubscribeToFutureEvents      = 0x1
	evtSubscribeStartAfterBookmark  = 0x3
	evtRenderEventXml               = 1
	evtRenderBookmark               = 2

	// EvtSubscribeNotifyAsync callback flag — we use event-based signalling instead.
	evtSubscribeActionDeliver = 0

	waitObject0    = 0x00000000
	waitTimeout    = 0x00000102
	waitFailed     = 0xFFFFFFFF
	infinite       = 0xFFFFFFFF
	maxBatchEvents = 256
)

// ----------------------------------------------------------------------------
// XML structures for parsing Windows Event Log XML
// ----------------------------------------------------------------------------

type evtXML struct {
	XMLName xml.Name  `xml:"Event"`
	System  sysBlock  `xml:"System"`
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
// WindowsCollector
// ----------------------------------------------------------------------------

// WindowsCollector subscribes to a single Windows Event Log channel.
type WindowsCollector struct {
	channel      string
	bookmarkXML  string // XML loaded from file at startup; empty = no bookmark
	subHandle    syscall.Handle
	signalHandle syscall.Handle

	mu           sync.Mutex
	bookmarkHandle syscall.Handle // live bookmark handle, updated per event
}

// NewWindowsCollector creates a collector for the given channel.
// bookmarkXML is the persisted bookmark XML (may be empty for fresh start).
func NewWindowsCollector(channel, bookmarkXML string) *WindowsCollector {
	return &WindowsCollector{
		channel:     channel,
		bookmarkXML: bookmarkXML,
	}
}

func (wc *WindowsCollector) Name() string { return wc.channel }

// Start opens the event subscription and begins pumping events onto the returned channel.
func (wc *WindowsCollector) Start(ctx context.Context) (<-chan Event, error) {
	// Create an auto-reset Windows Event for signalling.
	signal, _, err := procCreateEvent.Call(0, 0, 0, 0)
	if signal == 0 {
		return nil, fmt.Errorf("CreateEvent failed: %w", err)
	}
	wc.signalHandle = syscall.Handle(signal)

	channelPtr, err := syscall.UTF16PtrFromString(wc.channel)
	if err != nil {
		return nil, fmt.Errorf("UTF16PtrFromString(%s): %w", wc.channel, err)
	}

	var flags uintptr
	var bookmarkHandle syscall.Handle

	if wc.bookmarkXML != "" {
		// Re-create bookmark handle from the persisted XML.
		xmlPtr, xmlErr := syscall.UTF16PtrFromString(wc.bookmarkXML)
		if xmlErr == nil {
			bh, _, _ := procEvtCreateBookmark.Call(uintptr(unsafe.Pointer(xmlPtr)))
			if bh != 0 {
				bookmarkHandle = syscall.Handle(bh)
				flags = evtSubscribeStartAfterBookmark
			}
		}
	}
	if flags == 0 {
		flags = evtSubscribeToFutureEvents
	}

	// EvtSubscribe(Session=NULL, SignalEvent, Channel, Query=NULL,
	//              Bookmark, Context=NULL, Callback=NULL, Flags)
	sub, _, callErr := procEvtSubscribe.Call(
		0,                                 // session (local)
		uintptr(wc.signalHandle),          // signal event handle
		uintptr(unsafe.Pointer(channelPtr)),
		0,                                 // query (all events)
		uintptr(bookmarkHandle),
		0,                                 // context
		0,                                 // callback
		flags,
	)

	if bookmarkHandle != 0 {
		procEvtClose.Call(uintptr(bookmarkHandle))
	}

	if sub == 0 {
		syscall.CloseHandle(wc.signalHandle)
		// Treat "channel not found" as non-fatal — caller skips silently.
		return nil, fmt.Errorf("EvtSubscribe(%s) failed: %v", wc.channel, callErr)
	}
	wc.subHandle = syscall.Handle(sub)

	// Create a live bookmark handle to track position.
	bh, _, _ := procEvtCreateBookmark.Call(0)
	wc.mu.Lock()
	wc.bookmarkHandle = syscall.Handle(bh)
	wc.mu.Unlock()

	out := make(chan Event, 256)
	go wc.pump(ctx, out)
	return out, nil
}

// pump is the goroutine that waits for the signal event and drains batches.
func (wc *WindowsCollector) pump(ctx context.Context, out chan<- Event) {
	defer close(out)
	defer wc.cleanup()

	handles := [1]uintptr{uintptr(wc.signalHandle)}
	_ = handles

	for {
		// Check context first.
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Wait up to 1 second for the signal event (keeps ctx cancellation responsive).
		ret, _, _ := procWaitForSingleObject.Call(uintptr(wc.signalHandle), 1000)
		switch ret {
		case waitFailed:
			return
		case waitTimeout:
			continue
		}

		// Signal fired — drain all available event handles.
		wc.drainBatch(ctx, out)
	}
}

// drainBatch calls EvtNext in a loop until no more events are available.
func (wc *WindowsCollector) drainBatch(ctx context.Context, out chan<- Event) {
	handles := make([]syscall.Handle, maxBatchEvents)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		var returned uint32
		ret, _, _ := procEvtNext.Call(
			uintptr(wc.subHandle),
			uintptr(maxBatchEvents),
			uintptr(unsafe.Pointer(&handles[0])),
			0,    // timeout=0 (non-blocking)
			0,    // reserved
			uintptr(unsafe.Pointer(&returned)),
		)

		if ret == 0 || returned == 0 {
			// ERROR_NO_MORE_ITEMS or failure — done with this signal cycle.
			break
		}

		for i := uint32(0); i < returned; i++ {
			h := handles[i]
			if ev, err := wc.renderEvent(h); err == nil {
				// Update live bookmark.
				wc.mu.Lock()
				if wc.bookmarkHandle != 0 {
					procEvtUpdateBookmark.Call(uintptr(wc.bookmarkHandle), uintptr(h))
				}
				wc.mu.Unlock()

				select {
				case out <- ev:
				case <-ctx.Done():
					procEvtClose.Call(uintptr(h))
					return
				}
			}
			procEvtClose.Call(uintptr(h))
		}
	}
}

// renderEvent calls EvtRender to get the XML, then parses it into an Event.
func (wc *WindowsCollector) renderEvent(h syscall.Handle) (Event, error) {
	// First call: get required buffer size.
	var used, propCount uint32
	procEvtRender.Call(
		0,
		uintptr(h),
		evtRenderEventXml,
		0,
		0,
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)

	if used == 0 {
		return Event{}, fmt.Errorf("EvtRender returned 0 bytes needed")
	}

	buf := make([]uint16, (used/2)+1)
	ret, _, callErr := procEvtRender.Call(
		0,
		uintptr(h),
		evtRenderEventXml,
		uintptr(used),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if ret == 0 {
		return Event{}, fmt.Errorf("EvtRender failed: %v", callErr)
	}

	xmlStr := syscall.UTF16ToString(buf)
	return parseEventXML(xmlStr, wc.channel)
}

// parseEventXML parses Windows Event Log XML into an Event.
func parseEventXML(xmlStr, channel string) (Event, error) {
	var evx evtXML
	if err := xml.Unmarshal([]byte(xmlStr), &evx); err != nil {
		return Event{}, fmt.Errorf("xml.Unmarshal: %w", err)
	}

	ts, err := time.Parse(time.RFC3339Nano, evx.System.TimeCreated.SystemTime)
	if err != nil {
		// Try alternate format without nanoseconds.
		ts, err = time.Parse("2006-01-02T15:04:05.9999999Z", evx.System.TimeCreated.SystemTime)
		if err != nil {
			ts = time.Now().UTC()
		}
	}

	eventData := make(map[string]interface{})
	for _, d := range evx.EventData.Data {
		if d.Name != "" {
			eventData[d.Name] = d.Value
		} else {
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

	// Use the actual channel from the XML when possible; fall back to the
	// subscription channel name so events are never source-less.
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

// SaveBookmark renders the current bookmark handle to XML and writes it to path.
func (wc *WindowsCollector) SaveBookmark(path string) error {
	wc.mu.Lock()
	bh := wc.bookmarkHandle
	wc.mu.Unlock()

	if bh == 0 {
		return nil
	}

	// Render bookmark to XML.
	var used, propCount uint32
	procEvtRender.Call(
		0,
		uintptr(bh),
		evtRenderBookmark,
		0,
		0,
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if used == 0 {
		return fmt.Errorf("EvtRender(bookmark) returned 0 bytes")
	}

	buf := make([]uint16, (used/2)+1)
	ret, _, callErr := procEvtRender.Call(
		0,
		uintptr(bh),
		evtRenderBookmark,
		uintptr(used),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if ret == 0 {
		return fmt.Errorf("EvtRender(bookmark) failed: %v", callErr)
	}

	xmlStr := syscall.UTF16ToString(buf)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(xmlStr), 0o644)
}

// cleanup closes all open handles.
func (wc *WindowsCollector) cleanup() {
	if wc.subHandle != 0 {
		procEvtClose.Call(uintptr(wc.subHandle))
		wc.subHandle = 0
	}
	if wc.signalHandle != 0 {
		syscall.CloseHandle(wc.signalHandle)
		wc.signalHandle = 0
	}
	wc.mu.Lock()
	if wc.bookmarkHandle != 0 {
		procEvtClose.Call(uintptr(wc.bookmarkHandle))
		wc.bookmarkHandle = 0
	}
	wc.mu.Unlock()
}

// ----------------------------------------------------------------------------
// BuildCollectors creates collectors for the requested channels.
// Channels that fail to start are skipped (not fatal).
// ----------------------------------------------------------------------------

// LoadBookmarkXML reads the persisted bookmark XML from disk.
// Returns empty string if the file does not exist.
func LoadBookmarkXML(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

// NewWindowsCollectors constructs a WindowsCollector per channel.
// The bookmark XML is shared across all collectors (they each update it
// independently, so the last one wins — acceptable for Phase 1).
func NewWindowsCollectors(channels []string, bookmarkXML string) []Collector {
	cols := make([]Collector, 0, len(channels))
	for _, ch := range channels {
		cols = append(cols, NewWindowsCollector(ch, bookmarkXML))
	}
	return cols
}
