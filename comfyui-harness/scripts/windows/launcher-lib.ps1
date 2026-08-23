function Get-HarnessRoot {
    param([string]$ScriptsDir = $PSScriptRoot)
    return (Resolve-Path (Join-Path $ScriptsDir '..\..')).Path
}

function Get-LauncherConfigPath {
    param([string]$ConfigPath = "")
    if ($ConfigPath) { return $ConfigPath }
    return Join-Path $env:LOCALAPPDATA 'AI Video Director\launcher.json'
}

function Get-NodeExecutable {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js was not found on PATH. Install Node >= 20 and retry."
    }
    return $node.Source
}

function Get-PowerShellLauncherExecutable {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    $powershell = Get-Command powershell -ErrorAction SilentlyContinue
    if ($powershell) { return $powershell.Source }
    throw "PowerShell was not found."
}

function Get-DesktopFolderPath {
  return [Environment]::GetFolderPath('Desktop')
}

function New-LauncherShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutPath,
        [Parameter(Mandatory = $true)][string]$TargetScriptPath,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [string]$IconLocation = ""
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $launcherExe = Get-PowerShellLauncherExecutable
    $shortcut.TargetPath = $launcherExe
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$TargetScriptPath`""
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.WindowStyle = 1
    if ($IconLocation) { $shortcut.IconLocation = $IconLocation }
    $shortcut.Save()
}

function Invoke-LauncherCli {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('start', 'status')][string]$Command,
        [string]$HarnessRoot = (Get-HarnessRoot),
        [string]$ConfigPath = (Get-LauncherConfigPath)
    )

    $node = Get-NodeExecutable
    $cli = Join-Path $PSScriptRoot 'launcher-cli.mjs'
    & $node $cli $Command --harness-root $HarnessRoot --config $ConfigPath
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
