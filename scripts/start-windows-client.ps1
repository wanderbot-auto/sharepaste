param(
  [string]$Server = "127.0.0.1:50052",
  [string]$StatePath = "",
  [string]$DeviceName = "sharepaste-windows",
  [switch]$ResetStaleState = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
  npm install
}

if ([string]::IsNullOrWhiteSpace($StatePath)) {
  $StatePath = Join-Path $repoRoot ".sharepaste-dev\windows-state.json"
}

$stateDir = Split-Path -Parent $StatePath
if (-not (Test-Path $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir | Out-Null
}

$env:SHAREPASTE_REPO_ROOT = $repoRoot
$env:SHAREPASTE_SERVER = $Server
$env:SHAREPASTE_STATE_PATH = $StatePath
$env:SHAREPASTE_DEVICE_NAME = $DeviceName
$env:SHAREPASTE_RESET_STALE_STATE = if ($ResetStaleState) { "1" } else { "0" }

Write-Host "Starting SharePaste Windows client..."
Write-Host "Repo:   $repoRoot"
Write-Host "Server: $env:SHAREPASTE_SERVER"
Write-Host "State:  $env:SHAREPASTE_STATE_PATH"

npm run desktop:windows:dev
