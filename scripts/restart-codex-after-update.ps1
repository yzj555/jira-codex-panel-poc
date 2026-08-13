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
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-RestartLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date).ToString('o'), $Message)
}

function Read-UpdateState {
  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
    throw 'Update state is missing.'
  }
  return Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
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
  $next | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}

function Get-CodexMainProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction SilentlyContinue | Where-Object {
    -not $_.CommandLine -or $_.CommandLine -notmatch '(?:^|\s)--type='
  })
}

function Stop-CodexGracefully([int]$TimeoutSeconds = 20) {
  foreach ($processInfo in @(Get-CodexMainProcesses)) {
    $process = Get-Process -Id $processInfo.ProcessId -ErrorAction SilentlyContinue
    if ($process) { $null = $process.CloseMainWindow() }
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (@(Get-CodexMainProcesses).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return @(Get-CodexMainProcesses).Count -eq 0
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
  if (-not (Stop-CodexGracefully)) {
    throw 'Codex did not close normally. Save your work, close all Codex windows, and retry.'
  }

  $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', $launcherPath,
    '-Background'
  )
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
