package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vigil/vigil/internal/output"
)

// Version is set at build time via ldflags:
//
//	-ldflags "-X 'github.com/vigil/vigil/cmd.Version=1.2.3'"
//
// Falls back to "dev" for local builds.
var Version = "dev"

// BinaryFlavor identifies which binary this is ("vigil" or "vigil-agent").
// Set at build time: -ldflags "-X 'github.com/vigil/vigil/cmd.BinaryFlavor=vigil-agent'"
var BinaryFlavor = "vigil"

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the vigil version",
	Run: func(cmd *cobra.Command, args []string) {
		mode := output.ParseMode(globalOutput)
		if mode == output.ModeJSON {
			type versionInfo struct {
				Version string `json:"version"`
			}
			output.PrintJSON(versionInfo{Version: Version})
			return
		}
		fmt.Printf("vigil %s\n", Version)
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}
