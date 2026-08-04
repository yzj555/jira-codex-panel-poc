$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot '.runtime'

foreach ($name in @('server', 'injector')) {
  $pidFile = Join-Path $runtimeDirectory "$name.pid"
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $savedPid = Get-Content -LiteralPath $pidFile | Select-Object -First 1
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
  $expectedScript = if ($name -eq 'server') { 'server.mjs' } else { 'injector.mjs' }
  if ($process -and $process.CommandLine -like "*$expectedScript*") {
    Stop-Process -Id $savedPid
    Write-Host "Stopped $name, PID=$savedPid"
  }
  Remove-Item -LiteralPath $pidFile -Force
}

Write-Host 'The isolated Codex instance was left open; close its window when finished.'
