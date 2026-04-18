# Vigil agent install script for Windows
#
# Usage (one-liner, run as administrator):
#   irm https://raw.githubusercontent.com/4n0n3r/vigil-siem/main/scripts/install.ps1 | iex
#
# Usage with parameters:
#   & ([scriptblock]::Create((irm .../install.ps1))) -ApiUrl http://your-server:8001
#
# Parameters:
#   -InstallDir    Where to place vigil.exe (default: C:\Program Files\Vigil)
#   -ApiUrl        Vigil API URL to configure after install
#   -EnrollToken   Enrollment token (required when server has VIGIL_REQUIRE_AUTH=true)
#   -Version       Pin a specific version (default: latest)

param(
    [string]$InstallDir  = "$env:ProgramFiles\Vigil",
    [string]$ApiUrl      = "",
    [string]$EnrollToken = $env:VIGIL_ENROLL_TOKEN,
    [string]$Version     = ""
)

$ErrorActionPreference = "Stop"
$Repo = "4n0n3r/vigil-siem"

$Headers = @{
    "User-Agent" = "vigil-installer"
    "Accept"     = "application/json"
}

# Resolve version
if (-not $Version) {
    Write-Host "Fetching latest release..."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $Headers
    $Version = $release.tag_name -replace '^v', ''
} else {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/v$Version" -Headers $Headers
}

$binaryName  = "vigil-agent_${Version}_windows_amd64.exe"

Write-Host "Installing vigil-agent v$Version..."

$binaryUrl   = ($release.assets | Where-Object { $_.name -eq $binaryName }).browser_download_url
$checksumUrl = ($release.assets | Where-Object { $_.name -eq "checksums.txt" }).browser_download_url

if (-not $binaryUrl) {
    Write-Error "Binary '$binaryName' not found in release assets. Check https://github.com/$Repo/releases"
    exit 1
}

$tmpBin      = Join-Path $env:TEMP "vigil-agent_update.exe"
$tmpChecksums = Join-Path $env:TEMP "vigil-agent_checksums.txt"

# Clean up temp files when done
try {
    # Download binary and checksum file
    Invoke-WebRequest -Uri $binaryUrl   -OutFile $tmpBin       -UseBasicParsing
    Invoke-WebRequest -Uri $checksumUrl -OutFile $tmpChecksums -UseBasicParsing

    # Verify SHA256 checksum
    $checksumLine = Get-Content $tmpChecksums | Where-Object { $_ -match "  $binaryName$" }
    if (-not $checksumLine) {
        Write-Error "Checksum not found for '$binaryName' in checksums.txt"
        exit 1
    }

    $expected = ($checksumLine -split '\s+')[0].ToLower()
    $actual   = (Get-FileHash $tmpBin -Algorithm SHA256).Hash.ToLower()

    if ($expected -ne $actual) {
        Write-Error "Checksum mismatch — download may be corrupted.`n  expected: $expected`n  got:      $actual"
        exit 1
    }

    # Install binary
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item $tmpBin "$InstallDir\vigil-agent.exe" -Force

    # Add to system PATH if not already present
    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    if ($machinePath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("PATH", "$machinePath;$InstallDir", "Machine")
        Write-Host "Added $InstallDir to system PATH"
    }

    Write-Host ""
    Write-Host "vigil-agent v$Version installed to $InstallDir\vigil-agent.exe"
    Write-Host ""
    Write-Host "Next steps (run as administrator):"

    if ($ApiUrl) {
        Write-Host "  vigil-agent config set api_url $ApiUrl"
    } else {
        Write-Host "  vigil-agent config set api_url http://your-vigil-server:8001"
    }

    if ($EnrollToken) {
        Write-Host "  vigil-agent agent register --name $env:COMPUTERNAME --enroll-token $EnrollToken"
    } else {
        Write-Host "  vigil-agent agent register --name $env:COMPUTERNAME"
        Write-Host "  # (If the server requires auth, add: --enroll-token <token>)"
    }
    Write-Host "  vigil-agent agent install"
    Write-Host "  sc start VIGILAgent"

} finally {
    Remove-Item $tmpBin       -ErrorAction SilentlyContinue
    Remove-Item $tmpChecksums -ErrorAction SilentlyContinue
}
