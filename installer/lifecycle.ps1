[CmdletBinding()]
param(
  [ValidateSet('Auto', 'Install', 'Update', 'Repair', 'Uninstall', 'Purge', 'Status', 'Menu')]
  [string]$Action = 'Auto',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\JiraCodexPanel'),
  [bool]$StartAtLogon = $false,
  [bool]$DesktopShortcut = $true,
  [bool]$LaunchAfterInstall = $true,
  [bool]$InstallCodexCli = $true,
  [string]$UninstallRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JiraCodexAssistant',
  [string]$StartMenuDirectory = '',
  [string]$DesktopDirectory = '',
  [string]$StartupDirectory = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $InstallRoot 'install-state.json'
$legacyStatePath = Join-Path $InstallRoot 'install-metadata.json'
$startAtLogonSpecified = $PSBoundParameters.ContainsKey('StartAtLogon')
$desktopShortcutSpecified = $PSBoundParameters.ContainsKey('DesktopShortcut')
$installCodexCliSpecified = $PSBoundParameters.ContainsKey('InstallCodexCli')
$startMenuDirectorySpecified = $PSBoundParameters.ContainsKey('StartMenuDirectory')
$desktopDirectorySpecified = $PSBoundParameters.ContainsKey('DesktopDirectory')
$startupDirectorySpecified = $PSBoundParameters.ContainsKey('StartupDirectory')

function Read-InstallState {
  foreach ($candidate in @($statePath, $legacyStatePath)) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try { return Get-Content -Raw -LiteralPath $candidate | ConvertFrom-Json } catch {}
  }
  return $null
}

function Get-LifecycleStatus {
  $installedState = Read-InstallState
  if (-not $installedState) {
    return [ordered]@{
      installed = $false
      healthy = $false
      installRoot = $InstallRoot
      missingRequiredComponents = @()
    }
  }

  $status = [ordered]@{}
  foreach ($property in $installedState.PSObject.Properties) {
    $status[$property.Name] = $property.Value
  }

  $manifestAvailable = $false
  $componentDefinitions = @($installedState.components)
  $installedManifestPath = Join-Path $InstallRoot 'installer\product-manifest.json'
  if (Test-Path -LiteralPath $installedManifestPath) {
    try {
      $installedManifest = Get-Content -Raw -LiteralPath $installedManifestPath | ConvertFrom-Json
      $componentDefinitions = @($installedManifest.components)
      $manifestAvailable = $true
    } catch {}
  }

  $liveComponents = @($componentDefinitions | ForEach-Object {
    $relativePath = [string]$_.path
    [ordered]@{
      id = [string]$_.id
      required = [bool]$_.required
      installed = [bool]($relativePath -and (Test-Path -LiteralPath (Join-Path $InstallRoot $relativePath)))
      path = $relativePath
    }
  })
  $missingRequired = @($liveComponents | Where-Object { $_.required -and -not $_.installed } | ForEach-Object { $_.id })
  $missingShortcuts = @(@($installedState.shortcuts) | Where-Object {
    $_ -and -not (Test-Path -LiteralPath ([string]$_))
  } | ForEach-Object { [string]$_ })
  $registeredPath = if ($installedState.uninstallRegistryPath) {
    [string]$installedState.uninstallRegistryPath
  } else {
    $UninstallRegistryPath
  }
  $registryPresent = [bool]($registeredPath -and (Test-Path -LiteralPath $registeredPath))

  $status['installed'] = $true
  $status['healthy'] = $manifestAvailable -and $missingRequired.Count -eq 0 `
    -and $missingShortcuts.Count -eq 0 -and $registryPresent
  $status['manifestAvailable'] = $manifestAvailable
  $status['components'] = $liveComponents
  $status['missingRequiredComponents'] = $missingRequired
  $status['missingShortcuts'] = $missingShortcuts
  $status['registryPresent'] = $registryPresent
  return $status
}

function Invoke-ProductInstall {
  param([string]$Operation)

  $installScript = Join-Path $PSScriptRoot 'install.ps1'
  if (-not (Test-Path -LiteralPath $installScript)) {
    throw "安装入口缺失：$installScript"
  }
  & $installScript `
    -InstallRoot $InstallRoot `
    -Operation $Operation `
    -StartAtLogon:$StartAtLogon `
    -DesktopShortcut:$DesktopShortcut `
    -LaunchAfterInstall:$LaunchAfterInstall `
    -InstallCodexCli:$InstallCodexCli `
    -UninstallRegistryPath $UninstallRegistryPath `
    -StartMenuDirectory $StartMenuDirectory `
    -DesktopDirectory $DesktopDirectory `
    -StartupDirectory $StartupDirectory
}

function Invoke-ProductUninstall {
  param([bool]$Purge)

  $uninstallScript = Join-Path $InstallRoot 'installer\uninstall.ps1'
  if (-not (Test-Path -LiteralPath $uninstallScript)) {
    $uninstallScript = Join-Path $PSScriptRoot 'uninstall.ps1'
  }
  if (-not (Test-Path -LiteralPath $uninstallScript)) {
    throw "卸载入口缺失：$uninstallScript"
  }
  & $uninstallScript -InstallRoot $InstallRoot -UninstallRegistryPath $UninstallRegistryPath -PurgeUserData:$Purge -Force:$Force
}

function Show-LifecycleMenu {
  $state = Read-InstallState
  if (-not $state) {
    Invoke-ProductInstall -Operation 'Install'
    return
  }

  Write-Host ''
  Write-Host "Jira Codex 助手 $($state.version)"
  Write-Host '1. 修复当前安装'
  Write-Host '2. 普通卸载（保留个人数据）'
  Write-Host '3. 完全清除（删除个人数据）'
  Write-Host '4. 查看安装状态'
  Write-Host '0. 退出'
  $selection = Read-Host '请选择操作'
  switch ($selection) {
    '1' {
      $script:StartAtLogon = [bool]$state.startAtLogon
      $script:DesktopShortcut = $null -eq $state.desktopShortcut -or [bool]$state.desktopShortcut
      $script:LaunchAfterInstall = $false
      $script:InstallCodexCli = $null -eq $state.codexAppServerInstallAttempted -or [bool]$state.codexAppServerInstallAttempted
      $script:StartMenuDirectory = [string]$state.startMenuDirectory
      $script:DesktopDirectory = [string]$state.desktopDirectory
      $script:StartupDirectory = [string]$state.startupDirectory
      Invoke-ProductInstall -Operation 'Repair'
    }
    '2' { Invoke-ProductUninstall -Purge $false }
    '3' { Invoke-ProductUninstall -Purge $true }
    '4' { Get-LifecycleStatus | ConvertTo-Json -Depth 8 }
    default { return }
  }
}

$state = Read-InstallState
if ($Action -eq 'Auto') {
  $sourceIsInstalledCopy = $false
  try {
    $sourceIsInstalledCopy = [System.IO.Path]::GetFullPath($sourceRoot).TrimEnd('\') -eq `
      [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
  } catch {}
  if ($state -and $sourceIsInstalledCopy) { $Action = 'Menu' }
  elseif ($state) { $Action = 'Update' }
  else { $Action = 'Install' }
}

switch ($Action) {
  'Install' { Invoke-ProductInstall -Operation 'Install' }
  'Update' {
    if ($state) {
      if (-not $startAtLogonSpecified) { $StartAtLogon = [bool]$state.startAtLogon }
      if (-not $desktopShortcutSpecified) {
        $DesktopShortcut = $null -eq $state.desktopShortcut -or [bool]$state.desktopShortcut
      }
      if (-not $installCodexCliSpecified) {
        $InstallCodexCli = $null -eq $state.codexAppServerInstallAttempted -or [bool]$state.codexAppServerInstallAttempted
      }
      if (-not $startMenuDirectorySpecified) { $StartMenuDirectory = [string]$state.startMenuDirectory }
      if (-not $desktopDirectorySpecified) { $DesktopDirectory = [string]$state.desktopDirectory }
      if (-not $startupDirectorySpecified) { $StartupDirectory = [string]$state.startupDirectory }
    }
    Invoke-ProductInstall -Operation 'Update'
  }
  'Repair' {
    if ($state) {
      $StartAtLogon = [bool]$state.startAtLogon
      $DesktopShortcut = $null -eq $state.desktopShortcut -or [bool]$state.desktopShortcut
      $InstallCodexCli = $null -eq $state.codexAppServerInstallAttempted -or [bool]$state.codexAppServerInstallAttempted
      $StartMenuDirectory = [string]$state.startMenuDirectory
      $DesktopDirectory = [string]$state.desktopDirectory
      $StartupDirectory = [string]$state.startupDirectory
    }
    $LaunchAfterInstall = $false
    Invoke-ProductInstall -Operation 'Repair'
  }
  'Uninstall' { Invoke-ProductUninstall -Purge $false }
  'Purge' { Invoke-ProductUninstall -Purge $true }
  'Status' {
    Get-LifecycleStatus | ConvertTo-Json -Depth 8
  }
  'Menu' { Show-LifecycleMenu }
}
