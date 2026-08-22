#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ConfigPath = ""
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-lib.ps1')
Invoke-LauncherCli -Command 'start' -ConfigPath $(if ($ConfigPath) { $ConfigPath } else { Get-LauncherConfigPath })
