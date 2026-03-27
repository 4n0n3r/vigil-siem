//go:build !agentonly

package cmd

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

//go:embed web
var webAssets embed.FS

var webPort int

// ----------------------------------------------------------------------------
// vigil web
// ----------------------------------------------------------------------------

var webCmd = &cobra.Command{
	Use:   "web",
	Short: "Vigil web interface",
	Long: `Manage the embedded Vigil web interface.

Subcommands:
  start   Start the web UI server (embeds all assets — no build step needed)`,
}

// ----------------------------------------------------------------------------
// vigil web start
// ----------------------------------------------------------------------------

var webStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the embedded Vigil web interface",
	Long: `Start the Vigil web UI.

All assets are embedded in the binary — no Node.js or build step required.
/api/* requests are reverse-proxied to VIGIL_API_URL (default: http://localhost:8001).
All other paths serve the SPA; unknown paths fall back to index.html.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		// Resolve API URL (flag > env > default).
		apiURL := globalAPIURL
		if apiURL == "" {
			apiURL = os.Getenv("VIGIL_API_URL")
		}
		if apiURL == "" {
			apiURL = "http://localhost:8001"
		}

		// Sub-filesystem rooted at "web/" inside the embedded FS.
		sub, err := fs.Sub(webAssets, "web")
		if err != nil {
			output.PrintError("WEB_EMBED_ERROR", "failed to access embedded web assets", err.Error())
			return nil
		}

		// Parse API target URL.
		target, err := url.Parse(apiURL)
		if err != nil {
			output.PrintError("INVALID_API_URL", "invalid API URL", err.Error())
			return nil
		}

		mux := http.NewServeMux()

		// /api/* → reverse-proxy to VIGIL_API_URL (strip /api prefix).
		proxy := httputil.NewSingleHostReverseProxy(target)
		mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
			r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api")
			if r.URL.Path == "" {
				r.URL.Path = "/"
			}
			r.Host = target.Host
			proxy.ServeHTTP(w, r)
		})

		// All other paths → SPA; fall back to index.html for hash-routed paths.
		fileServer := http.FileServer(http.FS(sub))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			path := strings.TrimPrefix(r.URL.Path, "/")
			if path == "" {
				path = "index.html"
			}
			// Serve real file if it exists; otherwise fall back to index.html.
			if _, err := sub.Open(path); err != nil {
				r.URL.Path = "/"
			}
			fileServer.ServeHTTP(w, r)
		})

		addr := fmt.Sprintf(":%d", webPort)
		webURL := fmt.Sprintf("http://localhost%s", addr)

		// Listen first so we can detect port conflicts before printing the
		// "running" message.
		listener, listenErr := net.Listen("tcp", addr)
		if listenErr != nil {
			if isPortInUse(listenErr) {
				output.PrintErrorWithHint(
					"PORT_IN_USE",
					fmt.Sprintf("port %d is already in use", webPort),
					listenErr.Error(),
					fmt.Sprintf("try: vigil web start --port %d", webPort+1),
				)
				return nil
			}
			output.PrintError("WEB_START_ERROR", "failed to start web server", listenErr.Error())
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			type startMsg struct {
				Status   string `json:"status"`
				URL      string `json:"url"`
				APIProxy string `json:"api_proxy"`
			}
			output.PrintJSON(startMsg{Status: "running", URL: webURL, APIProxy: apiURL})
		} else {
			fmt.Printf("Vigil web UI: %s\n", webURL)
			fmt.Printf("API proxy  : %s\n", apiURL)
			fmt.Println("Press Ctrl+C to stop.")
		}

		return http.Serve(listener, mux)
	},
}

// isPortInUse returns true when the error is an "address already in use" error
// (covers both POSIX EADDRINUSE and Windows WSAEADDRINUSE).
func isPortInUse(err error) bool {
	return strings.Contains(err.Error(), "address already in use") ||
		strings.Contains(err.Error(), "Only one usage of each socket address")
}

func init() {
	webStartCmd.Flags().IntVar(&webPort, "port", 3000, "HTTP port to listen on")
	webCmd.AddCommand(webStartCmd)
}
