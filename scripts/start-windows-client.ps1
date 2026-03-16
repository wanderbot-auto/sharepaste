param(
  [string]$Server = "127.0.0.1:50052",
  [string]$StatePath = "",
  [string]$DeviceName = "sharepaste-windows",
  [switch]$ResetStaleState = $true
)

$ErrorActionPreference = "Stop"

function Test-CommandAvailable {
  param([Parameter(Mandatory = $true)][string]$Name)

  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Import-VisualStudioBuildTools {
  if (Test-CommandAvailable "link.exe") {
    return
  }

  $vswhereCandidates = @(
    "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe",
    "C:\Program Files\Microsoft Visual Studio\Installer\vswhere.exe"
  )

  $vswhere = $vswhereCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $vswhere) {
    throw "MSVC linker not found and vswhere.exe is unavailable. Install Visual Studio 2022 or Build Tools with the Desktop C++ workload."
  }

  $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vsPath)) {
    throw "MSVC linker not found. Install the Visual C++ build tools workload in Visual Studio 2022."
  }

  $devShellCandidates = @(
    (Join-Path $vsPath "Common7\Tools\VsDevCmd.bat"),
    (Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat")
  )

  $devShell = $devShellCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $devShell) {
    throw "Visual Studio was found at '$vsPath' but its developer shell scripts are missing."
  }

  Write-Host "Loading MSVC build tools from: $vsPath"

  $setOutput = & cmd.exe /s /c "`"$devShell`" -no_logo -arch=amd64 -host_arch=amd64 >nul && set"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to load Visual Studio developer environment from '$devShell'."
  }

  foreach ($line in $setOutput) {
    if ($line -match '^(.*?)=(.*)$') {
      [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
  }

  if (-not (Test-CommandAvailable "link.exe")) {
    throw "Visual Studio developer environment loaded, but link.exe is still unavailable on PATH."
  }
}

function Assert-WindowsSdkLibraries {
  $libRoots = @()
  if ($env:LIB) {
    $libRoots += ($env:LIB -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }

  $kernel32 = $libRoots |
    ForEach-Object { Join-Path $_ "kernel32.lib" } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

  if (-not $kernel32) {
    throw "Windows SDK libraries were not found. Install the Windows 10/11 SDK from Visual Studio Installer (Desktop development with C++), then rerun this script."
  }
}

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

Import-VisualStudioBuildTools
Assert-WindowsSdkLibraries

Write-Host "Starting SharePaste Windows client..."
Write-Host "Repo:   $repoRoot"
Write-Host "Server: $env:SHAREPASTE_SERVER"
Write-Host "State:  $env:SHAREPASTE_STATE_PATH"

npm run desktop:windows:dev
