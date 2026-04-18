//go:build !agentonly

package cmd

func init() {
	rootCmd.AddCommand(ingestCmd)
	rootCmd.AddCommand(searchCmd)
	rootCmd.AddCommand(detectionsCmd)
	rootCmd.AddCommand(alertsCmd)
	rootCmd.AddCommand(forensicCmd)
	rootCmd.AddCommand(webCmd)
	rootCmd.AddCommand(huntCmd)
	rootCmd.AddCommand(endpointsCmd)
	rootCmd.AddCommand(cloudCmd)
	rootCmd.AddCommand(connectorCmd)
	rootCmd.AddCommand(feedCmd)
	rootCmd.AddCommand(suppressionsCmd)
}
