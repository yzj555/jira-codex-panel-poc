[CmdletBinding()]
param(
  [switch]$Background,
  [int]$PanelPort = 47823,
  [int]$CdpPort = 47824,
  [string]$ProfileDirectory = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot '.runtime'
$userDataRoot = Join-Path $env:LOCALAPPDATA 'jira-codex-panel-poc'
if (-not $ProfileDirectory) {
  $ProfileDirectory = Join-Path $userDataRoot 'codex-profile'
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

function Write-LauncherStatus {
  param(
    [string]$State,
    [string]$Message,
    [int]$ExitCode = 0
  )

  $status = [ordered]@{
    state = $State
    message = $Message
    exitCode = $ExitCode
    updatedAt = (Get-Date).ToString('o')
    panelPort = $PanelPort
    cdpPort = $CdpPort
  }
  $status | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'launcher-status.json') -Encoding UTF8
}

function Test-CdpEndpoint {
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/version" -TimeoutSec 1
    return $true
  } catch {
    return $false
  }
}

function Get-CodexMainProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction SilentlyContinue | Where-Object {
    -not $_.CommandLine -or $_.CommandLine -notmatch '(?:^|\s)--type='
  })
}

function Show-Message {
  param(
    [string]$Text,
    [string]$Title = 'Jira Codex 任务面板',
    [System.Windows.Forms.MessageBoxButtons]$Buttons = [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
  )

  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($Text, $Title, $Buttons, $Icon)
}

function Stop-CodexGracefully {
  param([object[]]$Processes)

  foreach ($processInfo in $Processes) {
    $process = Get-Process -Id $processInfo.ProcessId -ErrorAction SilentlyContinue
    if ($process) {
      $null = $process.CloseMainWindow()
    }
  }

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (@(Get-CodexMainProcesses).Count -eq 0) { return $true }
  }
  return $false
}

function Activate-CodexWindow {
  if (-not ('JiraCodexWindowActivator' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JiraCodexWindowActivator {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
  }

  $debugArgumentPattern = "(?:^|\s)--remote-debugging-port(?:=|\s+)$CdpPort(?:\s|$)"
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $processInfo = @(Get-CodexMainProcesses)
    $preferred = @($processInfo | Where-Object { $_.CommandLine -match $debugArgumentPattern })
    $candidates = if ($preferred.Count -gt 0) { $preferred } else { $processInfo }
    foreach ($candidate in $candidates) {
      $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
      if ($process -and $process.MainWindowHandle -ne [IntPtr]::Zero) {
        $null = [JiraCodexWindowActivator]::ShowWindowAsync($process.MainWindowHandle, 9)
        $null = [JiraCodexWindowActivator]::SetForegroundWindow($process.MainWindowHandle)
        return
      }
    }
    Start-Sleep -Milliseconds 250
  }
}

try {
  $cdpReady = Test-CdpEndpoint
  if (-not $cdpReady) {
    $codexProcesses = @(Get-CodexMainProcesses)
    if ($codexProcesses.Count -gt 0) {
      $message = 'Codex 已经以普通方式运行，当前进程没有 Jira 面板所需的本机调试参数。'
      if ($Background) {
        Write-LauncherStatus -State 'restart-required' -Message $message -ExitCode 2
        exit 2
      }

      $answer = Show-Message -Text "$message`r`n`r`n是否现在正常关闭并重新启动 Codex？`r`n已保存的对话不会丢失，但正在运行的任务会被中断。" -Buttons YesNo -Icon Warning
      if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
        Write-LauncherStatus -State 'restart-declined' -Message $message -ExitCode 2
        exit 2
      }

      if (-not (Stop-CodexGracefully -Processes $codexProcesses)) {
        $blockedMessage = 'Codex 仍在运行。请先从 Codex 菜单完全退出，再打开安装器创建的“Codex”快捷方式。安装器不会强制结束进程。'
        Write-LauncherStatus -State 'restart-blocked' -Message $blockedMessage -ExitCode 3
        $null = Show-Message -Text $blockedMessage -Icon Warning
        exit 3
      }
    }
  }

  New-Item -ItemType Directory -Path $ProfileDirectory -Force | Out-Null
  & (Join-Path $PSScriptRoot 'start-poc.ps1') -PanelPort $PanelPort -CdpPort $CdpPort -ProfileDirectory $ProfileDirectory

  if (-not (Test-CdpEndpoint)) {
    throw "Codex 已启动，但本机调试端口 $CdpPort 尚未就绪。"
  }

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$PanelPort/api/health" -TimeoutSec 2
  if (-not $health.ok) {
    throw "Jira 面板服务未能在端口 $PanelPort 正常启动。"
  }

  Write-LauncherStatus -State 'ready' -Message 'Codex 与 Jira 面板均已就绪。'
  if (-not $Background) {
    Activate-CodexWindow
  }
  exit 0
} catch {
  $errorMessage = $_.Exception.Message
  Write-LauncherStatus -State 'error' -Message $errorMessage -ExitCode 1
  if (-not $Background) {
    $null = Show-Message -Text "Jira Codex 任务面板启动失败：`r`n`r`n$errorMessage`r`n`r`n日志目录：$runtimeDirectory" -Icon Error
  }
  exit 1
}
