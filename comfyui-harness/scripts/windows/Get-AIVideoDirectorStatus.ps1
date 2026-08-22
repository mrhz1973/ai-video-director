#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ConfigPath = ""
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-lib.ps1')
Invoke-LauncherCli -Command 'status' -ConfigPath $(if ($ConfigPath) { $ConfigPath } else { Get-LauncherConfigPath })
