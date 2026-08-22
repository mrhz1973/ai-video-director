#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ComfyRoot,
    [string]$ConfigPath = "",
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-lib.ps1')

$HarnessRoot = Get-HarnessRoot
$resolvedConfig = if ($ConfigPath) { $ConfigPath } else { Get-LauncherConfigPath }
$resolvedComfyRoot = (Resolve-Path -LiteralPath $ComfyRoot).Path

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
    comfyRoot = $resolvedComfyRoot
    openBrowser = (-not $NoBrowser.IsPresent)
    comfyTimeoutSeconds = 180
    directorTimeoutSeconds = 30
}
$payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $resolvedConfig -Encoding UTF8

$launcherScript = Join-Path $PSScriptRoot 'Start-AIVideoDirector.ps1'
$desktop = Get-DesktopFolderPath
$shortcutPath = Join-Path $desktop 'AI Video Director.lnk'
New-LauncherShortcut -ShortcutPath $shortcutPath -TargetScriptPath $launcherScript -WorkingDirectory $HarnessRoot

Write-Host "[OK] Wrote launcher config: $resolvedConfig"
Write-Host "[OK] Created Desktop shortcut: $shortcutPath"
Write-Host "[OK] Shortcut launches: $launcherScript"
