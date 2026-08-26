#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string]$ComfyRoot,
    [string]$ConfigPath = "",
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-lib.ps1')

$resolvedRuntimeRoot = (Resolve-Path -LiteralPath $RuntimeRoot).Path
$resolvedComfyRoot = (Resolve-Path -LiteralPath $ComfyRoot).Path
$resolvedConfig = if ($ConfigPath) { $ConfigPath } else { Get-LauncherConfigPath }

Invoke-LauncherCli -Command 'validate-runtime' -RuntimeRoot $resolvedRuntimeRoot -ConfigPath $resolvedConfig | Out-Null

$runtimeHarnessRoot = Join-Path $resolvedRuntimeRoot 'comfyui-harness'
if (-not (Test-Path -LiteralPath (Join-Path $runtimeHarnessRoot 'server.mjs'))) {
    throw "Stable runtime harness not found under $runtimeHarnessRoot"
}

$python = Join-Path $resolvedComfyRoot 'python_embeded\python.exe'
$mainPy = Join-Path $resolvedComfyRoot 'ComfyUI\main.py'
if (-not (Test-Path -LiteralPath $python)) {
    throw "ComfyUI python not found: $python"
}
if (-not (Test-Path -LiteralPath $mainPy)) {
    throw "ComfyUI main.py not found: $mainPy"
}

$configDir = Split-Path -Parent $resolvedConfig
if (-not (Test-Path -LiteralPath $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

$payload = [ordered]@{
    runtimeRoot = $resolvedRuntimeRoot
    comfyRoot = $resolvedComfyRoot
    openBrowser = (-not $NoBrowser.IsPresent)
    comfyTimeoutSeconds = 180
    directorTimeoutSeconds = 30
}
$json = ($payload | ConvertTo-Json -Depth 4) + "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($resolvedConfig, $json, $utf8NoBom)

$launcherScript = Join-Path $runtimeHarnessRoot 'scripts\windows\Start-AIVideoDirector.ps1'
if (-not (Test-Path -LiteralPath $launcherScript)) {
    throw "Stable runtime launcher script not found: $launcherScript"
}

$desktop = Get-DesktopFolderPath
$shortcutPath = Join-Path $desktop 'AI Video Director.lnk'
New-LauncherShortcut -ShortcutPath $shortcutPath -TargetScriptPath $launcherScript -WorkingDirectory $runtimeHarnessRoot

Write-Host "[OK] Wrote launcher config: $resolvedConfig"
Write-Host "[OK] Stable runtime root: $resolvedRuntimeRoot"
Write-Host "[OK] Created Desktop shortcut: $shortcutPath"
Write-Host "[OK] Shortcut launches stable runtime: $launcherScript"
