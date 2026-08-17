[CmdletBinding()]
param(
  [ValidateSet('Auto', 'Install', 'Update', 'Repair', 'Uninstall', 'Purge', 'Status', 'Menu')]
  [string]$Action = 'Auto',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\JiraWorkbench'),
  [bool]$StartAtLogon = $false,
  [bool]$DesktopShortcut = $true,
  [bool]$LaunchAfterInstall = $true,
  [bool]$InstallCodexCli = $true,
  [string]$UninstallRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JiraWorkbenchAssistant',
  [string]$StartMenuDirectory = '',
  [string]$DesktopDirectory = '',
  [string]$StartupDirectory = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
# 脚本位于 packages/codex/installer/，安装源（workspace 根）为其上三级。
$sourceRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
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

function ConvertTo-NormalizedPath([string]$Path) {
  if (-not $Path) { return '' }
  try {
    $normalized = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path))
    if ($normalized.StartsWith('\\?\', [System.StringComparison]::Ordinal)) {
      $normalized = $normalized.Substring(4)
    }
    return $normalized.TrimEnd('\')
  } catch {
    return ''
  }
}

function Find-CodexCommand([object]$InstalledState) {
  if ($InstalledState -and $InstalledState.codexAppServerCommand) {
    $stored = [string]$InstalledState.codexAppServerCommand
    if (Test-Path -LiteralPath $stored) { return $stored }
  }
  foreach ($name in @('codex.cmd', 'codex.exe', 'codex')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { return [string]$command.Source }
  }
  return ''
}

function Get-CodexPluginRegistrationStatus {
  param(
    [object]$InstalledState,
    [string]$ApplicationRoot
  )

  $pluginSelector = if ($InstalledState.codexPluginSelector) {
    [string]$InstalledState.codexPluginSelector
  } else {
    'jira-workbench-assistant@jira-workbench-local'
  }
  $marketplaceName = if ($InstalledState.codexPluginMarketplace) {
    [string]$InstalledState.codexPluginMarketplace
  } else {
    'jira-workbench-local'
  }
  $result = [ordered]@{
    probeAvailable = $false
    command = ''
    pluginSelector = $pluginSelector
    marketplaceName = $marketplaceName
    pluginRegistered = $false
    pluginEnabled = $false
    marketplaceRegistered = $false
    marketplaceRootMatches = $false
    healthy = $false
  }
  $codexCommand = Find-CodexCommand $InstalledState
  $result.command = $codexCommand
  if (-not $codexCommand) { return $result }

  try {
    $pluginOutput = @(& $codexCommand plugin list --json 2>$null)
    if ($LASTEXITCODE -ne 0) { return $result }
    $marketplaceOutput = @(& $codexCommand plugin marketplace list --json 2>$null)
    if ($LASTEXITCODE -ne 0) { return $result }
    $plugins = ($pluginOutput -join "`n") | ConvertFrom-Json
    $marketplaces = ($marketplaceOutput -join "`n") | ConvertFrom-Json
    $plugin = @($plugins.installed) | Where-Object { [string]$_.pluginId -eq $pluginSelector } | Select-Object -First 1
    $marketplace = @($marketplaces.marketplaces) | Where-Object { [string]$_.name -eq $marketplaceName } | Select-Object -First 1
    $result.probeAvailable = $true
    $result.pluginRegistered = [bool]($plugin -and ($null -eq $plugin.installed -or [bool]$plugin.installed))
    $result.pluginEnabled = [bool]($plugin -and ($null -eq $plugin.enabled -or [bool]$plugin.enabled))
    $result.marketplaceRegistered = [bool]$marketplace
    $result.marketplaceRootMatches = [bool]($marketplace -and (
      (ConvertTo-NormalizedPath ([string]$marketplace.root)) -eq (ConvertTo-NormalizedPath $ApplicationRoot)
    ))
    $result.healthy = $result.pluginRegistered -and $result.pluginEnabled `
      -and $result.marketplaceRegistered -and $result.marketplaceRootMatches
  } catch {}
  return $result
}

function Get-LifecycleStatus {
  $installedState = Read-InstallState
  if (-not $installedState) {
    return [ordered]@{
      installed = $false
      healthy = $false
      installRoot = $InstallRoot
      missingRequiredComponents = @()
      codexRegistrationHealthy = $false
    }
  }

  $status = [ordered]@{}
  foreach ($property in $installedState.PSObject.Properties) {
    $status[$property.Name] = $property.Value
  }

  $manifestAvailable = $false
  $componentDefinitions = @($installedState.components)
  $installedManifestPath = Join-Path $InstallRoot 'packages\codex\installer\product-manifest.json'
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
  $codexRegistration = Get-CodexPluginRegistrationStatus -InstalledState $installedState -ApplicationRoot (Join-Path $InstallRoot 'packages\codex')

  $status['installed'] = $true
  $status['healthy'] = $manifestAvailable -and $missingRequired.Count -eq 0 `
    -and $missingShortcuts.Count -eq 0 -and $registryPresent -and $codexRegistration.healthy
  $status['manifestAvailable'] = $manifestAvailable
  $status['components'] = $liveComponents
  $status['missingRequiredComponents'] = $missingRequired
  $status['missingShortcuts'] = $missingShortcuts
  $status['registryPresent'] = $registryPresent
  $status['codexRegistration'] = $codexRegistration
  $status['codexRegistrationHealthy'] = [bool]$codexRegistration.healthy
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

  $uninstallScript = Join-Path $InstallRoot 'packages\codex\installer\uninstall.ps1'
  if (-not (Test-Path -LiteralPath $uninstallScript)) {
    $uninstallScript = Join-Path $PSScriptRoot 'uninstall.ps1'
  }
  if (-not (Test-Path -LiteralPath $uninstallScript)) {
    throw "卸载入口缺失：$uninstallScript"
  }
  & $uninstallScript -InstallRoot $InstallRoot -UninstallRegistryPath $UninstallRegistryPath -PurgeUserData:$Purge -Force:$Force
}

function Wait-LifecycleMenu {
  Write-Host ''
  $null = Read-Host '按 Enter 返回维护菜单'
}

function Write-LifecycleStatusSummary {
  $status = Get-LifecycleStatus
  Write-Host ''
  Write-Host '安装状态' -ForegroundColor Cyan
  Write-Host "  安装目录：$($status.installRoot)"
  if (-not $status.installed) {
    Write-Host '  结果：未安装' -ForegroundColor Yellow
    return
  }

  $healthLabel = if ($status.healthy) { '正常' } else { '需要修复' }
  $healthColor = if ($status.healthy) { 'Green' } else { 'Yellow' }
  Write-Host "  结果：$healthLabel" -ForegroundColor $healthColor
  Write-Host "  版本：$($status.version)"
  Write-Host "  官方 Plugin：$(if ($status.codexRegistration.pluginRegistered) { '已安装' } else { '未安装' })"
  Write-Host "  Plugin 状态：$(if ($status.codexRegistration.pluginEnabled) { '已启用' } else { '未启用' })"
  Write-Host "  Marketplace：$(if ($status.codexRegistration.marketplaceRegistered -and $status.codexRegistration.marketplaceRootMatches) { '已注册且路径一致' } elseif ($status.codexRegistration.marketplaceRegistered) { '已注册，但路径不一致' } else { '未注册' })"
  if (@($status.missingRequiredComponents).Count -gt 0) {
    Write-Host "  缺少组件：$(@($status.missingRequiredComponents) -join '、')" -ForegroundColor Yellow
  }
  if (@($status.missingShortcuts).Count -gt 0) {
    Write-Host "  缺少快捷方式：$(@($status.missingShortcuts) -join '、')" -ForegroundColor Yellow
  }
}

function Show-LifecycleMenu {
  while ($true) {
    $state = Read-InstallState
    Clear-Host
    Write-Host 'Jira 工作台维护工具' -ForegroundColor Cyan
    Write-Host $(if ($state) { "当前版本：$($state.version)" } else { '当前状态：未安装' })
    Write-Host ''
    Write-Host $(if ($state) { '1. 修复当前安装' } else { '1. 安装 Jira 工作台' })
    Write-Host '2. 普通卸载（保留个人数据）'
    Write-Host '3. 完全清除（删除个人数据）'
    Write-Host '4. 查看安装状态'
    Write-Host '0. 退出'
    $selection = Read-Host '请选择操作'

    try {
      switch ($selection) {
        '1' {
          if ($state) {
            $script:StartAtLogon = [bool]$state.startAtLogon
            $script:DesktopShortcut = $null -eq $state.desktopShortcut -or [bool]$state.desktopShortcut
            $script:LaunchAfterInstall = $false
            $script:InstallCodexCli = $null -eq $state.codexAppServerInstallAttempted -or [bool]$state.codexAppServerInstallAttempted
            $script:StartMenuDirectory = [string]$state.startMenuDirectory
            $script:DesktopDirectory = [string]$state.desktopDirectory
            $script:StartupDirectory = [string]$state.startupDirectory
            Invoke-ProductInstall -Operation 'Repair'
            Write-Host ''
            Write-Host '修复操作已完成。' -ForegroundColor Green
          } else {
            Invoke-ProductInstall -Operation 'Install'
            Write-Host ''
            Write-Host '安装操作已完成。' -ForegroundColor Green
          }
          Wait-LifecycleMenu
        }
        '2' {
          if (-not $state) {
            Write-Host '当前没有可卸载的安装。' -ForegroundColor Yellow
            Wait-LifecycleMenu
            continue
          }
          Invoke-ProductUninstall -Purge $false
          if (-not (Test-Path -LiteralPath $InstallRoot)) {
            Write-Host '卸载已完成。按 Enter 关闭维护工具。' -ForegroundColor Green
            $null = Read-Host
            return
          }
          Write-Host '卸载已取消，安装仍然保留。' -ForegroundColor Yellow
          Wait-LifecycleMenu
        }
        '3' {
          if (-not $state) {
            Write-Host '当前没有可清除的安装。' -ForegroundColor Yellow
            Wait-LifecycleMenu
            continue
          }
          Invoke-ProductUninstall -Purge $true
          if (-not (Test-Path -LiteralPath $InstallRoot)) {
            Write-Host '完全清除已完成。按 Enter 关闭维护工具。' -ForegroundColor Green
            $null = Read-Host
            return
          }
          Write-Host '完全清除已取消，安装和个人数据仍然保留。' -ForegroundColor Yellow
          Wait-LifecycleMenu
        }
        '4' {
          Write-LifecycleStatusSummary
          Wait-LifecycleMenu
        }
        '0' { return }
        default {
          Write-Host '请输入 0 到 4 之间的选项。' -ForegroundColor Yellow
          Wait-LifecycleMenu
        }
      }
    } catch {
      Write-Host ''
      Write-Host "操作失败：$($_.Exception.Message)" -ForegroundColor Red
      Write-Host '安装文件和个人数据不会因本次失败被静默删除。' -ForegroundColor Yellow
      Wait-LifecycleMenu
    }
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
