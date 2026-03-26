# Onboarding: Windows Server

## Prerequisites

| Requirement | Notes |
|---|---|
| `vigil.exe` binary | Download from releases |
| Administrator rights | Required for service install and full channel access |
| Windows Server 2016+ | Earlier versions may have limited channel support |
| Sysmon (recommended) | Use SwiftOnSecurity config for broad coverage |

## Permissions required

| Feature | Minimum | Recommended |
|---|---|---|
| Security channel | Administrator | Administrator |
| System/Application channels | Administrator | Administrator |
| Sysmon channel | Administrator | Administrator |
| PowerShell channel | Administrator | Administrator |
| WMI/TaskScheduler/Defender | Administrator | Administrator |

## Step-by-step setup

### 1. Install Sysmon (recommended)

Download from Microsoft Sysinternals and apply the SwiftOnSecurity config:

```powershell
# Download sysmon
Invoke-WebRequest -Uri "https://download.sysinternals.com/files/Sysmon.zip" -OutFile Sysmon.zip
Expand-Archive Sysmon.zip

# Download SwiftOnSecurity config
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/SwiftOnSecurity/sysmon-config/master/sysmonconfig-export.xml" -OutFile sysmonconfig.xml

# Install
.\Sysmon64.exe -accepteula -i sysmonconfig.xml
```

### 2. Install Vigil

```powershell
# Copy binary to a permanent location
Copy-Item vigil.exe C:\Program Files\Vigil\vigil.exe

# Add to PATH (optional)
[System.Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\Vigil", "Machine")
```

### 3. Set environment

```powershell
[System.Environment]::SetEnvironmentVariable("VIGIL_API_URL", "https://your-vigil-api", "Machine")
```

Or use the config file:
```cmd
vigil config set api_url https://your-vigil-api
```

### 4. Register the endpoint

```cmd
vigil agent register --name %COMPUTERNAME% --output json
```

### 5. Verify connectivity

```cmd
vigil doctor --output json
```

### 6. Start the agent in foreground (test)

```cmd
vigil agent start --profile standard
```

Press Ctrl+C after a few seconds.

### 7. Verify events are flowing

```cmd
vigil search --query "winlog:" --limit 5 --output json
```

### 8. Install as Windows Service

```cmd
vigil agent install --output json
vigil agent status --output json
```

### 9. Configure firewall

Allow outbound HTTPS (TCP 443) from the server to your Vigil API endpoint.
If using HTTP locally: allow TCP 8001 (default) or your configured port.

## Verify collection

```cmd
vigil search --query "winlog:Security" --limit 5 --output json
vigil search --query "winlog:Microsoft-Windows-Sysmon" --limit 5 --output json
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Channel access denied | Not running as admin | Run as Administrator |
| Sysmon channel empty | Sysmon not installed | Install Sysmon first |
| Service fails to start | Binary path issue | Check `vigil agent status` |
| `CONNECTION_ERROR` | API unreachable | Check `VIGIL_API_URL`, firewall rules |
| High event volume | Full profile with busy server | Switch to `standard` profile |
