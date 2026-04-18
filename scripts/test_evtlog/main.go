//go:build windows

// Standalone diagnostic: reads the last 10 Security events directly via wevtapi.dll.
// Run this as Administrator to verify Event Log API access before using vigil agent.
//
// Usage:
//   cd scripts/test_evtlog
//   go run .
package main

import (
	"encoding/xml"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

var (
	wevtapi      = syscall.NewLazyDLL("wevtapi.dll")
	procEvtQuery = wevtapi.NewProc("EvtQuery")
	procEvtNext  = wevtapi.NewProc("EvtNext")
	procEvtRender = wevtapi.NewProc("EvtRender")
	procEvtClose  = wevtapi.NewProc("EvtClose")
)

const (
	evtQueryChannelPath      = 0x1
	evtQueryForwardDirection = 0x100
	evtRenderEventXml        = 1
)

type evtXML struct {
	XMLName xml.Name `xml:"Event"`
	System  struct {
		EventID   uint32 `xml:"EventID"`
		Channel   string `xml:"Channel"`
		Computer  string `xml:"Computer"`
		TimeCreated struct {
			SystemTime string `xml:"SystemTime,attr"`
		} `xml:"TimeCreated"`
	} `xml:"System"`
	EventData struct {
		Data []struct {
			Name  string `xml:"Name,attr"`
			Value string `xml:",chardata"`
		} `xml:"Data"`
	} `xml:"EventData"`
}

func main() {
	channel := "Security"
	if len(os.Args) > 1 {
		channel = os.Args[1]
	}

	fmt.Printf("Querying channel: %s\n\n", channel)

	chPtr, _ := syscall.UTF16PtrFromString(channel)
	queryStr := "*[System[TimeCreated[timediff(@SystemTime) <= 86400000]]]"
	qPtr, _ := syscall.UTF16PtrFromString(queryStr)

	hQuery, _, err := procEvtQuery.Call(
		0, // local session
		uintptr(unsafe.Pointer(chPtr)),
		uintptr(unsafe.Pointer(qPtr)),
		uintptr(evtQueryChannelPath|evtQueryForwardDirection),
	)
	if hQuery == 0 {
		fmt.Fprintf(os.Stderr, "EvtQuery failed: %v\n", err)
		fmt.Fprintf(os.Stderr, "Make sure you are running as Administrator.\n")
		os.Exit(1)
	}
	defer procEvtClose.Call(hQuery)

	handles := make([]syscall.Handle, 10)
	var returned uint32
	count := 0

	for {
		ret, _, _ := procEvtNext.Call(
			hQuery,
			10,
			uintptr(unsafe.Pointer(&handles[0])),
			0,
			0,
			uintptr(unsafe.Pointer(&returned)),
		)
		if ret == 0 || returned == 0 {
			break
		}
		for i := uint32(0); i < returned; i++ {
			h := handles[i]
			xmlStr, err := renderXML(h)
			procEvtClose.Call(uintptr(h))
			if err != nil {
				fmt.Printf("[%d] render error: %v\n", count+1, err)
				continue
			}
			var ev evtXML
			if err := xml.Unmarshal([]byte(xmlStr), &ev); err != nil {
				fmt.Printf("[%d] xml parse error: %v\n", count+1, err)
				continue
			}
			fmt.Printf("[%d] EventID=%-6d  Time=%-30s  Channel=%s  Computer=%s\n",
				count+1,
				ev.System.EventID,
				ev.System.TimeCreated.SystemTime,
				ev.System.Channel,
				ev.System.Computer,
			)
			count++
			if count >= 10 {
				fmt.Printf("\n--- showing first 10 events, done ---\n")
				return
			}
		}
	}

	if count == 0 {
		fmt.Println("No events found in the last 24 hours.")
		fmt.Println("Try: go run . System")
	} else {
		fmt.Printf("\nFound %d event(s). wevtapi.dll access is working.\n", count)
	}
}

func renderXML(h syscall.Handle) (string, error) {
	var used, propCount uint32
	procEvtRender.Call(0, uintptr(h), evtRenderEventXml, 0, 0,
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if used == 0 {
		return "", fmt.Errorf("EvtRender size query returned 0")
	}
	buf := make([]uint16, (used/2)+1)
	ret, _, callErr := procEvtRender.Call(
		0, uintptr(h), evtRenderEventXml,
		uintptr(used),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&used)),
		uintptr(unsafe.Pointer(&propCount)),
	)
	if ret == 0 {
		return "", fmt.Errorf("EvtRender failed: %v", callErr)
	}
	return syscall.UTF16ToString(buf), nil
}
