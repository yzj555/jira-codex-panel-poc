[CmdletBinding()]
param([string]$OutputDirectory = '')

$ErrorActionPreference = 'Stop'
# Script lives in packages/codex/scripts/; the repo root is three levels up.
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'dist' }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$rootPath = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
if ($OutputDirectory.TrimEnd('\') -eq $rootPath -or
    -not $OutputDirectory.StartsWith("$rootPath\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDirectory must be a dedicated subdirectory of the repository root.'
}
$package = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'package.json version is not valid SemVer.' }

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("jira-workbench-release-{0}" -f ([Guid]::NewGuid().ToString('N')))
$archive = Join-Path $OutputDirectory "jira-workbench-assistant-$version-win-x64.zip"

function Copy-ReleaseTree {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$ExcludeDirectory
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($entry in @(Get-ChildItem -LiteralPath $Source -Force)) {
    if ($entry.PSIsContainer) {
      if ($entry.Name -in $ExcludeDirectory) { continue }
      Copy-ReleaseTree -Source $entry.FullName -Destination (Join-Path $Destination $entry.Name) -ExcludeDirectory $ExcludeDirectory
    } else {
      Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $Destination $entry.Name) -Force
    }
  }
}

try {
  Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  # Root files. install.cmd stays in packages/codex and is the install entry there.
  foreach ($relative in @('.gitattributes', '.gitignore', 'README.md', 'package.json', 'package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination (Join-Path $stage $relative) -Force
  }

  # Keep one release archive for the complete product. The Codex updater still
  # consumes this archive, while DSH users receive the matching Host + client
  # adapters and the exact same Core version from the same signed input.
  Copy-ReleaseTree -Source (Join-Path $root 'packages\core') -Destination (Join-Path $stage 'packages\core') -ExcludeDirectory @('test')
  Copy-ReleaseTree -Source (Join-Path $root 'packages\codex') -Destination (Join-Path $stage 'packages\codex') -ExcludeDirectory @('test', '.runtime', '.cdp-profile')
  Copy-ReleaseTree -Source (Join-Path $root 'packages\dsh') -Destination (Join-Path $stage 'packages\dsh') -ExcludeDirectory @('test')
  Copy-ReleaseTree -Source (Join-Path $root 'packages\dsh-client') -Destination (Join-Path $stage 'packages\dsh-client') -ExcludeDirectory @('test', 'node_modules')

  foreach ($required in @(
    'packages\codex\install.cmd',
    'package.json',
    'package-lock.json',
    'packages\codex\installer\update-bootstrap.ps1',
    'packages\codex\scripts\restart-codex-after-update.ps1',
    'packages\codex\lib\update-manager.mjs',
    'packages\core\mcp\ui\task-board.html',
    'packages\codex\plugins\jira-workbench-assistant\.codex-plugin\plugin.json',
    'packages\codex\.agents\plugins\marketplace.json',
    'packages\codex\server.mjs',
    'packages\codex\injector.mjs',
    'packages\core\index.mjs',
    'packages\dsh\plugin.mjs',
    'packages\dsh\cordis.patch.yml',
    'packages\dsh-client\index.mjs',
    'packages\dsh-client\lib\client.js'
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $required) -PathType Leaf)) {
      throw "Release staging is missing required file: $required"
    }
  }

  $stageItems = @(Get-ChildItem -LiteralPath $stage -Force | ForEach-Object { $_.FullName })
  Compress-Archive -LiteralPath $stageItems -DestinationPath $archive -CompressionLevel Optimal -Force
  & node (Join-Path $PSScriptRoot 'generate-update-manifest.mjs') $archive $OutputDirectory
  if ($LASTEXITCODE -ne 0) { throw "Manifest generator failed with exit code $LASTEXITCODE." }
  $sumFiles = @($archive, (Join-Path $OutputDirectory 'update-manifest.json'))
  $sumLines = $sumFiles | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([System.IO.Path]::GetFileName($_))"
  }
  $sumLines | Set-Content -LiteralPath (Join-Path $OutputDirectory 'SHA256SUMS.txt') -Encoding ASCII
  Write-Host "Release assets built in $OutputDirectory"
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
