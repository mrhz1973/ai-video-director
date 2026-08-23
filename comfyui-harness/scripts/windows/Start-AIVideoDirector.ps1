#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ConfigPath = "",
    [switch]$PauseOnError
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-lib.ps1')

try {
    Invoke-LauncherCli -Command 'start' -ConfigPath $(if ($ConfigPath) { $ConfigPath } else { Get-LauncherConfigPath })
} catch {
    Write-Host ""
    Write-Host ("[ERROR] " + $_.Exception.Message) -ForegroundColor Red
    if ($PauseOnError) {
        Wait-LauncherErrorPause
    }
    exit 1
}
