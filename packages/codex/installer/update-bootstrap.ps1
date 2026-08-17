[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [Parameter(Mandatory = $true)]
  [string]$UserDataRoot,
  [Parameter(Mandatory = $true)]
  [string]$StatePath,
  [Parameter(Mandatory = $true)]
  [string]$HandoffPayload,
  [Parameter(Mandatory = $true)]
  [string]$OperationId,
  [int]$ServerProcessId = 0,
  [switch]$RestartCodex
)

$ErrorActionPreference = 'Stop'
$productId = 'jira-workbench'
$updateSchemaVersion = 1
$panelPort = 47823
$cdpPort = 47824
$script:mutationStarted = $false
$script:backupRoot = ''
$script:stagingRoot = ''
$script:previousVersion = ''
$script:targetVersion = ''

function Get-NormalizedPath([string]$Path) {
  if (-not $Path) { return '' }
  return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path)).TrimEnd('\')
}

function Assert-SafeRoot([string]$Path, [string]$Label) {
  $full = Get-NormalizedPath $Path
  $blocked = @(
    [System.IO.Path]::GetPathRoot($full),
    $env:USERPROFILE,
    $env:LOCALAPPDATA,
    $env:APPDATA,
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:SystemRoot
  ) | Where-Object { $_ } | ForEach-Object { (Get-NormalizedPath $_).ToLowerInvariant() }
  if (-not $full -or $full.ToLowerInvariant() -in $blocked) {
    throw "$Label is too broad for an update target: $full"
  }
  if ($full.Contains('"')) { throw "$Label cannot contain a double quote." }
  return $full
}

$InstallRoot = Assert-SafeRoot $InstallRoot 'InstallRoot'
$UserDataRoot = Assert-SafeRoot $UserDataRoot 'UserDataRoot'
$PackagePath = Get-NormalizedPath $PackagePath
$ManifestPath = Get-NormalizedPath $ManifestPath
$StatePath = Get-NormalizedPath $StatePath
if ($InstallRoot.ToLowerInvariant() -eq $UserDataRoot.ToLowerInvariant() -or
    $InstallRoot.StartsWith("$UserDataRoot\", [System.StringComparison]::OrdinalIgnoreCase) -or
    $UserDataRoot.StartsWith("$InstallRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'InstallRoot and UserDataRoot must be separate directories.'
}
$updateCacheRoot = Join-Path $UserDataRoot 'updates'
if (-not $PackagePath.StartsWith("$updateCacheRoot\", [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $ManifestPath.StartsWith("$updateCacheRoot\", [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $StatePath.StartsWith("$UserDataRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Update package, manifest, or state path is outside the managed user-data directory.'
}
$logDirectory = Join-Path $UserDataRoot 'updates\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory ("update-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Write-UpdateLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date).ToString('o'), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Read-UpdateState {
  if (-not (Test-Path -LiteralPath $StatePath)) { return [pscustomobject]@{} }
  try { return Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json } catch { return [pscustomobject]@{} }
}

function Write-UpdateState {
  param(
    [string]$State,
    [string]$Message,
    [string]$ErrorMessage = '',
    [bool]$RestartRequired = $false,
    [string]$Phase = '',
    [int]$OperationProgress = -1,
    [hashtable]$Extra = @{}
  )
  $previous = Read-UpdateState
  $next = [ordered]@{}
  foreach ($property in $previous.PSObject.Properties) { $next[$property.Name] = $property.Value }
  $next.schemaVersion = $updateSchemaVersion
  $next.state = $State
  $next.currentVersion = if ($State -in @('completed', 'restart_required')) { $script:targetVersion } else { $script:previousVersion }
  if ($script:targetVersion) { $next.targetVersion = $script:targetVersion }
  if ($script:previousVersion) { $next.previousVersion = $script:previousVersion }
  $next.message = $Message
  $next.error = $ErrorMessage
  $next.restartRequired = $RestartRequired
  $next.updatedAt = (Get-Date).ToString('o')
  $next.updaterProcessId = $PID
  $next.operationId = $OperationId
  $next.logPath = $logPath
  if ($Phase) { $next.phase = $Phase }
  if ($OperationProgress -ge 0) { $next.operationProgress = [Math]::Max(0, [Math]::Min(100, $OperationProgress)) }
  foreach ($key in $Extra.Keys) { $next[$key] = $Extra[$key] }
  $directory = Split-Path -Parent $StatePath
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temporary = "$StatePath.$PID.tmp"
  $next | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}

function Wait-ProcessExit([int]$TargetProcessId, [int]$TimeoutSeconds) {
  if ($TargetProcessId -le 0 -or $TargetProcessId -eq $PID) { return $true }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return -not [bool](Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)
}

function Get-CodexMainProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction SilentlyContinue | Where-Object {
    -not $_.CommandLine -or $_.CommandLine -notmatch '(?:^|\s)--type='
  })
}

function Stop-CodexGracefully([int]$TimeoutSeconds = 15) {
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

function Invoke-Robocopy {
  param([string]$Source, [string]$Destination, [string[]]$ExtraArguments = @())
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  & robocopy $Source $Destination /E /XJ /R:2 /W:1 /NFL /NDL /NP /NJH /NJS @ExtraArguments | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "robocopy failed with exit code $LASTEXITCODE." }
}

function Test-Health([string]$ExpectedVersion, [int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$panelPort/api/health" -TimeoutSec 2
      if ($health.ok -and [string]$health.version -eq $ExpectedVersion) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Start-InstalledRuntime([bool]$RestartDesktop) {
  $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if ($RestartDesktop) {
    $launcher = Join-Path $InstallRoot 'packages\codex\scripts\launch-codex-jira.ps1'
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -Background"
    Start-Process -FilePath $powerShellPath -ArgumentList $arguments -WindowStyle Hidden | Out-Null
  } else {
    $starter = Join-Path $InstallRoot 'packages\codex\scripts\start-poc.ps1'
    $profile = Join-Path $UserDataRoot 'codex-profile'
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$starter`" -PanelPort $panelPort -CdpPort $cdpPort -ProfileDirectory `"$profile`""
    Start-Process -FilePath $powerShellPath -ArgumentList $arguments -WindowStyle Hidden | Out-Null
  }
}

function Start-LocalServiceOnly {
  # Health verification only needs the local service; it must not depend on
  # starting or restarting the Codex desktop (which can legitimately be running).
  $projectRoot = Join-Path $InstallRoot 'packages\codex'
  $node = (Get-Command node -ErrorAction Stop).Source
  $serverScript = Join-Path $projectRoot 'server.mjs'
  $runtimeDirectory = Join-Path $projectRoot '.runtime'
  New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
  $previousPanelPort = $env:JIRA_WORKBENCH_PORT
  try {
    $env:JIRA_WORKBENCH_PORT = [string]$panelPort
    $server = Start-Process -FilePath $node -ArgumentList @($serverScript) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $runtimeDirectory 'server.stderr.log') -PassThru
  } finally {
    $env:JIRA_WORKBENCH_PORT = $previousPanelPort
  }
  Set-Content -LiteralPath (Join-Path $runtimeDirectory 'server.pid') -Value $server.Id
}

function Stop-TrackedRuntimeProcesses([string]$ApplicationRoot) {
  $runtimeDirectory = Join-Path $ApplicationRoot 'packages\codex\.runtime'
  $snapshot = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  foreach ($name in @('injector', 'server')) {
    $pidFile = Join-Path $runtimeDirectory "$name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { continue }
    $savedPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    $processInfo = if ($savedPid) { $snapshot | Where-Object { $_.ProcessId -eq [int]$savedPid } | Select-Object -First 1 } else { $null }
    $expectedScript = if ($name -eq 'server') { 'server.mjs' } else { 'injector.mjs' }
    if ($processInfo -and $processInfo.CommandLine -and
        $processInfo.CommandLine.IndexOf($ApplicationRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $processInfo.CommandLine.IndexOf($expectedScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Stop-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
      try { Wait-Process -Id ([int]$savedPid) -Timeout 5 -ErrorAction SilentlyContinue } catch {}
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
}

function Assert-ManifestAndPackage {
  foreach ($path in @($PackagePath, $ManifestPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Update file not found: $path" }
  }
  $manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
  if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.productId -ne $productId) {
    throw 'Update manifest product mismatch.'
  }
  $version = [string]$manifest.version
  if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Update manifest version is invalid.' }
  $expectedAssetName = "jira-workbench-assistant-$version-win-x64.zip"
  if ([string]$manifest.asset.name -ne $expectedAssetName) { throw 'Update package name is invalid for the manifest version.' }
  if ([string]$manifest.asset.name -ne [System.IO.Path]::GetFileName($PackagePath)) {
    throw 'Update package name does not match the manifest.'
  }
  $length = (Get-Item -LiteralPath $PackagePath).Length
  if ([int64]$manifest.asset.size -ne $length) { throw 'Update package size does not match the manifest.' }
  $actualHash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne ([string]$manifest.asset.sha256).ToLowerInvariant()) {
    throw 'Update package SHA-256 verification failed.'
  }
  return $manifest
}

function Assert-ManagedInstallation {
  $stateFile = Join-Path $InstallRoot 'install-state.json'
  if (-not (Test-Path -LiteralPath $stateFile)) { throw 'Managed install state is missing.' }
  $state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
  if ([string]$state.productId -ne $productId) { throw 'Install state product mismatch.' }
  if ((Get-NormalizedPath ([string]$state.installRoot)).ToLowerInvariant() -ne $InstallRoot.ToLowerInvariant()) {
    throw 'Install state root does not match the update target.'
  }
  $script:previousVersion = [string]$state.version
  return $state
}

function Invoke-InstalledStatus {
  $lifecycle = Join-Path $InstallRoot 'packages\codex\installer\lifecycle.ps1'
  $json = @(& $lifecycle -Action Status -InstallRoot $InstallRoot 2>&1) -join "`n"
  try { return $json | ConvertFrom-Json } catch { throw "Installed status was not valid JSON: $json" }
}

try {
  Write-UpdateLog "Updater started. InstallRoot: $InstallRoot"
  $installedState = Assert-ManagedInstallation
  try {
    $pendingJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($HandoffPayload))
    $pendingState = $pendingJson | ConvertFrom-Json
  } catch {
    throw 'Update handoff state is invalid.'
  }
  if ([string]$pendingState.operationId -ne $OperationId -or [string]$pendingState.state -ne 'installing') {
    throw 'Update operation id no longer matches the pending installation.'
  }
  $pendingState | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatePath -Encoding UTF8
  $manifestPreview = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
  $script:targetVersion = [string]$manifestPreview.version
  Write-UpdateState -State 'installing' -Message "Updater accepted the installation; validating v$script:targetVersion..." -RestartRequired $true -Phase 'waiting_for_service' -OperationProgress 30
  $manifest = Assert-ManifestAndPackage
  $script:targetVersion = [string]$manifest.version

  if (-not (Wait-ProcessExit -TargetProcessId $ServerProcessId -TimeoutSeconds 30)) {
    throw 'The local service did not exit within 30 seconds; no files were replaced.'
  }

  Write-UpdateState -State 'installing' -Message "Validating and extracting v$script:targetVersion..." -RestartRequired $true -Phase 'extracting' -OperationProgress 36
  $stagingParent = Join-Path $UserDataRoot 'updates\staging'
  $backupParent = Join-Path $UserDataRoot 'updates\backups'
  New-Item -ItemType Directory -Path $stagingParent -Force | Out-Null
  New-Item -ItemType Directory -Path $backupParent -Force | Out-Null
  $operationId = "{0}-{1}" -f $script:targetVersion, ([Guid]::NewGuid().ToString('N'))
  $script:stagingRoot = Join-Path $stagingParent $operationId
  $script:backupRoot = Join-Path $backupParent $operationId
  New-Item -ItemType Directory -Path $script:stagingRoot -Force | Out-Null
  Expand-Archive -LiteralPath $PackagePath -DestinationPath $script:stagingRoot -Force
  $stagedPackage = Join-Path $script:stagingRoot 'package.json'
  $stagedLifecycle = Join-Path $script:stagingRoot 'packages\codex\installer\lifecycle.ps1'
  if (-not (Test-Path -LiteralPath $stagedPackage) -or -not (Test-Path -LiteralPath $stagedLifecycle)) {
    throw 'The update package is missing package.json or the lifecycle entry point.'
  }
  $stagedVersion = [string](Get-Content -Raw -LiteralPath $stagedPackage | ConvertFrom-Json).version
  if ($stagedVersion -ne $script:targetVersion) { throw 'The staged package version does not match the manifest.' }

  Write-UpdateLog "Backing up v$script:previousVersion to $script:backupRoot"
  Write-UpdateState -State 'installing' -Message "Backing up the current v$script:previousVersion installation..." -RestartRequired $true -Phase 'backing_up' -OperationProgress 45 -Extra @{ backupPath = $script:backupRoot }
  Invoke-Robocopy -Source $InstallRoot -Destination $script:backupRoot -ExtraArguments @('/XD', (Join-Path $InstallRoot 'node_modules'), (Join-Path $InstallRoot 'packages\codex\.runtime'))
  $script:mutationStarted = $true
  Write-UpdateState -State 'installing' -Message "Backup complete; installing v$script:targetVersion..." -RestartRequired $true -Phase 'installing' -OperationProgress 65 -Extra @{ backupPath = $script:backupRoot }

  & $stagedLifecycle -Action Update -InstallRoot $InstallRoot -LaunchAfterInstall:$false -InstallCodexCli:$false

  $codexRestarted = $false
  if ($RestartCodex) {
    Write-UpdateState -State 'installing' -Message "v$script:targetVersion is installed; restarting Codex safely..." -RestartRequired $true -Phase 'restarting' -OperationProgress 86
    if (Stop-CodexGracefully) {
      Start-InstalledRuntime -RestartDesktop $true
      $codexRestarted = $true
    } else {
      Write-UpdateLog 'Codex did not exit before the timeout; it will not be force-terminated.'
      Start-LocalServiceOnly
    }
  } else {
    Start-LocalServiceOnly
  }

  Write-UpdateState -State 'installing' -Message "Verifying the v$script:targetVersion service and installation..." -RestartRequired $true -Phase 'verifying' -OperationProgress 93 -Extra @{ backupPath = $script:backupRoot }
  if (-not (Test-Health -ExpectedVersion $script:targetVersion -TimeoutSeconds 30)) {
    throw "Health check failed for v$script:targetVersion."
  }
  $lifecycleStatus = Invoke-InstalledStatus
  if (-not $lifecycleStatus.healthy) {
    throw "Installed integrity check failed: $(@($lifecycleStatus.missingRequiredComponents) -join ', ')"
  }

  if (-not $RestartCodex -or -not $codexRestarted) {
    Write-UpdateState -State 'restart_required' -Message "v$script:targetVersion is installed and verified. Save your work and restart Codex manually." -RestartRequired $true -Phase 'restart_required' -OperationProgress 97 -Extra @{ backupPath = $script:backupRoot }
  } else {
    Write-UpdateState -State 'completed' -Message "Jira Workbench was updated successfully to v$script:targetVersion." -RestartRequired $false -Phase 'completed' -OperationProgress 100 -Extra @{ backupPath = $script:backupRoot }
  }
  Write-UpdateLog "Update completed: v$script:previousVersion -> v$script:targetVersion"
} catch {
  $message = $_.Exception.Message
  Write-UpdateLog "Update failed: $message"
  if ($script:mutationStarted -and $script:backupRoot -and (Test-Path -LiteralPath $script:backupRoot)) {
    try {
      Write-UpdateState -State 'installing' -Message 'New version validation failed; rolling back...' -ErrorMessage $message -Phase 'rolling_back' -OperationProgress 72
      Stop-TrackedRuntimeProcesses -ApplicationRoot $InstallRoot
      Invoke-Robocopy -Source $script:backupRoot -Destination $InstallRoot -ExtraArguments @('/PURGE')
      $repair = Join-Path $InstallRoot 'packages\codex\installer\lifecycle.ps1'
      & $repair -Action Repair -InstallRoot $InstallRoot -LaunchAfterInstall:$false -InstallCodexCli:$false
      Start-LocalServiceOnly
      $rollbackHealthy = Test-Health -ExpectedVersion $script:previousVersion -TimeoutSeconds 30
      Write-UpdateState -State 'rolled_back' -Message "Update failed and was rolled back to v$script:previousVersion." -ErrorMessage $message -RestartRequired $RestartCodex.IsPresent -Phase 'failed' -OperationProgress 100 -Extra @{ backupPath = $script:backupRoot; rollbackHealthy = $rollbackHealthy }
      Write-UpdateLog "Rollback completed. Healthy: $rollbackHealthy"
    } catch {
      $rollbackError = $_.Exception.Message
      Write-UpdateLog "Automatic rollback failed: $rollbackError"
      Write-UpdateState -State 'failed' -Message 'Update and automatic rollback failed. Run Repair from the maintenance assistant.' -ErrorMessage "$message; rollback error: $rollbackError" -RestartRequired $true -Phase 'failed' -OperationProgress 100 -Extra @{ backupPath = $script:backupRoot }
    }
  } else {
    try { Start-LocalServiceOnly } catch { Write-UpdateLog "Unable to restart the existing local service after the failed update: $($_.Exception.Message)" }
    Write-UpdateState -State 'failed' -Message 'No files were replaced; the existing installation is unchanged.' -ErrorMessage $message -RestartRequired $false -Phase 'failed' -OperationProgress 100
  }
  exit 1
} finally {
  if ($script:stagingRoot -and (Test-Path -LiteralPath $script:stagingRoot)) {
    Remove-Item -LiteralPath $script:stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

exit 0
