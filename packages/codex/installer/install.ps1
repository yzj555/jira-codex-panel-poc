[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\JiraWorkbench'),
  [ValidateSet('Auto', 'Install', 'Update', 'Repair')]
  [string]$Operation = 'Auto',
  [bool]$StartAtLogon = $false,
  [bool]$DesktopShortcut = $true,
  [bool]$LaunchAfterInstall = $true,
  [bool]$InstallCodexCli = $true,
  [string]$UninstallRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JiraWorkbenchAssistant',
  [string]$StartMenuDirectory = '',
  [string]$DesktopDirectory = '',
  [string]$StartupDirectory = ''
)

$ErrorActionPreference = 'Stop'
$productId = 'jira-workbench'
$productName = 'Jira 工作台'
$stateSchemaVersion = 2
$uninstallRegistryPath = $UninstallRegistryPath
# 脚本位于 packages/codex/installer/，安装源（workspace 根）为其上三级。
$sourceRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$userDataRoot = Join-Path $env:LOCALAPPDATA 'jira-workbench'
$pluginMarketplaceName = 'jira-workbench-local'
$pluginSelector = "jira-workbench-assistant@$pluginMarketplaceName"

function Get-FullPath([string]$Path) {
  [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path))
}

function Assert-SafeInstallRoot([string]$Path) {
  $fullPath = Get-FullPath $Path
  $root = [System.IO.Path]::GetPathRoot($fullPath)
  $blocked = @(
    $root,
    $env:USERPROFILE,
    $env:LOCALAPPDATA,
    $env:APPDATA,
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:SystemRoot
  ) | Where-Object { $_ } | ForEach-Object { (Get-FullPath $_).TrimEnd('\') }

  if ($fullPath.TrimEnd('\') -in $blocked) {
    throw "安装目录过于宽泛，已拒绝操作：$fullPath"
  }
  if ($fullPath.Contains('"')) {
    throw '安装目录不能包含双引号。'
  }
  return $fullPath
}

function New-Shortcut {
  param(
    [string]$Path,
    [string]$TargetPath,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [string]$Description,
    [string]$IconLocation,
    [ValidateRange(1, 7)]
    [int]$WindowStyle = 7
  )

  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.WindowStyle = $WindowStyle
  if ($IconLocation) { $shortcut.IconLocation = "$IconLocation,0" }
  $shortcut.Save()
}

function Stop-TrackedRuntimeProcesses {
  param([string]$ApplicationRoot)

  function Stop-ValidatedProcessTree {
    param(
      [int]$TargetProcessId,
      [object[]]$ProcessSnapshot
    )
    foreach ($child in @($ProcessSnapshot | Where-Object { $_.ParentProcessId -eq $TargetProcessId })) {
      Stop-ValidatedProcessTree -TargetProcessId $child.ProcessId -ProcessSnapshot $ProcessSnapshot
    }
    Stop-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
  }

  $runtimeDirectory = Join-Path $ApplicationRoot 'packages\codex\.runtime'
  $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  foreach ($processName in @('injector', 'server')) {
    $pidFile = Join-Path $runtimeDirectory "$processName.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { continue }
    $savedPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    $process = if ($savedPid) { Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue } else { $null }
    $expectedScript = if ($processName -eq 'server') { 'server.mjs' } else { 'injector.mjs' }
    if ($process -and $process.CommandLine -and
        $process.CommandLine.IndexOf($ApplicationRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $process.CommandLine.IndexOf($expectedScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Stop-ValidatedProcessTree -TargetProcessId ([int]$savedPid) -ProcessSnapshot $processSnapshot
      Write-Host "已停止旧的 $processName 进程，PID=$savedPid"
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
}

function Remove-ManagedShortcut {
  param(
    [string]$Path,
    [string]$ExpectedRoot
  )

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  if ($shortcut.Arguments -and
      $shortcut.Arguments.IndexOf($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $shortcut.Arguments.IndexOf('launch-codex-jira.ps1', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Remove-Item -LiteralPath $Path -Force
  }
}

function Remove-LegacyLifecycleShortcut {
  param(
    [string]$Path,
    [string]$ExpectedRoot
  )

  if (-not (Test-Path -LiteralPath $Path)) { return }
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $arguments = [string]$shortcut.Arguments
    if ($arguments.IndexOf($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        ($arguments.IndexOf('uninstall.ps1', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
         $arguments.IndexOf('lifecycle.ps1', [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
      Remove-Item -LiteralPath $Path -Force
    }
  } catch {}
}

function Register-ProductUninstallEntry {
  param(
    [string]$RegistryPath,
    [string]$DisplayName,
    [string]$Version,
    [string]$ApplicationRoot,
    [string]$PowerShellPath,
    [string]$LifecyclePath,
    [string]$IconPath
  )

  $uninstallCommand = "`"$PowerShellPath`" -NoProfile -ExecutionPolicy Bypass -File `"$LifecyclePath`" -Action Uninstall -InstallRoot `"$ApplicationRoot`" -UninstallRegistryPath `"$RegistryPath`""
  $quietUninstallCommand = "$uninstallCommand -Force"
  $modifyCommand = "`"$PowerShellPath`" -NoProfile -ExecutionPolicy Bypass -File `"$LifecyclePath`" -Action Menu -InstallRoot `"$ApplicationRoot`" -UninstallRegistryPath `"$RegistryPath`""
  New-Item -Path $RegistryPath -Force | Out-Null
  $values = [ordered]@{
    DisplayName = $DisplayName
    DisplayVersion = $Version
    Publisher = 'Jira Workbench'
    InstallLocation = $ApplicationRoot
    DisplayIcon = $IconPath
    UninstallString = $uninstallCommand
    QuietUninstallString = $quietUninstallCommand
    ModifyPath = $modifyCommand
    InstallDate = (Get-Date).ToString('yyyyMMdd')
    NoModify = 0
    NoRepair = 0
  }
  foreach ($entry in $values.GetEnumerator()) {
    New-ItemProperty -Path $RegistryPath -Name $entry.Key -Value $entry.Value -PropertyType $(
      if ($entry.Value -is [int]) { 'DWord' } else { 'String' }
    ) -Force | Out-Null
  }
}

function Find-CodexCliExecutable {
  param([System.Management.Automation.CommandInfo]$NpmCommand)

  $roots = @()
  if ($NpmCommand) {
    try {
      $npmRoot = @(& $NpmCommand.Source root -g 2>$null) | Select-Object -Last 1
      if ($npmRoot) { $roots += [string]$npmRoot }
    } catch {}
  }
  if ($env:npm_config_prefix) { $roots += (Join-Path $env:npm_config_prefix 'node_modules') }
  if ($env:APPDATA) { $roots += (Join-Path $env:APPDATA 'npm\node_modules') }
  foreach ($entry in ($env:Path -split ';')) {
    if (-not $entry) { continue }
    $roots += (Join-Path $entry 'node_modules')
    if ((Split-Path -Leaf $entry) -eq 'node_modules') { $roots += $entry }
  }

  foreach ($root in @($roots | Where-Object { $_ } | Select-Object -Unique)) {
    foreach ($relativePath in @(
      '@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe',
      '@openai\codex-win32-arm64\vendor\aarch64-pc-windows-msvc\bin\codex.exe',
      '@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe',
      '@openai\codex\node_modules\@openai\codex-win32-arm64\vendor\aarch64-pc-windows-msvc\bin\codex.exe'
    )) {
      $candidate = Join-Path $root $relativePath
      if (Test-Path -LiteralPath $candidate) { return (Get-FullPath $candidate) }
    }
  }
  return ''
}

function ConvertTo-NormalizedPath([string]$Path) {
  if (-not $Path) { return '' }
  $normalized = Get-FullPath $Path
  if ($normalized.StartsWith('\\?\', [System.StringComparison]::Ordinal)) {
    $normalized = $normalized.Substring(4)
  }
  return $normalized.TrimEnd('\')
}

function Get-CodexPluginRegistration {
  param(
    [string]$CodexCommand,
    [string]$PluginSelector,
    [string]$MarketplaceName,
    [string]$MarketplaceRoot
  )

  $result = [ordered]@{
    probeAvailable = $false
    pluginRegistered = $false
    pluginEnabled = $false
    marketplaceRegistered = $false
    marketplaceRootMatches = $false
    healthy = $false
  }
  if (-not $CodexCommand) { return $result }

  try {
    $pluginOutput = @(& $CodexCommand plugin list --json 2>$null)
    if ($LASTEXITCODE -ne 0) { return $result }
    $marketplaceOutput = @(& $CodexCommand plugin marketplace list --json 2>$null)
    if ($LASTEXITCODE -ne 0) { return $result }
    $plugins = ($pluginOutput -join "`n") | ConvertFrom-Json
    $marketplaces = ($marketplaceOutput -join "`n") | ConvertFrom-Json
    $plugin = @($plugins.installed) | Where-Object { [string]$_.pluginId -eq $PluginSelector } | Select-Object -First 1
    $marketplace = @($marketplaces.marketplaces) | Where-Object { [string]$_.name -eq $MarketplaceName } | Select-Object -First 1
    $result.probeAvailable = $true
    $result.pluginRegistered = [bool]($plugin -and ($null -eq $plugin.installed -or [bool]$plugin.installed))
    $result.pluginEnabled = [bool]($plugin -and ($null -eq $plugin.enabled -or [bool]$plugin.enabled))
    $result.marketplaceRegistered = [bool]$marketplace
    $result.marketplaceRootMatches = [bool]($marketplace -and (
      (ConvertTo-NormalizedPath ([string]$marketplace.root)) -eq (ConvertTo-NormalizedPath $MarketplaceRoot)
    ))
    $result.healthy = $result.pluginRegistered -and $result.pluginEnabled `
      -and $result.marketplaceRegistered -and $result.marketplaceRootMatches
  } catch {}
  return $result
}

function Remove-ObsoleteManifestComponents {
  param(
    [object]$PreviousManifest,
    [object]$CurrentManifest,
    [string]$ApplicationRoot
  )

  if (-not $PreviousManifest) { return }
  $rootBoundary = (Get-FullPath $ApplicationRoot).TrimEnd('\') + '\'
  $currentPaths = @($CurrentManifest.components | ForEach-Object { [string]$_.path } | Where-Object { $_ })
  foreach ($component in @($PreviousManifest.components)) {
    $relativePath = [string]$component.path
    if (-not $relativePath) { continue }
    $stillManaged = @($currentPaths | Where-Object { $_ -eq $relativePath }).Count -gt 0
    if ($stillManaged) { continue }

    $target = Get-FullPath (Join-Path $ApplicationRoot $relativePath)
    if (-not $target.StartsWith($rootBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "旧组件路径超出产品目录，已拒绝清理：$relativePath"
    }
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
      Write-Host "已清理废弃组件：$relativePath"
    }
  }
}

function Install-CodexPlugin {
  param(
    [string]$CodexCommand,
    [string]$MarketplaceRoot,
    [string]$PreviousPluginSelector = '',
    [string]$PreviousMarketplaceName = ''
  )

  if (-not $CodexCommand) {
    throw '未找到 Codex CLI，无法注册核心 Codex Plugin。安装尚未完成。'
  }

  # Update/repair must not leave a cache snapshot pointing at an older install.
  foreach ($selector in @($pluginSelector, $PreviousPluginSelector) | Where-Object { $_ } | Select-Object -Unique) {
    & $CodexCommand plugin remove $selector --json 2>$null | Out-Null
  }
  foreach ($marketplace in @($pluginMarketplaceName, $PreviousMarketplaceName) | Where-Object { $_ } | Select-Object -Unique) {
    & $CodexCommand plugin marketplace remove $marketplace --json 2>$null | Out-Null
  }

  & $CodexCommand plugin marketplace add $MarketplaceRoot --json | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "无法注册核心 Codex Plugin Marketplace（退出码 $LASTEXITCODE）。安装尚未完成。"
  }
  & $CodexCommand plugin add $pluginSelector --json | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $pluginExitCode = $LASTEXITCODE
    & $CodexCommand plugin marketplace remove $pluginMarketplaceName --json 2>$null | Out-Null
    throw "无法安装核心 Codex Plugin（退出码 $pluginExitCode）。安装尚未完成。"
  }
  $registration = Get-CodexPluginRegistration `
    -CodexCommand $CodexCommand `
    -PluginSelector $pluginSelector `
    -MarketplaceName $pluginMarketplaceName `
    -MarketplaceRoot $MarketplaceRoot
  if (-not $registration.healthy) {
    & $CodexCommand plugin remove $pluginSelector --json 2>$null | Out-Null
    & $CodexCommand plugin marketplace remove $pluginMarketplaceName --json 2>$null | Out-Null
    throw 'Codex CLI 已返回成功，但未能核验核心 Plugin/Marketplace 注册。安装尚未完成。'
  }
  Write-Host "已安装官方 Codex Plugin：$pluginSelector"
  return $true
}

if ($env:OS -ne 'Windows_NT') {
  throw '此安装器仅支持 Windows。'
}
if ($uninstallRegistryPath -notmatch '^HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[A-Za-z0-9._-]+$') {
  throw "卸载注册表路径不安全：$uninstallRegistryPath"
}

$InstallRoot = Assert-SafeInstallRoot $InstallRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw '未找到 Node.js。请先安装 Node.js 22 或更高版本。'
}
$nodeVersionText = (& $nodeCommand.Source --version).Trim().TrimStart('v')
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion.Major -lt 22) {
  throw "Node.js 版本过低：$nodeVersionText；需要 22 或更高版本。"
}
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npmCommand) {
  throw '未找到 npm。本地 MCP 服务需要 npm 安装运行依赖。'
}

$codexPackage = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $codexPackage) {
  throw '未找到 Microsoft Store 版 Codex（OpenAI.Codex）。'
}

$requiredFiles = @('package.json', 'package-lock.json', 'README.md', 'packages\codex\server.mjs', 'packages\codex\injector.mjs', 'packages\core\index.mjs')
$requiredDirectories = @('packages\core', 'packages\codex')
foreach ($relativePath in @($requiredFiles + $requiredDirectories)) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $relativePath))) {
    throw "安装源缺少必要文件：$relativePath"
  }
}
$productManifestPath = Join-Path $sourceRoot 'packages\codex\installer\product-manifest.json'
$productManifest = Get-Content -Raw -LiteralPath $productManifestPath | ConvertFrom-Json
if ($productManifest.productId -ne $productId) {
  throw "产品清单标识不匹配：$productManifestPath"
}
foreach ($component in @($productManifest.components | Where-Object { $_.required })) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot ([string]$component.path)))) {
    throw "安装源缺少必要组件 $($component.id)：$($component.path)"
  }
}

if (-not $StartMenuDirectory) { $StartMenuDirectory = [Environment]::GetFolderPath('Programs') }
if (-not $DesktopDirectory) { $DesktopDirectory = [Environment]::GetFolderPath('DesktopDirectory') }
if (-not $StartupDirectory) { $StartupDirectory = [Environment]::GetFolderPath('Startup') }

$startMenuShortcut = Join-Path $StartMenuDirectory 'Codex.lnk'
$desktopShortcutPath = Join-Path $DesktopDirectory 'Codex.lnk'
$legacyStartMenuShortcut = Join-Path $StartMenuDirectory 'Codex（Jira 任务）.lnk'
$legacyDesktopShortcut = Join-Path $DesktopDirectory 'Codex（Jira 任务）.lnk'
$startupShortcut = Join-Path $StartupDirectory 'Jira Workbench Bootstrap.lnk'
$maintenanceShortcut = Join-Path $StartMenuDirectory '维护 Jira 工作台.lnk'
$legacyUninstallShortcut = Join-Path $StartMenuDirectory '卸载 Jira 工作台.lnk'
$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$iconPath = Join-Path $codexPackage.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $iconPath)) { $iconPath = $powerShellPath }

$existingStatePath = @(
  (Join-Path $InstallRoot 'install-state.json'),
  (Join-Path $InstallRoot 'install-metadata.json')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$existingState = if ($existingStatePath) {
  try { Get-Content -Raw -LiteralPath $existingStatePath | ConvertFrom-Json } catch { $null }
} else { $null }
$previousManifestPath = @(
  (Join-Path $InstallRoot 'installer\product-manifest.json'),
  (Join-Path $InstallRoot 'packages\codex\installer\product-manifest.json')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$previousProductManifest = if ((Get-FullPath $sourceRoot) -ne (Get-FullPath $InstallRoot) -and $previousManifestPath) {
  try { Get-Content -Raw -LiteralPath $previousManifestPath | ConvertFrom-Json } catch { $null }
} else { $null }
if ($Operation -eq 'Auto') { $Operation = if ($existingState) { 'Update' } else { 'Install' } }
$action = switch ($Operation) {
  'Repair' { '修复' }
  'Update' { '升级' }
  default { '安装' }
}
if (-not $PSCmdlet.ShouldProcess($InstallRoot, "$action $productName")) {
  Write-Host "[WhatIf] 将把程序安装到：$InstallRoot"
  Write-Host "[WhatIf] 登录自启：$StartAtLogon；桌面快捷方式：$DesktopShortcut；安装后启动：$LaunchAfterInstall"
  Write-Host "[WhatIf] 独立 Codex CLI：$InstallCodexCli（用于官方 App Server 与核心 Plugin；缺失会使安装失败）"
  return
}

$codexCliPath = Find-CodexCliExecutable -NpmCommand $npmCommand
if (-not $codexCliPath -and $InstallCodexCli) {
  if (-not $npmCommand) {
    throw '未找到 npm，无法安装核心 Codex CLI。'
  } else {
    Write-Host '正在安装当前用户 Node 环境的官方 Codex CLI，用于 App Server 稳定接口……'
    & $npmCommand.Source install -g '@openai/codex@latest'
    if ($LASTEXITCODE -ne 0) {
      throw "Codex CLI 安装失败（退出码 $LASTEXITCODE）。"
    }
    $codexCliPath = Find-CodexCliExecutable -NpmCommand $npmCommand
    if (-not $codexCliPath) {
      throw 'Codex CLI 安装命令已结束，但没有找到可执行文件。'
    }
  }
}

Stop-TrackedRuntimeProcesses -ApplicationRoot $InstallRoot
if ((Get-FullPath $sourceRoot) -ne (Get-FullPath $InstallRoot)) {
  Stop-TrackedRuntimeProcesses -ApplicationRoot $sourceRoot
}

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$sourceIsInstallRoot = (Get-FullPath $sourceRoot).TrimEnd('\') -eq (Get-FullPath $InstallRoot).TrimEnd('\')
if (-not $sourceIsInstallRoot) {
  Remove-ObsoleteManifestComponents `
    -PreviousManifest $previousProductManifest `
    -CurrentManifest $productManifest `
    -ApplicationRoot $InstallRoot
  foreach ($component in @($productManifest.components)) {
    $relativePath = [string]$component.path
    if (-not $relativePath) { continue }
    $sourceComponent = Get-FullPath (Join-Path $sourceRoot $relativePath)
    $destinationComponent = Get-FullPath (Join-Path $InstallRoot $relativePath)
    $sourceBoundary = (Get-FullPath $sourceRoot).TrimEnd('\') + '\'
    $destinationBoundary = (Get-FullPath $InstallRoot).TrimEnd('\') + '\'
    if (-not $sourceComponent.StartsWith($sourceBoundary, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not $destinationComponent.StartsWith($destinationBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "组件路径超出产品目录，已拒绝复制：$relativePath"
    }
    if (-not (Test-Path -LiteralPath $sourceComponent)) { continue }
    $sourceItem = Get-Item -LiteralPath $sourceComponent
    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationComponent) -Force | Out-Null
    if ($sourceItem.PSIsContainer) {
      New-Item -ItemType Directory -Path $destinationComponent -Force | Out-Null
      foreach ($child in @(Get-ChildItem -LiteralPath $sourceComponent -Force)) {
        Copy-Item -LiteralPath $child.FullName -Destination $destinationComponent -Recurse -Force
      }
    } else {
      Copy-Item -LiteralPath $sourceComponent -Destination $destinationComponent -Force
    }
  }
}

Write-Host '正在安装本地服务运行依赖……'
Push-Location $InstallRoot
try {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $npmCommand.Source ci --omit=dev --no-audit --no-fund 2>&1 | ForEach-Object { Write-Host $_ }
  $npmExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($npmExitCode -ne 0) {
    throw "本地服务依赖安装失败（npm 退出码 $npmExitCode）。"
  }
} finally {
  $ErrorActionPreference = 'Stop'
  Pop-Location
}

$previousPluginSelector = if ($existingState -and $existingState.codexPluginSelector) { [string]$existingState.codexPluginSelector } else { '' }
$previousMarketplaceName = if ($existingState -and $existingState.codexPluginMarketplace) { [string]$existingState.codexPluginMarketplace } else { '' }
$pluginRegistered = Install-CodexPlugin `
  -CodexCommand $codexCliPath `
  -MarketplaceRoot (Join-Path $InstallRoot 'packages\codex') `
  -PreviousPluginSelector $previousPluginSelector `
  -PreviousMarketplaceName $previousMarketplaceName

$launcherPath = Join-Path $InstallRoot 'packages\codex\scripts\launch-codex-jira.ps1'
$lifecyclePath = Join-Path $InstallRoot 'packages\codex\installer\lifecycle.ps1'
$launcherArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$backgroundArguments = "$launcherArguments -Background"
$maintenanceArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$lifecyclePath`" -Action Menu -InstallRoot `"$InstallRoot`" -UninstallRegistryPath `"$uninstallRegistryPath`""

New-Shortcut -Path $startMenuShortcut -TargetPath $powerShellPath -Arguments $launcherArguments -WorkingDirectory $InstallRoot -Description '启动 Jira 工作台' -IconLocation $iconPath
New-Shortcut -Path $maintenanceShortcut -TargetPath $powerShellPath -Arguments $maintenanceArguments -WorkingDirectory $InstallRoot -Description '修复或卸载 Jira 工作台' -IconLocation $iconPath -WindowStyle 1
Remove-LegacyLifecycleShortcut -Path $legacyUninstallShortcut -ExpectedRoot $InstallRoot
Remove-ManagedShortcut -Path $legacyStartMenuShortcut -ExpectedRoot $InstallRoot

if ($DesktopShortcut) {
  New-Shortcut -Path $desktopShortcutPath -TargetPath $powerShellPath -Arguments $launcherArguments -WorkingDirectory $InstallRoot -Description '启动 Jira 工作台' -IconLocation $iconPath
} elseif (Test-Path -LiteralPath $desktopShortcutPath) {
  Remove-ManagedShortcut -Path $desktopShortcutPath -ExpectedRoot $InstallRoot
}
Remove-ManagedShortcut -Path $legacyDesktopShortcut -ExpectedRoot $InstallRoot

if ($StartAtLogon) {
  New-Shortcut -Path $startupShortcut -TargetPath $powerShellPath -Arguments $backgroundArguments -WorkingDirectory $InstallRoot -Description '登录后预先启动带 Jira 参数的 Codex' -IconLocation $iconPath
} elseif (Test-Path -LiteralPath $startupShortcut) {
  Remove-ManagedShortcut -Path $startupShortcut -ExpectedRoot $InstallRoot
}

New-Item -ItemType Directory -Path $userDataRoot -Force | Out-Null
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $InstallRoot 'package.json') | ConvertFrom-Json
$installedComponents = @($productManifest.components | ForEach-Object {
  $componentPath = Join-Path $InstallRoot ([string]$_.path)
  [ordered]@{
    id = [string]$_.id
    required = [bool]$_.required
    installed = Test-Path -LiteralPath $componentPath
    path = [string]$_.path
  }
})
$installedAt = if ($existingState -and $existingState.installedAt) {
  [string]$existingState.installedAt
} else {
  (Get-Date).ToString('o')
}
$trackedShortcuts = @($startMenuShortcut, $maintenanceShortcut) `
  + $(if ($DesktopShortcut) { @($desktopShortcutPath) } else { @() }) `
  + $(if ($StartAtLogon) { @($startupShortcut) } else { @() })
$metadata = [ordered]@{
  schemaVersion = $stateSchemaVersion
  productId = $productId
  productName = $productName
  version = $packageJson.version
  installedAt = $installedAt
  updatedAt = (Get-Date).ToString('o')
  lastOperation = $Operation.ToLowerInvariant()
  sourceRoot = $sourceRoot
  installRoot = $InstallRoot
  userDataRoot = $userDataRoot
  codexAppServerCommand = $codexCliPath
  codexAppServerInstallAttempted = $InstallCodexCli
  codexPluginSelector = $pluginSelector
  codexPluginMarketplace = $pluginMarketplaceName
  codexPluginRegistered = $pluginRegistered
  startAtLogon = $StartAtLogon
  desktopShortcut = $DesktopShortcut
  startMenuDirectory = $StartMenuDirectory
  desktopDirectory = $DesktopDirectory
  startupDirectory = $StartupDirectory
  lifecycleEntry = $lifecyclePath
  uninstallRegistryPath = $uninstallRegistryPath
  shortcuts = $trackedShortcuts
  components = $installedComponents
  ownedResources = [ordered]@{
    shortcuts = $trackedShortcuts
    registryKeys = @($uninstallRegistryPath)
    programRoot = $InstallRoot
    userDataRoot = $userDataRoot
    codexPlugin = $pluginSelector
    codexPluginMarketplace = $pluginMarketplaceName
  }
}
$metadataJson = $metadata | ConvertTo-Json -Depth 8
$metadataJson | Set-Content -LiteralPath (Join-Path $InstallRoot 'install-state.json') -Encoding UTF8
$metadataJson | Set-Content -LiteralPath (Join-Path $InstallRoot 'install-metadata.json') -Encoding UTF8
Register-ProductUninstallEntry `
  -RegistryPath $uninstallRegistryPath `
  -DisplayName $productName `
  -Version $packageJson.version `
  -ApplicationRoot $InstallRoot `
  -PowerShellPath $powerShellPath `
  -LifecyclePath $lifecyclePath `
  -IconPath $iconPath

$cdpReady = $false
try {
  $null = Invoke-RestMethod -Uri 'http://127.0.0.1:47824/json/version' -TimeoutSec 1
  $cdpReady = $true
} catch {}
$ordinaryCodexRunning = -not $cdpReady -and [bool](Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction SilentlyContinue | Where-Object {
  -not $_.CommandLine -or $_.CommandLine -notmatch '(?:^|\s)--type='
} | Select-Object -First 1)

Write-Host ''
Write-Host "${action}完成：$InstallRoot"
Write-Host "开始菜单：$startMenuShortcut"
Write-Host "统一维护入口：$maintenanceShortcut"
Write-Host "Windows 已安装的应用：$productName"
if ($DesktopShortcut) { Write-Host "桌面快捷方式：$desktopShortcutPath" }
if ($StartAtLogon) { Write-Host '登录自启：已启用。' } else { Write-Host '登录自启：未启用，避免与商店版原入口同时打开两个实例。' }
Write-Host "Jira Token：未写入安装目录，首次打开面板时由当前用户配置。"
Write-Host "Codex App Server 与核心 Plugin：已配置并核验独立 CLI（$codexCliPath）。"
if ($ordinaryCodexRunning) {
  Write-Warning '当前已有不带参数的 Codex 正在运行。首次启动快捷方式时会询问是否正常重启 Codex。'
}

if ($LaunchAfterInstall) {
  $launchProcess = Start-Process -FilePath $powerShellPath -ArgumentList $launcherArguments -PassThru
  $launcherExited = $launchProcess.WaitForExit(30000)
  if (-not $launcherExited) {
    Write-Warning '安装已经完成，启动器仍在后台准备 Codex。可稍后从“Codex”快捷方式查看；安装器不再等待其派生的长期运行服务。'
  } elseif ($launchProcess.ExitCode -ne 0) {
    Write-Warning "安装已经完成，但 Codex 尚未切换到 Jira 面板启动模式。请打开安装器创建的“Codex”快捷方式。启动器退出码：$($launchProcess.ExitCode)"
  }
}
