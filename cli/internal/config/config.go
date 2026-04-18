package config

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"

	"gopkg.in/yaml.v3"
)

// Config holds all persistent CLI settings.
type Config struct {
	APIURL       string `yaml:"api_url"`
	APIKey       string `yaml:"api_key"`
	EndpointID   string `yaml:"endpoint_id"`
	EndpointName string `yaml:"endpoint_name"`
}

// validKeys is the set of keys accepted by Get and Set.
var validKeys = map[string]bool{
	"api_url":       true,
	"api_key":       true,
	"endpoint_id":   true,
	"endpoint_name": true,
}

// DefaultConfigPath returns the OS-appropriate config file path.
//
//   - Windows: %APPDATA%\vigil\config.yaml
//   - Linux/macOS: ~/.config/vigil/config.yaml
func DefaultConfigPath() string {
	if runtime.GOOS == "windows" {
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(appData, "vigil", "config.yaml")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".config", "vigil", "config.yaml")
}

// Load reads the config file at path. A missing file returns an empty Config
// (not an error) so the CLI degrades gracefully on first run.
func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Config{}, nil
		}
		return Config{}, err
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Save writes cfg to path, creating parent directories as needed.
// The file is written with 0o600 permissions (contains key material).
func Save(path string, cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// Get returns the value of a config key and whether it is valid.
func (c Config) Get(key string) (string, bool) {
	if !validKeys[key] {
		return "", false
	}
	switch key {
	case "api_url":
		return c.APIURL, true
	case "api_key":
		return c.APIKey, true
	case "endpoint_id":
		return c.EndpointID, true
	case "endpoint_name":
		return c.EndpointName, true
	}
	return "", false
}

// Set returns a new Config with the given key set to value, or an error for
// unknown keys.
func (c Config) Set(key, value string) (Config, error) {
	if !validKeys[key] {
		return c, errors.New("unknown key: " + key)
	}
	switch key {
	case "api_url":
		c.APIURL = value
	case "api_key":
		c.APIKey = value
	case "endpoint_id":
		c.EndpointID = value
	case "endpoint_name":
		c.EndpointName = value
	}
	return c, nil
}

// MachineConfigPath returns the machine-wide config path (ProgramData on
// Windows). Used by the Windows Service (LocalSystem) which cannot access
// the per-user APPDATA path. Returns "" on non-Windows or if ProgramData
// is not set.
func MachineConfigPath() string {
	if runtime.GOOS != "windows" {
		return ""
	}
	pd := os.Getenv("PROGRAMDATA")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	return filepath.Join(pd, "vigil", "config.yaml")
}

// ValidKeys returns a copy of the valid key set for display purposes.
func ValidKeys() []string {
	keys := make([]string, 0, len(validKeys))
	for k := range validKeys {
		keys = append(keys, k)
	}
	return keys
}
