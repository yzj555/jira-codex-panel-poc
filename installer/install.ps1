[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\JiraCodexPanel'),
  [bool]$StartAtLogon = $false,
  [bool]$DesktopShortcut = $true,
  [bool]$LaunchAfterInstall = $true,
  [string]$StartMenuDirectory = '',
  [string]$DesktopDirectory = '',
  [string]$StartupDirectory = ''
)

$ErrorActionPreference = 'Stop'
$productId = 'jira-codex-panel'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$userDataRoot = Join-Path $env:LOCALAPPDATA 'jira-codex-panel-poc'

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
    [string]$IconLocation
  )

  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.WindowStyle = 7
  if ($IconLocation) { $shortcut.IconLocation = "$IconLocation,0" }
  $shortcut.Save()
}

function Stop-TrackedRuntimeProcesses {
  param([string]$ApplicationRoot)

  $runtimeDirectory = Join-Path $ApplicationRoot '.runtime'
  foreach ($processName in @('injector', 'server')) {
    $pidFile = Join-Path $runtimeDirectory "$processName.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { continue }
    $savedPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    $process = if ($savedPid) { Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue } else { $null }
    $expectedScript = if ($processName -eq 'server') { 'server.mjs' } else { 'injector.mjs' }
    if ($process -and $process.CommandLine -and
        $process.CommandLine.IndexOf($ApplicationRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $process.CommandLine.IndexOf($expectedScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Stop-Process -Id $savedPid -ErrorAction SilentlyContinue
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

if ($env:OS -ne 'Windows_NT') {
  throw '此安装器仅支持 Windows。'
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

$codexPackage = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $codexPackage) {
  throw '未找到 Microsoft Store 版 Codex（OpenAI.Codex）。'
}

$requiredFiles = @('package.json', 'server.mjs', 'injector.mjs', 'jira-client.mjs', 'jxl-client.mjs', 'config-store.mjs', 'README.md')
$requiredDirectories = @('public', 'inject', 'lib', 'scripts', 'installer')
foreach ($relativePath in @($requiredFiles + $requiredDirectories)) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $relativePath))) {
    throw "安装源缺少必要文件：$relativePath"
  }
}

if (-not $StartMenuDirectory) { $StartMenuDirectory = [Environment]::GetFolderPath('Programs') }
if (-not $DesktopDirectory) { $DesktopDirectory = [Environment]::GetFolderPath('DesktopDirectory') }
if (-not $StartupDirectory) { $StartupDirectory = [Environment]::GetFolderPath('Startup') }

$startMenuShortcut = Join-Path $StartMenuDirectory 'Codex.lnk'
$desktopShortcutPath = Join-Path $DesktopDirectory 'Codex.lnk'
$legacyStartMenuShortcut = Join-Path $StartMenuDirectory 'Codex（Jira 任务）.lnk'
$legacyDesktopShortcut = Join-Path $DesktopDirectory 'Codex（Jira 任务）.lnk'
$startupShortcut = Join-Path $StartupDirectory 'Jira Codex Panel Bootstrap.lnk'
$uninstallShortcut = Join-Path $StartMenuDirectory '卸载 Jira Codex 任务面板.lnk'
$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$iconPath = Join-Path $codexPackage.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $iconPath)) { $iconPath = $powerShellPath }

$action = if (Test-Path -LiteralPath (Join-Path $InstallRoot 'install-metadata.json')) { '升级' } else { '安装' }
if (-not $PSCmdlet.ShouldProcess($InstallRoot, "$action Jira Codex 任务面板")) {
  Write-Host "[WhatIf] 将把程序安装到：$InstallRoot"
  Write-Host "[WhatIf] 登录自启：$StartAtLogon；桌面快捷方式：$DesktopShortcut；安装后启动：$LaunchAfterInstall"
  return
}

Stop-TrackedRuntimeProcesses -ApplicationRoot $InstallRoot
if ((Get-FullPath $sourceRoot) -ne (Get-FullPath $InstallRoot)) {
  Stop-TrackedRuntimeProcesses -ApplicationRoot $sourceRoot
}

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
foreach ($file in $requiredFiles) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $InstallRoot $file) -Force
}
foreach ($directory in $requiredDirectories) {
  $destinationDirectory = Join-Path $InstallRoot $directory
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -Path (Join-Path (Join-Path $sourceRoot $directory) '*') -Destination $destinationDirectory -Recurse -Force
}

$launcherPath = Join-Path $InstallRoot 'scripts\launch-codex-jira.ps1'
$uninstallerPath = Join-Path $InstallRoot 'installer\uninstall.ps1'
$launcherArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$backgroundArguments = "$launcherArguments -Background"
$uninstallArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$uninstallerPath`" -InstallRoot `"$InstallRoot`""

New-Shortcut -Path $startMenuShortcut -TargetPath $powerShellPath -Arguments $launcherArguments -WorkingDirectory $InstallRoot -Description '启动带 Jira 任务面板的 Codex' -IconLocation $iconPath
New-Shortcut -Path $uninstallShortcut -TargetPath $powerShellPath -Arguments $uninstallArguments -WorkingDirectory $env:TEMP -Description '卸载 Jira Codex 任务面板' -IconLocation $iconPath
Remove-ManagedShortcut -Path $legacyStartMenuShortcut -ExpectedRoot $InstallRoot

if ($DesktopShortcut) {
  New-Shortcut -Path $desktopShortcutPath -TargetPath $powerShellPath -Arguments $launcherArguments -WorkingDirectory $InstallRoot -Description '启动带 Jira 任务面板的 Codex' -IconLocation $iconPath
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
$metadata = [ordered]@{
  productId = $productId
  version = $packageJson.version
  installedAt = (Get-Date).ToString('o')
  sourceRoot = $sourceRoot
  installRoot = $InstallRoot
  userDataRoot = $userDataRoot
  startAtLogon = $StartAtLogon
  shortcuts = @($startMenuShortcut, $uninstallShortcut) + $(if ($DesktopShortcut) { @($desktopShortcutPath) } else { @() }) + $(if ($StartAtLogon) { @($startupShortcut) } else { @() })
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $InstallRoot 'install-metadata.json') -Encoding UTF8

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
if ($DesktopShortcut) { Write-Host "桌面快捷方式：$desktopShortcutPath" }
if ($StartAtLogon) { Write-Host '登录自启：已启用。' } else { Write-Host '登录自启：未启用，避免与商店版原入口同时打开两个实例。' }
Write-Host "Jira Token：未写入安装目录，首次打开面板时由当前用户配置。"
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
