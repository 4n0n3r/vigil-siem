package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
	"github.com/vigil/vigil/internal/updater"
)

var updateCheckOnly bool

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update vigil to the latest release",
	Long: `Check GitHub releases for a newer version of vigil and install it.

The new binary is downloaded over HTTPS, its SHA256 checksum is verified
against the published checksums.txt, and then it atomically replaces the
current binary.

If the agent is installed as a Windows Service, stop it first:
  sc stop VIGILAgent
  vigil update
  sc start VIGILAgent`,
	RunE: func(cmd *cobra.Command, args []string) error {
		mode := output.ParseMode(globalOutput)

		if mode != output.ModeJSON {
			fmt.Printf("Current version: %s\n", Version)
			fmt.Println("Checking for updates...")
		}

		latest, err := updater.CheckLatest()
		if err != nil {
			output.PrintError("UPDATE_CHECK_FAILED", "could not check for updates", err.Error())
			return nil
		}

		// Compare versions.
		if latest.Version == Version {
			if mode == output.ModeJSON {
				output.PrintJSON(map[string]interface{}{
					"current_version": Version,
					"latest_version":  latest.Version,
					"update_available": false,
					"status":          "up_to_date",
				})
			} else {
				fmt.Printf("Already on the latest version (%s).\n", Version)
			}
			return nil
		}

		if mode == output.ModeJSON {
			result := map[string]interface{}{
				"current_version":  Version,
				"latest_version":   latest.Version,
				"update_available": true,
				"binary_url":       latest.BinaryURL,
			}
			if updateCheckOnly {
				result["status"] = "update_available"
				output.PrintJSON(result)
				return nil
			}
		} else {
			fmt.Printf("New version available: %s -> %s\n", Version, latest.Version)
			if updateCheckOnly {
				return nil
			}
		}

		// Apply the update.
		progressFn := func(msg string) {
			if mode != output.ModeJSON {
				fmt.Println(msg)
			}
		}

		if err := updater.Apply(latest, progressFn); err != nil {
			output.PrintError("UPDATE_FAILED", "update failed", err.Error())
			return nil
		}

		if mode == output.ModeJSON {
			output.PrintJSON(map[string]interface{}{
				"previous_version": Version,
				"new_version":      latest.Version,
				"status":           "updated",
			})
		} else {
			fmt.Printf("Updated to vigil %s.\n", latest.Version)
			fmt.Println("")
			if isWindowsService() {
				fmt.Println("Restart the service to use the new version:")
				fmt.Println("  sc stop VIGILAgent && sc start VIGILAgent")
			}
		}
		return nil
	},
}

func init() {
	updateCmd.Flags().BoolVar(
		&updateCheckOnly, "check", false,
		"Check for updates without installing",
	)
	rootCmd.AddCommand(updateCmd)
}
