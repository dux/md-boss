# md-boss installer for Windows.
#
#   irm https://raw.githubusercontent.com/dux/md-boss/main/install.ps1 | iex
#
# To uninstall, or to pin a version, download it first and pass the flag:
#   iwr -useb https://raw.githubusercontent.com/dux/md-boss/main/install.ps1 -OutFile install.ps1
#   .\install.ps1 -Uninstall
#
# Nothing here needs an administrator. Invoke-WebRequest writes no Mark-of-the-Web, so the
# unsigned exe runs without a SmartScreen prompt - the reason the app is distributed this
# way rather than as a browser download.

#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch] $Uninstall,
  [string] $Version = $env:MD_BOSS_VERSION,
  [string] $Repo    = $(if ($env:MD_BOSS_REPO) { $env:MD_BOSS_REPO } else { 'dux/md-boss' })
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # Invoke-WebRequest is far faster without it

$Root      = Join-Path $env:LOCALAPPDATA 'MdBoss'
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\md-boss.lnk'

function Say  ($m) { Write-Host $m }
function Ok   ($m) { Write-Host $m -ForegroundColor Green }
function Warn ($m) { Write-Host $m -ForegroundColor Yellow }
function Die  ($m) { Write-Host "md-boss: $m" -ForegroundColor Red; exit 1 }

function Stop-Running {
  Get-Process md-boss -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# ---- user PATH, without clobbering what is already there

function Add-ToPath ($dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @($current -split ';' | Where-Object { $_ })
  if ($entries -contains $dir) { return $false }
  [Environment]::SetEnvironmentVariable('Path', (@($entries) + $dir) -join ';', 'User')
  return $true
}

function Remove-FromPath ($dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @($current -split ';' | Where-Object { $_ -and $_ -ne $dir })
  [Environment]::SetEnvironmentVariable('Path', $entries -join ';', 'User')
}

# ---- uninstall

if ($Uninstall) {
  Stop-Running
  if (Test-Path $Root)      { Remove-Item -Recurse -Force $Root }
  if (Test-Path $StartMenu) { Remove-Item -Force $StartMenu }
  Remove-FromPath $Root
  Ok 'md-boss removed.'
  Say 'Settings and sidebar roots stay in %USERPROFILE%\.config\md-boss - delete that folder too if you are done.'
  exit 0
}

# ---- what we are running on

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'ARM64') {
  Warn 'No native arm64 build yet - installing the x64 build, which Windows runs emulated.'
} elseif ($arch -ne 'AMD64') {
  Die "unsupported architecture $arch"
}
$target = 'windows-x64'

# ---- which release

if (-not $Version) {
  try {
    $Version = (Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{
      'User-Agent' = 'md-boss-installer'
    }).tag_name
  } catch {
    Die "could not reach github.com, or $Repo has no published release yet"
  }
}
$tag     = $Version
$version = $tag -replace '^v', ''

$asset = "md-boss-$version-$target.zip"
$base  = "https://github.com/$Repo/releases/download/$tag"

# ---- fetch and verify

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("md-boss-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  Say "md-boss $version ($target)"

  $zip = Join-Path $tmp $asset
  try { Invoke-WebRequest "$base/$asset" -OutFile $zip -UseBasicParsing }
  catch { Die "no $asset in release $tag" }

  $sums = Join-Path $tmp 'SHA256SUMS'
  try { Invoke-WebRequest "$base/SHA256SUMS" -OutFile $sums -UseBasicParsing }
  catch { Die "release $tag has no SHA256SUMS" }

  $want = (Get-Content $sums | ForEach-Object {
    $parts = $_ -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $asset) { $parts[0] }
  } | Select-Object -First 1)
  if (-not $want) { Die "$asset is not listed in SHA256SUMS" }

  $got = (Get-FileHash $zip -Algorithm SHA256).Hash
  if ($got -ne $want.ToUpper()) { Die "checksum mismatch for $asset - download corrupted, try again" }

  # ---- install

  Stop-Running
  if (Test-Path $Root) { Remove-Item -Recurse -Force $Root }
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Expand-Archive -Path $zip -DestinationPath $Root -Force
  Ok "installed $Root"

  if (Add-ToPath $Root) { Ok "added $Root to your PATH" }

  $wsh = New-Object -ComObject WScript.Shell
  $lnk = $wsh.CreateShortcut($StartMenu)
  $lnk.TargetPath       = Join-Path $Root 'md-boss.exe'
  $lnk.WorkingDirectory = $Root
  $lnk.Description      = 'A markdown viewer and editor that looks like paper'
  $lnk.Save()
  Ok 'added a Start Menu entry'
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ---- what the app still needs from the system

$missing = $false

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  $missing = $true
  Say ''
  Warn 'bun is not on PATH.'
  Say '  md-boss runs its backend with the locally installed bun. Install it:'
  Say '    powershell -c "irm bun.sh/install.ps1 | iex"'
  Say '  https://bun.sh'
}

# WebView2 is preinstalled on Windows 11 and on most Windows 10 machines, but not all.
$wv2 = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
if (-not (Test-Path $wv2)) {
  $missing = $true
  Say ''
  Warn 'The WebView2 runtime was not found.'
  Say '  md-boss draws in it. Install the Evergreen runtime:'
  Say '  https://developer.microsoft.com/microsoft-edge/webview2/'
}

Say ''
if ($missing) {
  Say 'Then reopen your terminal and run: md-boss .'
} else {
  Ok 'Done. Reopen your terminal and run: md-boss .'
}
