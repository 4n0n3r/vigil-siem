#Requires -Version 5.1
<# Build vigil CLI binary for Windows. Run from the cli/ directory. #>
param(
    [string]$Version = "dev",
    [switch]$Agent
)

$BinDir = "bin"
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir | Out-Null }

$env:CGO_ENABLED = "0"

if ($Agent) {
    $output = "$BinDir\vigil-agent.exe"
    $flavor = "vigil-agent"
    $tags   = "-tags agentonly"
} else {
    $output = "$BinDir\vigil.exe"
    $flavor = "vigil"
    $tags   = ""
}

$ldflags = "-s -w -X 'github.com/vigil/vigil/cmd.Version=$Version' -X 'github.com/vigil/vigil/cmd.BinaryFlavor=$flavor'"

$cmd = "go build -trimpath $tags -ldflags=`"$ldflags`" -o $output ."
Write-Host "Running: $cmd"
Invoke-Expression $cmd

if ($LASTEXITCODE -eq 0) {
    Write-Host "Built: $output"
} else {
    Write-Error "Build failed (exit $LASTEXITCODE)"
    exit $LASTEXITCODE
}
