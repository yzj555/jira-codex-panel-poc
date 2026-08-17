param(
  [int]$CdpPort = 47824,
  [string]$ProfileDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cdp-profile')
)

$ErrorActionPreference = 'Stop'

function Test-CdpEndpoint {
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/version" -TimeoutSec 1
    return $true
  } catch {
    return $false
  }
}

function Get-CodexMainProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction SilentlyContinue | Where-Object {
    (-not $_.CommandLine -or $_.CommandLine -notmatch '(?:^|\s)--type=') -and
    (-not (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).HasExited)
  })
}

if (Test-CdpEndpoint) {
  Write-Host "Codex CDP is already running on 127.0.0.1:$CdpPort."
  return
}

$runningCodex = @(Get-CodexMainProcesses)
if ($runningCodex.Count -gt 0) {
  $debugArgumentPattern = "(?:^|\s)--remote-debugging-port(?:=|\s+)$CdpPort(?:\s|$)"
  $parameterizedCodex = @($runningCodex | Where-Object { $_.CommandLine -match $debugArgumentPattern })
  if ($parameterizedCodex.Count -gt 0) {
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
      Start-Sleep -Milliseconds 400
      if (Test-CdpEndpoint) {
        Write-Host "Codex CDP is ready on 127.0.0.1:$CdpPort."
        return
      }
    }
    throw "Codex was started with remote debugging, but CDP port $CdpPort did not become ready."
  }
  throw 'Codex is already running without the Jira workbench launch parameters. Exit Codex completely, then use the Jira Workbench shortcut.'
}

$package = Get-AppxPackage -Name 'OpenAI.Codex'
if (-not $package) { throw 'Microsoft Store package OpenAI.Codex was not found.' }
New-Item -ItemType Directory -Path $ProfileDirectory -Force | Out-Null

$source = @'
using System;
using System.Runtime.InteropServices;

[Flags]
public enum ActivateOptions : uint {
    None = 0,
    NoErrorUI = 2,
    NoSplashScreen = 4
}

[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager {
    [PreserveSig]
    int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments,
        ActivateOptions options,
        out uint processId);
    IntPtr ActivateForFile(string appUserModelId, IntPtr itemArray, string verb, out uint processId);
    IntPtr ActivateForProtocol(string appUserModelId, IntPtr itemArray, out uint processId);
}

[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
class ApplicationActivationManager {}

public static class PackagedAppLauncher {
    public static uint Launch(string appUserModelId, string arguments) {
        var manager = (IApplicationActivationManager)new ApplicationActivationManager();
        uint processId;
        int hr = manager.ActivateApplication(
            appUserModelId,
            arguments,
            ActivateOptions.NoErrorUI | ActivateOptions.NoSplashScreen,
            out processId
        );
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        return processId;
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp
$appUserModelId = "$($package.PackageFamilyName)!App"
$arguments = "--remote-debugging-port=$CdpPort --user-data-dir=`"$ProfileDirectory`" --no-first-run"
$processId = [PackagedAppLauncher]::Launch($appUserModelId, $arguments)

for ($attempt = 0; $attempt -lt 25; $attempt++) {
  Start-Sleep -Milliseconds 400
  if (Test-CdpEndpoint) {
    Write-Host "Isolated Codex started. PID=$processId, CDP=127.0.0.1:$CdpPort"
    return
  }
}

throw "Codex was activated, but CDP port $CdpPort was not ready within 10 seconds."
