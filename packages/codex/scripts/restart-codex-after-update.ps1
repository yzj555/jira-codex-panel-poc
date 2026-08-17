[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [Parameter(Mandatory = $true)]
  [string]$UserDataRoot,
  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$UserDataRoot = [System.IO.Path]::GetFullPath($UserDataRoot).TrimEnd('\')
$StatePath = [System.IO.Path]::GetFullPath($StatePath)
$logDirectory = Join-Path $UserDataRoot 'updates\logs'
$logPath = Join-Path $logDirectory 'restart.log'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-RestartLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date).ToString('o'), $Message)
}

function Read-UpdateState {
  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
    throw 'Update state is missing.'
  }
  # Node writes the state as UTF-8 without a BOM. Windows PowerShell 5.1
  # otherwise interprets it with the active ANSI code page and may consume a
  # JSON quote as the trail byte of a Chinese character.
  return [System.IO.File]::ReadAllText($StatePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Write-UpdateState {
  param(
    [string]$Phase,
    [string]$Message,
    [string]$ErrorMessage = '',
    [int]$Progress = 98,
    [int]$RestartProcessId = $PID
  )
  $current = Read-UpdateState
  $next = [ordered]@{}
  foreach ($property in $current.PSObject.Properties) { $next[$property.Name] = $property.Value }
  $next.state = 'restart_required'
  $next.phase = $Phase
  $next.operationProgress = $Progress
  $next.message = $Message
  $next.error = $ErrorMessage
  $next.restartRequired = $true
  $next.restartProcessId = $RestartProcessId
  $next.updatedAt = (Get-Date).ToString('o')
  $temporary = "$StatePath.$PID.tmp"
  $json = $next | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($temporary, $json, $utf8NoBom)
  Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}

function Get-CodexMainProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction SilentlyContinue | Where-Object {
    -not $_.CommandLine -or $_.CommandLine -notmatch '(?:^|\s)--type='
  })
}

function Initialize-CodexWindowCloser {
  if ('JiraWorkbenchWindowCloser' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class JiraWorkbenchWindowCloser {
    private const uint WM_CLOSE = 0x0010;
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    public static int RequestClose(int[] processIds) {
        var targets = new HashSet<uint>();
        foreach (var processId in processIds ?? Array.Empty<int>()) {
            if (processId > 0) targets.Add((uint)processId);
        }
        var requested = 0;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (targets.Contains(processId) && IsWindowVisible(hWnd)) {
                if (PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero)) requested++;
            }
            return true;
        }, IntPtr.Zero);
        return requested;
    }
}
'@
}

function Wait-CodexExit([int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (@(Get-CodexMainProcesses).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return @(Get-CodexMainProcesses).Count -eq 0
}

function Stop-CodexForRestart([int]$GracefulTimeoutSeconds = 12, [int]$ForcedTimeoutSeconds = 8) {
  $processes = @(Get-CodexMainProcesses)
  if ($processes.Count -eq 0) { return $true }

  Initialize-CodexWindowCloser
  $processIds = @($processes | ForEach-Object { [int]$_.ProcessId })
  $windowCount = [JiraWorkbenchWindowCloser]::RequestClose([int[]]$processIds)
  Write-RestartLog "Requested a normal close for $windowCount visible Codex window(s)."
  foreach ($processInfo in $processes) {
    $process = Get-Process -Id $processInfo.ProcessId -ErrorAction SilentlyContinue
    if ($process) { $null = $process.CloseMainWindow() }
  }

  if (Wait-CodexExit -TimeoutSeconds $GracefulTimeoutSeconds) { return $true }

  # Electron can close its visible windows yet keep the packaged host alive in
  # the background. The user has explicitly confirmed a full restart, so only
  # after the graceful window-close deadline do we terminate the remaining
  # top-level Codex host processes. Child renderers exit with their host.
  $remaining = @(Get-CodexMainProcesses)
  $remainingIds = @($remaining | ForEach-Object { [int]$_.ProcessId })
  Write-RestartLog "Normal close timed out; stopping residual Codex host process(es): $($remainingIds -join ', ')."
  foreach ($processInfo in $remaining) {
    Stop-Process -Id ([int]$processInfo.ProcessId) -Force -ErrorAction SilentlyContinue
  }
  return Wait-CodexExit -TimeoutSeconds $ForcedTimeoutSeconds
}

try {
  $state = Read-UpdateState
  $packagePath = Join-Path $InstallRoot 'package.json'
  $launcherPath = Join-Path $InstallRoot 'scripts\launch-codex-jira.ps1'
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw 'Installed package or Codex launcher is missing.'
  }
  $installedVersion = [string](Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json).version
  if ([string]$state.state -ne 'restart_required' -or
      -not $installedVersion -or
      [string]$state.targetVersion -ne $installedVersion) {
    throw 'The pending update does not match the installed version.'
  }

  Write-UpdateState -Phase 'restarting' -Progress 99 -Message "Restarting Codex to finish applying v$installedVersion..."
  Write-RestartLog "Restart accepted for v$installedVersion."
  if (-not (Stop-CodexForRestart)) {
    throw 'Codex processes remained active after the confirmed restart request. Close Codex from Task Manager and retry.'
  }

  $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $escapedLauncherPath = $launcherPath.Replace("'", "''")
  $command = "& '$escapedLauncherPath' -Background"
  $encodedCommand = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($command))
  $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', $encodedCommand)
  $launcher = Start-Process -FilePath $powerShellPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $launcher.WaitForExit(60000)) {
    throw 'Codex launcher did not finish within 60 seconds.'
  }
  if ($launcher.ExitCode -ne 0) {
    throw "Codex launcher exited with code $($launcher.ExitCode)."
  }
  Write-RestartLog "Codex restart completed for v$installedVersion."
  exit 0
} catch {
  $message = $_.Exception.Message
  Write-RestartLog "Restart failed: $message"
  try {
    $state = Read-UpdateState
    $targetVersion = [string]$state.targetVersion
    Write-UpdateState -Phase 'restart_required' -Progress 97 -RestartProcessId 0 -Message "v$targetVersion is installed and requires a Codex restart." -ErrorMessage $message
  } catch {}
  exit 1
}
