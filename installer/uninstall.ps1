[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\JiraCodexPanel'),
  [switch]$PurgeUserData,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$productId = 'jira-codex-panel'

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
    Stop-Process -Id $savedPid -ErrorAction SilentlyContinue
  }
}

$InstallRoot = Assert-SafeInstallRoot $InstallRoot
$metadataPath = Join-Path $InstallRoot 'install-metadata.json'
if (-not (Test-Path -LiteralPath $metadataPath)) {
  throw "没有找到安装元数据，已拒绝递归删除：$metadataPath"
}
$metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
if ($metadata.productId -ne $productId) {
  throw "安装标识不匹配，已拒绝递归删除：$InstallRoot"
}

if (-not $Force) {
  Add-Type -AssemblyName System.Windows.Forms
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "确定卸载 Jira Codex 任务面板吗？`r`n`r`nCodex 对话不会删除，Jira Token 和个人配置默认保留。",
    '卸载 Jira Codex 任务面板',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
}

if (-not $PSCmdlet.ShouldProcess($InstallRoot, '卸载 Jira Codex 任务面板')) { return }

$runtimeDirectory = Join-Path $InstallRoot '.runtime'
Stop-TrackedProcess -PidFile (Join-Path $runtimeDirectory 'injector.pid') -ExpectedScript 'injector.mjs' -ExpectedRoot $InstallRoot
Stop-TrackedProcess -PidFile (Join-Path $runtimeDirectory 'server.pid') -ExpectedScript 'server.mjs' -ExpectedRoot $InstallRoot

foreach ($shortcutPath in @($metadata.shortcuts)) {
  if ($shortcutPath -and [System.IO.Path]::GetExtension([string]$shortcutPath) -eq '.lnk' -and (Test-Path -LiteralPath $shortcutPath)) {
    Remove-Item -LiteralPath $shortcutPath -Force
  }
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
  [System.Windows.Forms.MessageBox]::Show($message, 'Jira Codex 任务面板', 'OK', 'Information') | Out-Null
} else {
  Write-Host "卸载完成：$InstallRoot"
  if (-not $PurgeUserData) { Write-Host "已保留用户数据：$userDataRoot" }
}
