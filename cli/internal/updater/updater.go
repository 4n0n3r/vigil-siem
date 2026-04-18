// Package updater handles self-update for the vigil binary.
//
// Flow:
//  1. CheckLatest()  — hit GitHub Releases API, return latest release info
//  2. Apply()        — download binary, verify SHA256, atomically replace current exe
//
// Security:
//   - All downloads are over HTTPS.
//   - SHA256 checksum from a separate checksums.txt asset is verified before
//     the new binary replaces the old one.
//   - The temp file is written next to the current binary (same filesystem)
//     so the final os.Rename is atomic on POSIX; on Windows the old binary
//     is moved to .old first (Windows locks running executables).
package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	githubRepo = "4n0n3r/vigil-siem"
	apiBaseURL = "https://api.github.com/repos/" + githubRepo
)

// httpClient with a reasonable timeout so the update check never hangs.
var httpClient = &http.Client{Timeout: 30 * time.Second}

// Release holds the data we need from a GitHub release.
type Release struct {
	Version     string // semver without leading "v", e.g. "1.2.3"
	BinaryURL   string // direct download URL for the platform binary
	ChecksumURL string // direct download URL for checksums.txt
	BinaryName  string // asset filename, e.g. "vigil_1.2.3_linux_amd64"
}

// CheckLatest queries the GitHub Releases API and returns the latest release.
// Returns an error if the network is unreachable or no asset matches the
// current OS/arch.
func CheckLatest() (*Release, error) {
	resp, err := get(apiBaseURL + "/releases/latest")
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("no releases published yet for %s", githubRepo)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned HTTP %d", resp.StatusCode)
	}

	var body struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("could not parse release info: %w", err)
	}

	version := strings.TrimPrefix(body.TagName, "v")
	binaryName := PlatformBinaryName(version)

	var binaryURL, checksumURL string
	for _, a := range body.Assets {
		switch a.Name {
		case binaryName:
			binaryURL = a.BrowserDownloadURL
		case "checksums.txt":
			checksumURL = a.BrowserDownloadURL
		}
	}

	if binaryURL == "" {
		return nil, fmt.Errorf(
			"no binary for %s/%s in release %s — check %s/releases",
			runtime.GOOS, runtime.GOARCH, body.TagName, githubRepo,
		)
	}

	return &Release{
		Version:     version,
		BinaryURL:   binaryURL,
		ChecksumURL: checksumURL,
		BinaryName:  binaryName,
	}, nil
}

// Apply downloads, verifies, and atomically installs the new binary.
// The caller is responsible for restarting any running service after this returns.
func Apply(release *Release, progressFn func(msg string)) error {
	if progressFn == nil {
		progressFn = func(string) {}
	}

	exePath, err := resolveExecutable()
	if err != nil {
		return err
	}

	// Write the new binary next to the current one (same volume = atomic rename).
	tmpPath := exePath + ".update"

	progressFn(fmt.Sprintf("Downloading vigil %s...", release.Version))
	if err := downloadFile(release.BinaryURL, tmpPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("download failed: %w", err)
	}

	if release.ChecksumURL != "" {
		progressFn("Verifying checksum...")
		if err := verifyChecksum(tmpPath, release.BinaryName, release.ChecksumURL); err != nil {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("checksum verification failed: %w", err)
		}
	}

	if err := os.Chmod(tmpPath, 0o755); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("could not set permissions: %w", err)
	}

	progressFn("Installing...")

	// Windows keeps a lock on running executables. Rename the old binary
	// out of the way first, then move the new one in.
	if runtime.GOOS == "windows" {
		backupPath := exePath + ".old"
		_ = os.Remove(backupPath)
		if err := os.Rename(exePath, backupPath); err != nil {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("could not back up current binary: %w", err)
		}
		if err := os.Rename(tmpPath, exePath); err != nil {
			// Attempt rollback.
			_ = os.Rename(backupPath, exePath)
			_ = os.Remove(tmpPath)
			return fmt.Errorf("could not install new binary: %w", err)
		}
		_ = os.Remove(backupPath)
		return nil
	}

	// POSIX: rename is atomic.
	if err := os.Rename(tmpPath, exePath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("could not install new binary: %w", err)
	}
	return nil
}

// PlatformBinaryName returns the expected GitHub release asset name for the
// current OS/arch combination.
func PlatformBinaryName(version string) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf("vigil_%s_%s_%s.exe", version, runtime.GOOS, runtime.GOARCH)
	}
	return fmt.Sprintf("vigil_%s_%s_%s", version, runtime.GOOS, runtime.GOARCH)
}

// resolveExecutable returns the real path of the running binary, following symlinks.
func resolveExecutable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("could not determine executable path: %w", err)
	}
	real, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return "", fmt.Errorf("could not resolve symlinks for %s: %w", exe, err)
	}
	return real, nil
}

// downloadFile streams url into destPath.
func downloadFile(url, destPath string) error {
	resp, err := get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("could not create temp file: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		return fmt.Errorf("write error: %w", err)
	}
	return nil
}

// verifyChecksum downloads checksumURL, finds the line for binaryName,
// and confirms that binaryPath has the expected SHA256 hash.
func verifyChecksum(binaryPath, binaryName, checksumURL string) error {
	resp, err := get(checksumURL)
	if err != nil {
		return fmt.Errorf("could not download checksums: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	expected := ""
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == binaryName {
			expected = strings.ToLower(fields[0])
			break
		}
	}
	if expected == "" {
		return fmt.Errorf("no checksum entry found for %s", binaryName)
	}

	f, err := os.Open(binaryPath)
	if err != nil {
		return err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	actual := hex.EncodeToString(h.Sum(nil))

	if actual != expected {
		return fmt.Errorf("checksum mismatch\n  expected: %s\n  got:      %s", expected, actual)
	}
	return nil
}

// get issues an HTTPS GET with appropriate headers.
func get(url string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "vigil-updater")
	req.Header.Set("Accept", "application/json")
	return httpClient.Do(req)
}
