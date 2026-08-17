[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\JiraCodexPanel'),
  [string]$UninstallRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JiraCodexAssistant',
  [switch]$PurgeUserData,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$productId = 'jira-codex-panel'
$productName = 'Jira Codex 助手'
$uninstallRegistryPath = $UninstallRegistryPath

function Get-FullPath([string]$Path) {
  [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path))
}

function Assert-SafeInstallRoot([string]$Path) {
  $fullPath = Get-FullPath $Path
  $root = [System.IO.Path]::GetPathRoot($fullPath)
  $blocked = @($root, $env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:SystemRoot) |
    Where-Object { $_ } | ForEach-Object { (Get-FullPath $_).TrimEnd('\') }
  if ($fullPath.TrimEnd('\') -in $blocked) {
    throw "卸载目录过于宽泛，已拒绝操作：$fullPath"
  }
  return $fullPath
}

function Stop-TrackedProcess {
  param(
    [string]$PidFile,
    [string]$ExpectedScript,
    [string]$ExpectedRoot
  )

  if (-not (Test-Path -LiteralPath $PidFile)) { return }
  $savedPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $savedPid) { return }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -and
      $process.CommandLine.IndexOf($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $process.CommandLine.IndexOf($ExpectedScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    function Stop-ValidatedProcessTree {
      param(
        [int]$TargetProcessId,
        [object[]]$Snapshot
      )
      foreach ($child in @($Snapshot | Where-Object { $_.ParentProcessId -eq $TargetProcessId })) {
        Stop-ValidatedProcessTree -TargetProcessId $child.ProcessId -Snapshot $Snapshot
      }
      Stop-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
    }
    Stop-ValidatedProcessTree -TargetProcessId ([int]$savedPid) -Snapshot $processSnapshot
  }
}

function Remove-TrackedShortcut {
  param(
    [string]$Path,
    [string]$ExpectedRoot
  )

  if (-not $Path -or [System.IO.Path]::GetExtension($Path) -ne '.lnk' -or -not (Test-Path -LiteralPath $Path)) {
    return
  }
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $owned = ([string]$shortcut.Arguments).IndexOf($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 `
      -or ([string]$shortcut.WorkingDirectory).IndexOf($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($owned) { Remove-Item -LiteralPath $Path -Force }
  } catch {}
}

function Get-CodexRegistrationCleanupStatus {
  param(
    [string]$CodexCommand,
    [string]$PluginSelector,
    [string]$MarketplaceName
  )

  $result = [ordered]@{
    probeAvailable = $false
    pluginRegistered = $true
    marketplaceRegistered = $true
    clean = $false
  }
  if (-not $CodexCommand) { return $result }
  try {
    $pluginOutput = @(& $CodexCommand plugin list --json 2>$null)
    if ($LASTEXITCODE -ne 0) { return $result }
    $marketplaceOutput = @(& $CodexCommand plugin marketplace list --json 2>$null)
    if ($LASTEXITCODE -ne 0) { return $result }
    $plugins = ($pluginOutput -join "`n") | ConvertFrom-Json
    $marketplaces = ($marketplaceOutput -join "`n") | ConvertFrom-Json
    $result.probeAvailable = $true
    $result.pluginRegistered = [bool](@($plugins.installed) | Where-Object { [string]$_.pluginId -eq $PluginSelector } | Select-Object -First 1)
    $result.marketplaceRegistered = [bool](@($marketplaces.marketplaces) | Where-Object { [string]$_.name -eq $MarketplaceName } | Select-Object -First 1)
    $result.clean = -not $result.pluginRegistered -and -not $result.marketplaceRegistered
  } catch {}
  return $result
}

$InstallRoot = Assert-SafeInstallRoot $InstallRoot
if ($uninstallRegistryPath -notmatch '^HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[A-Za-z0-9._-]+$') {
  throw "卸载注册表路径不安全：$uninstallRegistryPath"
}
$metadataPath = @(
  (Join-Path $InstallRoot 'install-state.json'),
  (Join-Path $InstallRoot 'install-metadata.json')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $metadataPath) {
  throw "没有找到安装状态清单，已拒绝递归删除：$InstallRoot"
}
$metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
if ($metadata.productId -ne $productId) {
  throw "安装标识不匹配，已拒绝递归删除：$InstallRoot"
}

if (-not $Force) {
  Add-Type -AssemblyName System.Windows.Forms
  $dataNotice = if ($PurgeUserData) {
    'Jira Token、个人配置、绑定、日志和附件缓存也会删除。'
  } else {
    'Jira Token 和个人配置默认保留。'
  }
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "确定卸载 $productName 吗？`r`n`r`nCodex 对话不会删除。$dataNotice",
    "卸载 $productName",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
}

if (-not $PSCmdlet.ShouldProcess($InstallRoot, "卸载 $productName")) { return }

$runtimeDirectory = Join-Path $InstallRoot '.runtime'
Stop-TrackedProcess -PidFile (Join-Path $runtimeDirectory 'injector.pid') -ExpectedScript 'injector.mjs' -ExpectedRoot $InstallRoot
Stop-TrackedProcess -PidFile (Join-Path $runtimeDirectory 'server.pid') -ExpectedScript 'server.mjs' -ExpectedRoot $InstallRoot

$pluginSelector = if ($metadata.codexPluginSelector) {
  [string]$metadata.codexPluginSelector
} else {
  'jira-codex-assistant@jira-codex-local'
}
$pluginMarketplaceName = if ($metadata.codexPluginMarketplace) {
  [string]$metadata.codexPluginMarketplace
} else {
  'jira-codex-local'
}
$codexCommandPath = if ($metadata.codexAppServerCommand -and (Test-Path -LiteralPath ([string]$metadata.codexAppServerCommand))) {
  [string]$metadata.codexAppServerCommand
} else {
  $fallbackCodexCommand = Get-Command codex.cmd -ErrorAction SilentlyContinue
  if ($fallbackCodexCommand) { [string]$fallbackCodexCommand.Source } else { '' }
}
$registrationWasManaged = $metadata.PSObject.Properties.Name -contains 'codexPluginSelector' `
  -or $metadata.PSObject.Properties.Name -contains 'codexPluginMarketplace' `
  -or $metadata.PSObject.Properties.Name -contains 'codexPluginRegistered'
if ($registrationWasManaged -and -not $codexCommandPath) {
  throw '卸载未完成：找不到 Codex CLI，无法确认核心 Plugin/Marketplace 注册已清理。程序文件已保留，请修复 Codex CLI 后重试。'
}
if ($registrationWasManaged) {
  & $codexCommandPath plugin remove $pluginSelector --json 2>$null | Out-Null
  & $codexCommandPath plugin marketplace remove $pluginMarketplaceName --json 2>$null | Out-Null
  $cleanupStatus = Get-CodexRegistrationCleanupStatus `
    -CodexCommand $codexCommandPath `
    -PluginSelector $pluginSelector `
    -MarketplaceName $pluginMarketplaceName
  if (-not $cleanupStatus.probeAvailable -or -not $cleanupStatus.clean) {
    throw '卸载未完成：无法确认核心 Plugin/Marketplace 注册已清理。程序文件已保留，请人工检查 Codex Plugin 状态后重试。'
  }
}

foreach ($shortcutPath in @($metadata.shortcuts)) {
  Remove-TrackedShortcut -Path ([string]$shortcutPath) -ExpectedRoot $InstallRoot
}

if (Test-Path -LiteralPath $uninstallRegistryPath) {
  Remove-Item -LiteralPath $uninstallRegistryPath -Recurse -Force
}

$userDataRoot = if ($metadata.userDataRoot) { [string]$metadata.userDataRoot } else { Join-Path $env:LOCALAPPDATA 'jira-codex-panel-poc' }
Set-Location $env:TEMP
Remove-Item -LiteralPath $InstallRoot -Recurse -Force

if ($PurgeUserData -and (Test-Path -LiteralPath $userDataRoot)) {
  $expectedUserDataRoot = Get-FullPath (Join-Path $env:LOCALAPPDATA 'jira-codex-panel-poc')
  if ((Get-FullPath $userDataRoot) -ne $expectedUserDataRoot) {
    throw "用户数据目录不符合预期，已拒绝删除：$userDataRoot"
  }
  Remove-Item -LiteralPath $userDataRoot -Recurse -Force
}

if (-not $Force) {
  $message = if ($PurgeUserData) {
    '卸载完成，Jira Token 和个人配置也已删除。'
  } else {
    "卸载完成。Jira Token 和个人配置仍保留在：$userDataRoot"
  }
  [System.Windows.Forms.MessageBox]::Show($message, $productName, 'OK', 'Information') | Out-Null
} else {
  Write-Host "卸载完成：$InstallRoot"
  if (-not $PurgeUserData) { Write-Host "已保留用户数据：$userDataRoot" }
}
