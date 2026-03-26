package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// APIError represents a structured error returned by the API or the client itself.
type APIError struct {
	ErrorCode string `json:"error_code"`
	Message   string `json:"message"`
	Detail    string `json:"detail"`
	Hint      string `json:"hint,omitempty"`
}

func (e *APIError) Error() string {
	b, _ := json.Marshal(e)
	return string(b)
}

// Client is a thin HTTP wrapper for the Vigil API.
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// New creates a new Client with sensible defaults.
// apiKey may be empty for unauthenticated deployments.
func New(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Post sends a JSON POST request to path and decodes the response into dest.
// Returns *APIError on any failure.
func (c *Client) Post(path string, body interface{}, dest interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return &APIError{
			ErrorCode: "MARSHAL_ERROR",
			Message:   "failed to marshal request body",
			Detail:    err.Error(),
		}
	}

	req, err := http.NewRequest(http.MethodPost, c.BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return &APIError{
			ErrorCode: "REQUEST_BUILD_ERROR",
			Message:   "failed to build HTTP request",
			Detail:    err.Error(),
		}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	return c.do(req, dest)
}

// Get sends a GET request to path with optional query params and decodes into dest.
func (c *Client) Get(path string, params map[string]string, dest interface{}) error {
	u, err := url.Parse(c.BaseURL + path)
	if err != nil {
		return &APIError{
			ErrorCode: "URL_PARSE_ERROR",
			Message:   "failed to parse request URL",
			Detail:    err.Error(),
		}
	}

	if len(params) > 0 {
		q := u.Query()
		for k, v := range params {
			if v != "" {
				q.Set(k, v)
			}
		}
		u.RawQuery = q.Encode()
	}

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return &APIError{
			ErrorCode: "REQUEST_BUILD_ERROR",
			Message:   "failed to build HTTP request",
			Detail:    err.Error(),
		}
	}
	req.Header.Set("Accept", "application/json")

	return c.do(req, dest)
}

// Patch sends a JSON PATCH request to path and decodes the response into dest.
// Returns *APIError on any failure.
func (c *Client) Patch(path string, body interface{}, dest interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return &APIError{
			ErrorCode: "MARSHAL_ERROR",
			Message:   "failed to marshal request body",
			Detail:    err.Error(),
		}
	}

	req, err := http.NewRequest(http.MethodPatch, c.BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return &APIError{
			ErrorCode: "REQUEST_BUILD_ERROR",
			Message:   "failed to build HTTP request",
			Detail:    err.Error(),
		}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	return c.do(req, dest)
}

// Delete sends a DELETE request to path.
// Returns *APIError on any failure.
func (c *Client) Delete(path string) error {
	req, err := http.NewRequest(http.MethodDelete, c.BaseURL+path, nil)
	if err != nil {
		return &APIError{
			ErrorCode: "REQUEST_BUILD_ERROR",
			Message:   "failed to build HTTP request",
			Detail:    err.Error(),
		}
	}
	req.Header.Set("Accept", "application/json")

	return c.do(req, nil)
}

func (c *Client) do(req *http.Request, dest interface{}) error {
	if c.APIKey != "" {
		req.Header.Set("X-Vigil-Key", c.APIKey)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return &APIError{
			ErrorCode: "CONNECTION_ERROR",
			Message:   fmt.Sprintf("could not reach API at %s", c.BaseURL),
			Detail:    err.Error(),
		}
	}
	defer resp.Body.Close()

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return &APIError{
			ErrorCode: "READ_ERROR",
			Message:   "failed to read API response body",
			Detail:    err.Error(),
		}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Try to decode a structured API error first.
		var apiErr APIError
		if jsonErr := json.Unmarshal(rawBody, &apiErr); jsonErr == nil && apiErr.ErrorCode != "" {
			return &apiErr
		}
		return &APIError{
			ErrorCode: fmt.Sprintf("HTTP_%d", resp.StatusCode),
			Message:   fmt.Sprintf("API returned non-2xx status %d", resp.StatusCode),
			Detail:    string(rawBody),
		}
	}

	if dest != nil {
		if err := json.Unmarshal(rawBody, dest); err != nil {
			return &APIError{
				ErrorCode: "DECODE_ERROR",
				Message:   "failed to decode API response",
				Detail:    err.Error(),
			}
		}
	}

	return nil
}
