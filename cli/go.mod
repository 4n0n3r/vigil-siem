module github.com/vigil/vigil

go 1.22

require (
	github.com/olekukonko/tablewriter v0.0.5
	github.com/spf13/cobra v1.8.1
	golang.org/x/sys v0.28.0
	gopkg.in/yaml.v3 v3.0.1
)

// Cloud build tag dependencies — only pulled when -tags cloud is used.
require (
	cloud.google.com/go/pubsub v1.36.2
	github.com/Azure/azure-sdk-for-go/sdk/azidentity v1.6.0
	github.com/Azure/azure-sdk-for-go/sdk/storage/azblob v1.3.2
	github.com/aws/aws-sdk-go-v2 v1.27.0
	github.com/aws/aws-sdk-go-v2/config v1.27.11
	github.com/aws/aws-sdk-go-v2/service/s3 v1.53.1
)

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/mattn/go-runewidth v0.0.9 // indirect
	github.com/spf13/pflag v1.0.5 // indirect
)
