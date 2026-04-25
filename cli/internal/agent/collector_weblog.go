package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// WebLogFormat identifies the HTTP access log format.
type WebLogFormat string

const (
	WebLogFormatNginx  WebLogFormat = "nginx"
	WebLogFormatApache WebLogFormat = "apache"
	WebLogFormatCLF    WebLogFormat = "clf"
	WebLogFormatJSON   WebLogFormat = "json"
)

// WebLogCollector tails an HTTP access log and emits one event per request.
// Source prefix: web:<appName>. Cross-platform — no build tag required.
type WebLogCollector struct {
	appName    string
	logPath    string
	format     WebLogFormat
	offsetFile string
	offset     int64
}

func NewWebLogCollector(appName, logPath string, format WebLogFormat, offsetFile string) *WebLogCollector {
	return &WebLogCollector{
		appName:    appName,
		logPath:    logPath,
		format:     format,
		offsetFile: offsetFile,
	}
}

func (wc *WebLogCollector) Name() string { return "web:" + wc.appName }

func (wc *WebLogCollector) Start(ctx context.Context) (<-chan Event, error) {
	if _, err := os.Stat(wc.logPath); err != nil {
		return nil, fmt.Errorf("web log file not accessible: %s: %w", wc.logPath, err)
	}
	wc.offset = wc.loadOffset()
	out := make(chan Event, 512)
	go wc.tail(ctx, out)
	return out, nil
}

func (wc *WebLogCollector) tail(ctx context.Context, out chan<- Event) {
	defer close(out)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		wc.readNew(ctx, out)
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (wc *WebLogCollector) readNew(ctx context.Context, out chan<- Event) {
	f, err := os.Open(wc.logPath)
	if err != nil {
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return
	}

	// Handle log rotation: reset on shrink.
	if info.Size() < wc.offset {
		wc.offset = 0
	}

	// First run: backfill last 200 KB to avoid flooding the API.
	if wc.offset == 0 && info.Size() > 0 {
		const backfillBytes = 200 * 1024
		if info.Size() > backfillBytes {
			wc.offset = wc.findLineStart(f, info.Size()-backfillBytes)
		}
	}

	if _, err := f.Seek(wc.offset, 0); err != nil {
		return
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1<<20), 1<<20)

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}
		line := scanner.Text()
		if line == "" {
			continue
		}
		ev := wc.parseLine(line)
		select {
		case out <- ev:
		case <-ctx.Done():
			return
		}
	}

	if pos, err := f.Seek(0, 1); err == nil {
		wc.offset = pos
	}
}

func (wc *WebLogCollector) findLineStart(f *os.File, pos int64) int64 {
	buf := make([]byte, 512)
	if _, err := f.ReadAt(buf, pos); err != nil {
		return pos
	}
	idx := strings.Index(string(buf), "\n")
	if idx < 0 {
		return pos
	}
	return pos + int64(idx) + 1
}

func (wc *WebLogCollector) parseLine(line string) Event {
	ts := time.Now().UTC()
	var fields map[string]any

	switch wc.format {
	case WebLogFormatJSON:
		fields = parseWebLogJSON(line, wc.appName)
	case WebLogFormatCLF:
		fields = parseWebCLF(line, wc.appName)
	default: // nginx and apache use identical combined format
		fields = parseWebCombined(line, wc.appName, string(wc.format))
	}

	if fields == nil {
		fields = map[string]any{
			"app_name":    wc.appName,
			"log_format":  string(wc.format),
			"raw":         line,
			"channel":     "web",
			"parse_error": true,
		}
	}

	return Event{Source: "web:" + wc.appName, Event: fields, Timestamp: ts}
}

// combinedLogRe matches nginx/apache combined format:
// $remote_addr - $remote_user [$time_local] "$request" $status $bytes "$referer" "$ua"
var combinedLogRe = regexp.MustCompile(
	`^(\S+) \S+ (\S+) \[([^\]]+)\] "([^"]*)" (\d+) (\d+|-) "([^"]*)" "([^"]*)"`,
)

// clfLogRe matches Common Log Format (no referer/UA).
var clfLogRe = regexp.MustCompile(
	`^(\S+) \S+ (\S+) \[([^\]]+)\] "([^"]*)" (\d+) (\d+|-)`,
)

func parseWebCombined(line, appName, format string) map[string]any {
	m := combinedLogRe.FindStringSubmatch(line)
	if m == nil {
		return nil
	}
	fields := buildWebFields(appName, format, line, m[1], m[2], m[3], m[4], m[5], m[6])
	fields["referer"] = dashToEmpty(m[7])
	fields["user_agent"] = dashToEmpty(m[8])
	fields["ua_category"] = classifyUA(m[8])
	return fields
}

func parseWebCLF(line, appName string) map[string]any {
	m := clfLogRe.FindStringSubmatch(line)
	if m == nil {
		return nil
	}
	fields := buildWebFields(appName, "clf", line, m[1], m[2], m[3], m[4], m[5], m[6])
	fields["referer"] = ""
	fields["user_agent"] = ""
	fields["ua_category"] = "unknown"
	return fields
}

func buildWebFields(appName, format, raw, ip, user, timeLocal, request, statusStr, bytesStr string) map[string]any {
	statusCode, _ := strconv.Atoi(statusStr)
	bytesSent, _ := strconv.ParseInt(dashToEmpty(bytesStr), 10, 64)
	method, path, query, protocol := splitHTTPRequest(request)

	return map[string]any{
		"app_name":         appName,
		"log_format":       format,
		"raw":              raw,
		"channel":          "web",
		"client_ip":        ip,
		"remote_user":      dashToEmpty(user),
		"timestamp_local":  timeLocal,
		"method":           method,
		"path":             path,
		"query":            query,
		"protocol":         protocol,
		"request_line":     request,
		"status_code":      statusCode,
		"status_class":     httpStatusClass(statusCode),
		"bytes_sent":       bytesSent,
		"path_depth":       pathDepth(path),
		"extension":        pathExtension(path),
		"has_traversal":    hasTraversal(path, query),
		"has_sql_chars":    hasSQLChars(path, query),
		"is_admin_path":    isAdminPath(path),
		"is_sensitive_path": isSensitivePath(path),
		"is_error":         statusCode >= 400,
	}
}

func parseWebLogJSON(line, appName string) map[string]any {
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return nil
	}

	pick := func(keys ...string) any {
		for _, k := range keys {
			if v, ok := raw[k]; ok && v != nil {
				return v
			}
		}
		return nil
	}
	str := func(v any) string {
		if v == nil {
			return ""
		}
		s := fmt.Sprintf("%v", v)
		if s == "<nil>" {
			return ""
		}
		return s
	}

	ip := str(pick("remote_addr", "client_ip", "ip", "clientIp"))
	method := strings.ToUpper(str(pick("method", "request_method", "http_method")))
	rawURI := str(pick("path", "uri", "request_uri", "url", "http_uri"))
	ua := str(pick("http_user_agent", "user_agent", "userAgent", "ua"))
	referer := str(pick("http_referer", "referer", "referrer"))

	statusCode := 0
	if sv := pick("status", "status_code", "response_code", "statusCode"); sv != nil {
		switch v := sv.(type) {
		case float64:
			statusCode = int(v)
		case string:
			statusCode, _ = strconv.Atoi(v)
		}
	}

	var bytesSent int64
	if bv := pick("bytes_sent", "body_bytes_sent", "bytes", "size"); bv != nil {
		switch v := bv.(type) {
		case float64:
			bytesSent = int64(v)
		case string:
			bytesSent, _ = strconv.ParseInt(v, 10, 64)
		}
	}

	path := rawURI
	query := ""
	if idx := strings.Index(rawURI, "?"); idx >= 0 {
		path = rawURI[:idx]
		query = rawURI[idx+1:]
	}

	return map[string]any{
		"app_name":         appName,
		"log_format":       "json",
		"raw":              line,
		"channel":          "web",
		"client_ip":        ip,
		"remote_user":      "",
		"method":           method,
		"path":             path,
		"query":            query,
		"request_line":     method + " " + rawURI,
		"status_code":      statusCode,
		"status_class":     httpStatusClass(statusCode),
		"bytes_sent":       bytesSent,
		"user_agent":       ua,
		"ua_category":      classifyUA(ua),
		"referer":          referer,
		"path_depth":       pathDepth(path),
		"extension":        pathExtension(path),
		"has_traversal":    hasTraversal(path, query),
		"has_sql_chars":    hasSQLChars(path, query),
		"is_admin_path":    isAdminPath(path),
		"is_sensitive_path": isSensitivePath(path),
		"is_error":         statusCode >= 400,
	}
}

// splitHTTPRequest splits "GET /path?q=1 HTTP/1.1" into components.
// URL-decodes path and query so detection logic sees canonical values.
func splitHTTPRequest(req string) (method, path, query, protocol string) {
	parts := strings.SplitN(req, " ", 3)
	if len(parts) < 2 {
		return req, "", "", ""
	}
	method = parts[0]
	rawURI := parts[1]
	if len(parts) == 3 {
		protocol = parts[2]
	}
	if idx := strings.Index(rawURI, "?"); idx >= 0 {
		path = rawURI[:idx]
		q, err := url.QueryUnescape(rawURI[idx+1:])
		if err != nil {
			q = rawURI[idx+1:]
		}
		query = q
	} else {
		path = rawURI
	}
	if decoded, err := url.PathUnescape(path); err == nil {
		path = decoded
	}
	return
}

func httpStatusClass(code int) string {
	switch {
	case code >= 200 && code < 300:
		return "2xx"
	case code >= 300 && code < 400:
		return "3xx"
	case code >= 400 && code < 500:
		return "4xx"
	case code >= 500:
		return "5xx"
	default:
		return "unknown"
	}
}

func pathDepth(p string) int {
	return strings.Count(strings.TrimRight(p, "/"), "/")
}

func pathExtension(p string) string {
	dot := strings.LastIndex(p, ".")
	slash := strings.LastIndex(p, "/")
	if dot > slash {
		return strings.ToLower(p[dot+1:])
	}
	return ""
}

func hasTraversal(path, query string) bool {
	combined := strings.ToLower(path + " " + query)
	return strings.Contains(combined, "../") ||
		strings.Contains(combined, `..\\`) ||
		strings.Contains(combined, "%2e%2e") ||
		strings.Contains(combined, "%2f..") ||
		strings.Contains(combined, "..%2f") ||
		strings.Contains(combined, "..%5c")
}

// sqlPatternPath excludes "--" because double-hyphens are common in URL slugs
// (e.g. /lander/my-page--copy-1). SQL keywords in the path are still flagged.
var sqlPatternPath = regexp.MustCompile(
	`(?i)(\bselect\b|\bunion\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\bexec\b|'.*;|xp_|\bor\b\s+\d+\s*=\s*\d+|\band\b\s+\d+\s*=\s*\d+)`,
)

// sqlPatternQuery includes "--" because SQL comment sequences in query strings
// are a reliable injection indicator unlike path slugs.
var sqlPatternQuery = regexp.MustCompile(
	`(?i)(\bselect\b|\bunion\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\bexec\b|--|'.*;|xp_|\bor\b\s+\d+\s*=\s*\d+|\band\b\s+\d+\s*=\s*\d+)`,
)

func hasSQLChars(path, query string) bool {
	return sqlPatternPath.MatchString(path) || sqlPatternQuery.MatchString(query)
}

var adminPrefixes = []string{
	"/admin", "/wp-admin", "/administrator", "/phpmyadmin", "/pma",
	"/manage", "/management", "/dashboard", "/console", "/cpanel",
	"/webmin", "/plesk", "/directadmin",
}

func isAdminPath(path string) bool {
	lower := strings.ToLower(path)
	for _, p := range adminPrefixes {
		if strings.HasPrefix(lower, p) {
			return true
		}
	}
	return false
}

var sensitivePrefixOrContains = []string{
	"/.env", "/.git", "/.ssh", "/backup", "/wp-config",
	"/config", "/credentials", "/secrets", "/private",
	"/etc/passwd", "/proc/", "/server-status", "/server-info",
	"/.htaccess", "/.htpasswd", "/web.config", "/appsettings",
}

func isSensitivePath(path string) bool {
	lower := strings.ToLower(path)
	for _, p := range sensitivePrefixOrContains {
		if strings.HasPrefix(lower, p) || strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

var knownScanners = []string{
	"sqlmap", "nikto", "nmap", "masscan", "gobuster", "dirbuster",
	"nuclei", "wfuzz", "ffuf", "burpsuite", "burp suite", "acunetix",
	"nessus", "openvas", "zgrab", "shodan", "censys",
	"libwww-perl", "lwp-trivial", "python-requests",
	"go-http-client/1.1", // generic Go HTTP scanner heuristic kept here to avoid false positives
	"scrapy", "mechanize", "httpclient",
}

var knownBots = []string{
	"googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
	"yandexbot", "facebookexternalhit", "twitterbot", "linkedinbot",
	"ahrefsbot", "semrushbot", "mj12bot", "dotbot",
}

func classifyUA(ua string) string {
	lower := strings.ToLower(ua)
	if lower == "" || lower == "-" {
		return "unknown"
	}
	for _, s := range knownScanners {
		if strings.Contains(lower, s) {
			return "scanner"
		}
	}
	for _, b := range knownBots {
		if strings.Contains(lower, b) {
			return "bot"
		}
	}
	if strings.Contains(lower, "mozilla") || strings.Contains(lower, "webkit") ||
		strings.Contains(lower, "gecko") || strings.Contains(lower, "presto") {
		return "browser"
	}
	return "tool"
}

func dashToEmpty(s string) string {
	if s == "-" {
		return ""
	}
	return s
}

func (wc *WebLogCollector) SaveBookmark(_ string) error {
	return wc.saveOffset()
}

func (wc *WebLogCollector) loadOffset() int64 {
	data, err := os.ReadFile(wc.offsetFile)
	if err != nil {
		return 0
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	return n
}

func (wc *WebLogCollector) saveOffset() error {
	if err := os.MkdirAll(filepath.Dir(wc.offsetFile), 0o755); err != nil {
		return err
	}
	return os.WriteFile(wc.offsetFile, []byte(strconv.FormatInt(wc.offset, 10)), 0o644)
}
