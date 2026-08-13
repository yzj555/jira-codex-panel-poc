[CmdletBinding()]
param([string]$OutputDirectory = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
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

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("jira-codex-release-{0}" -f ([Guid]::NewGuid().ToString('N')))
$archive = Join-Path $OutputDirectory "jira-codex-assistant-$version-win-x64.zip"
try {
  Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  $files = @(
    '.gitattributes', '.gitignore', 'README.md', 'install.cmd',
    'package.json', 'package-lock.json', 'server.mjs', 'injector.mjs',
    'jira-client.mjs', 'jxl-client.mjs', 'config-store.mjs'
  )
  $directories = @('public', 'inject', 'lib', 'mcp', 'scripts', 'installer', 'skills', 'plugins')
  foreach ($relative in $files) {
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination (Join-Path $stage $relative) -Force
  }
  foreach ($relative in $directories) {
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination (Join-Path $stage $relative) -Recurse -Force
  }
  $marketplaceSource = Join-Path $root '.agents\plugins\marketplace.json'
  $marketplaceDestination = Join-Path $stage '.agents\plugins'
  New-Item -ItemType Directory -Path $marketplaceDestination -Force | Out-Null
  Copy-Item -LiteralPath $marketplaceSource -Destination (Join-Path $marketplaceDestination 'marketplace.json') -Force

  foreach ($required in @(
    'install.cmd',
    'installer\update-bootstrap.ps1',
    'lib\update-manager.mjs',
    'mcp\ui\task-board.html',
    'plugins\jira-codex-assistant\.codex-plugin\plugin.json',
    '.agents\plugins\marketplace.json'
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $required) -PathType Leaf)) {
      throw "Release staging is missing required file: $required"
    }
  }

  $stageItems = @(Get-ChildItem -LiteralPath $stage -Force | ForEach-Object { $_.FullName })
  Compress-Archive -LiteralPath $stageItems -DestinationPath $archive -CompressionLevel Optimal -Force
  & node (Join-Path $root 'scripts\generate-update-manifest.mjs') $archive $OutputDirectory
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
