package output

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/olekukonko/tablewriter"
)

// Mode is either "json" or "table".
type Mode string

const (
	ModeJSON  Mode = "json"
	ModeTable Mode = "table"
)

// ParseMode converts a string flag value to a Mode, defaulting to table.
func ParseMode(s string) Mode {
	if s == "json" {
		return ModeJSON
	}
	return ModeTable
}

// PrintJSON marshals v and writes it to stdout with indentation.
func PrintJSON(v interface{}) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

// PrintError writes a structured JSON error to stderr and causes the process to
// exit with code 1. It never panics.
func PrintError(errorCode, message, detail string) {
	type errOut struct {
		ErrorCode string `json:"error_code"`
		Message   string `json:"message"`
		Detail    string `json:"detail"`
	}
	e := errOut{ErrorCode: errorCode, Message: message, Detail: detail}
	enc := json.NewEncoder(os.Stderr)
	enc.SetIndent("", "  ")
	_ = enc.Encode(e)
	os.Exit(1)
}

// PrintErrorFromErr extracts fields from an *APIError-compatible error and
// calls PrintError. Falls back to generic codes when the error is not
// structured.
func PrintErrorFromErr(err error) {
	type structured interface {
		Error() string
	}

	type apiError interface {
		structured
		GetCode() string
		GetMessage() string
		GetDetail() string
	}

	// Try to unmarshal the error string as JSON (our client always returns JSON).
	type errShape struct {
		ErrorCode string `json:"error_code"`
		Message   string `json:"message"`
		Detail    string `json:"detail"`
	}
	var shape errShape
	if jsonErr := json.Unmarshal([]byte(err.Error()), &shape); jsonErr == nil && shape.ErrorCode != "" {
		PrintError(shape.ErrorCode, shape.Message, shape.Detail)
		return
	}

	PrintError("UNKNOWN_ERROR", err.Error(), "")
}

// NewTable creates a tablewriter configured for consistent Vigil output.
func NewTable(headers []string) *tablewriter.Table {
	t := tablewriter.NewWriter(os.Stdout)
	t.SetHeader(headers)
	t.SetBorder(true)
	t.SetAutoWrapText(false)
	t.SetHeaderAlignment(tablewriter.ALIGN_LEFT)
	t.SetAlignment(tablewriter.ALIGN_LEFT)
	return t
}

// Println writes a plain line to stdout.
func Println(s string) {
	fmt.Fprintln(os.Stdout, s)
}
