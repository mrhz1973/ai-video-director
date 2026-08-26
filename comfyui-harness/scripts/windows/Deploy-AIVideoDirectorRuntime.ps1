#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string]$ReleaseSha,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [string]$ConfigPath = "",
    [switch]$PlanOnly,
    [switch]$PauseOnError
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-lib.ps1')

try {
    $resolvedRuntimeRoot = (Resolve-Path -LiteralPath $RuntimeRoot).Path
    $resolvedConfig = if ($ConfigPath) { $ConfigPath } else { Get-LauncherConfigPath }
    $node = Get-NodeExecutable
    $cli = Join-Path $PSScriptRoot 'deploy-runtime-cli.mjs'
    $args = @(
        $cli,
        'deploy',
        '--runtime-root', $resolvedRuntimeRoot,
        '--release-sha', $ReleaseSha,
        '--expected-version', $ExpectedVersion,
        '--config', $resolvedConfig
    )
    if ($PlanOnly.IsPresent) {
        $args += '--plan-only'
    }
    & $node @args
    if ($LASTEXITCODE -ne 0) {
        throw "Deployment CLI exited with code $LASTEXITCODE"
    }
} catch {
    Write-Host ""
    Write-Host ("[ERROR] " + $_.Exception.Message) -ForegroundColor Red
    if ($PauseOnError) {
        Wait-LauncherErrorPause
    }
    exit 1
}
