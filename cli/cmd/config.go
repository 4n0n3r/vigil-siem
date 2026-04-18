package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/config"
	"github.com/vigil/vigil/internal/output"
)

// configCmd — "vigil config"
var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Get or set persistent CLI configuration",
	Long: `Manage the Vigil CLI configuration file.

Valid keys: api_url, api_key, endpoint_id, endpoint_name

Examples:
  vigil config set api_url http://my-vigil:8001
  vigil config set api_key vig_abc123
  vigil config get api_url
  vigil config get --output json`,
}

// vigil config get [key]
var configGetCmd = &cobra.Command{
	Use:   "get [key]",
	Short: "Print one or all config values",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		path := config.DefaultConfigPath()
		cfg, err := config.Load(path)
		if err != nil {
			output.PrintError("CONFIG_LOAD_ERROR", "failed to load config file", err.Error())
			return nil
		}

		mode := output.ParseMode(globalOutput)

		if len(args) == 1 {
			key := args[0]
			val, ok := cfg.Get(key)
			if !ok {
				output.PrintError(
					"CONFIG_UNKNOWN_KEY",
					fmt.Sprintf("unknown config key %q", key),
					"valid keys: "+strings.Join(config.ValidKeys(), ", "),
				)
				return nil
			}
			if mode == output.ModeJSON {
				type result struct {
					Key   string `json:"key"`
					Value string `json:"value"`
				}
				output.PrintJSON(result{Key: key, Value: val})
			} else {
				fmt.Printf("%s = %s\n", key, val)
			}
			return nil
		}

		// Print all values.
		type allConfig struct {
			APIURL       string `json:"api_url"`
			APIKey       string `json:"api_key"`
			EndpointID   string `json:"endpoint_id"`
			EndpointName string `json:"endpoint_name"`
		}
		all := allConfig{
			APIURL:       cfg.APIURL,
			APIKey:       cfg.APIKey,
			EndpointID:   cfg.EndpointID,
			EndpointName: cfg.EndpointName,
		}
		if mode == output.ModeJSON {
			output.PrintJSON(all)
		} else {
			t := output.NewTable([]string{"Key", "Value"})
			t.Append([]string{"api_url", cfg.APIURL})
			t.Append([]string{"api_key", cfg.APIKey})
			t.Append([]string{"endpoint_id", cfg.EndpointID})
			t.Append([]string{"endpoint_name", cfg.EndpointName})
			t.Render()
			fmt.Printf("\nConfig file: %s\n", path)
		}
		return nil
	},
}

// vigil config set <key> <value>
var configSetCmd = &cobra.Command{
	Use:   "set <key> <value>",
	Short: "Set a config value and save to disk",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		key, value := args[0], args[1]

		path := config.DefaultConfigPath()
		cfg, err := config.Load(path)
		if err != nil {
			output.PrintError("CONFIG_LOAD_ERROR", "failed to load config file", err.Error())
			return nil
		}

		cfg, err = cfg.Set(key, value)
		if err != nil {
			output.PrintError(
				"CONFIG_UNKNOWN_KEY",
				fmt.Sprintf("unknown config key %q", key),
				"valid keys: "+strings.Join(config.ValidKeys(), ", "),
			)
			return nil
		}

		if err := config.Save(path, cfg); err != nil {
			output.PrintError("CONFIG_SAVE_ERROR", "failed to save config file", err.Error())
			return nil
		}

		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			type result struct {
				Key   string `json:"key"`
				Value string `json:"value"`
				Saved string `json:"saved"`
			}
			output.PrintJSON(result{Key: key, Value: value, Saved: path})
		} else {
			fmt.Printf("Set %s = %s\n(saved to %s)\n", key, value, path)
		}
		return nil
	},
}

func init() {
	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configSetCmd)
}
