param(
  [int]$PanelPort = 47823,
  [int]$CdpPort = 47824,
  [string]$ProfileDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cdp-profile')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

& (Join-Path $PSScriptRoot 'start-codex-cdp.ps1') -CdpPort $CdpPort -ProfileDirectory $ProfileDirectory

function Test-RecordedProcess([string]$PidFile, [string]$ExpectedFragment) {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $false }
  $savedPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $savedPid) { return $false }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
  return $null -ne $process -and $process.CommandLine -like "*$ExpectedFragment*"
}

$node = (Get-Command node -ErrorAction Stop).Source
$serverScript = Join-Path $projectRoot 'server.mjs'
$injectorScript = Join-Path $projectRoot 'injector.mjs'
$serverPidFile = Join-Path $runtimeDirectory 'server.pid'
$injectorPidFile = Join-Path $runtimeDirectory 'injector.pid'
$expectedVersion = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version

$serverReady = $false
$health = $null
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$PanelPort/api/health" -TimeoutSec 1
} catch {}
if ($health -and $health.ok -and $health.name -eq 'jira-workbench' -and $health.version -ne $expectedVersion) {
  throw "Panel port $PanelPort is occupied by Jira panel version $($health.version); expected $expectedVersion. Stop the older panel process and retry."
}
$serverReady = [bool]$health.ok -and $health.name -eq 'jira-workbench' -and $health.version -eq $expectedVersion

if (-not $serverReady) {
  $serverOut = Join-Path $runtimeDirectory 'server.stdout.log'
  $serverErr = Join-Path $runtimeDirectory 'server.stderr.log'
  $previousPanelPort = $env:JIRA_WORKBENCH_PORT
  try {
    $env:JIRA_WORKBENCH_PORT = [string]$PanelPort
    $server = Start-Process -FilePath $node -ArgumentList @($serverScript) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru
  } finally {
    $env:JIRA_WORKBENCH_PORT = $previousPanelPort
  }
  Set-Content -LiteralPath $serverPidFile -Value $server.Id
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 200
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$PanelPort/api/health" -TimeoutSec 1
      if ($health.ok -and $health.version -eq $expectedVersion) { $serverReady = $true; break }
    } catch {}
  }
  if (-not $serverReady) { throw "Panel server failed to start. See $serverErr" }
}

if (-not (Test-RecordedProcess $injectorPidFile 'injector.mjs')) {
  $injectorOut = Join-Path $runtimeDirectory 'injector.stdout.log'
  $injectorErr = Join-Path $runtimeDirectory 'injector.stderr.log'
  $environment = @{
    CODEX_CDP_PORT = [string]$CdpPort
    JIRA_WORKBENCH_PANEL_URL = "http://127.0.0.1:$PanelPort/"
  }
  $previousCdpPort = $env:CODEX_CDP_PORT
  $previousPanelUrl = $env:JIRA_WORKBENCH_PANEL_URL
  try {
    $env:CODEX_CDP_PORT = $environment.CODEX_CDP_PORT
    $env:JIRA_WORKBENCH_PANEL_URL = $environment.JIRA_WORKBENCH_PANEL_URL
    $injector = Start-Process -FilePath $node -ArgumentList @($injectorScript, '--watch') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $injectorOut -RedirectStandardError $injectorErr -PassThru
  } finally {
    $env:CODEX_CDP_PORT = $previousCdpPort
    $env:JIRA_WORKBENCH_PANEL_URL = $previousPanelUrl
  }
  Set-Content -LiteralPath $injectorPidFile -Value $injector.Id
}

Start-Sleep -Milliseconds 700
Write-Host "Jira panel POC started:"
Write-Host "  Panel: http://127.0.0.1:$PanelPort/"
Write-Host "  CDP:   http://127.0.0.1:$CdpPort/json/version"
Write-Host "  Logs:  $runtimeDirectory"
