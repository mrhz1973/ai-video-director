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

function Test-ConcretePowerShellExecutable {
    param([string]$Path)
    if (-not $Path) { return $false }
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $item) { return $false }
    if ($item.Length -le 0) { return $false }
  $normalized = $Path.Replace('/', '\')
  if ($normalized -match '\\Microsoft\\WindowsApps\\') { return $false }
    return $true
}

function Get-PowerShellLauncherExecutable {
    $candidates = @()

    $ps7 = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
    if (Test-ConcretePowerShellExecutable $ps7) {
        $candidates += $ps7
    }

    foreach ($cmd in Get-Command pwsh -All -ErrorAction SilentlyContinue) {
        if (Test-ConcretePowerShellExecutable $cmd.Source) {
            $candidates += $cmd.Source
        }
    }

    $ps51 = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-ConcretePowerShellExecutable $ps51) {
        $candidates += $ps51
    }

    foreach ($cmd in Get-Command powershell -All -ErrorAction SilentlyContinue) {
        if (Test-ConcretePowerShellExecutable $cmd.Source) {
            $candidates += $cmd.Source
        }
    }

    $unique = @($candidates | Select-Object -Unique)
    if ($unique.Count -gt 0) {
        return [string]$unique[0]
    }

    throw "No usable PowerShell executable was found. Install PowerShell 7 or ensure Windows PowerShell is available."
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
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$TargetScriptPath`" -PauseOnError"
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.WindowStyle = 1
    if ($IconLocation) { $shortcut.IconLocation = $IconLocation }
    $shortcut.Save()
}

function Invoke-LauncherCli {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('start', 'status', 'validate-runtime')][string]$Command,
        [string]$HarnessRoot = (Get-HarnessRoot),
        [string]$ConfigPath = (Get-LauncherConfigPath),
        [string]$RuntimeRoot = ""
    )

    $node = Get-NodeExecutable
    $cli = Join-Path $PSScriptRoot 'launcher-cli.mjs'
    $args = @($cli, $Command, '--harness-root', $HarnessRoot, '--config', $ConfigPath)
    if ($RuntimeRoot) {
        $args += @('--runtime-root', $RuntimeRoot)
    }
    & $node @args
    if ($LASTEXITCODE -ne 0) {
        throw "Launcher CLI exited with code $LASTEXITCODE"
    }
}

function Wait-LauncherErrorPause {
    Write-Host ""
    Write-Host "AI Video Director could not start."
    Write-Host "Press Enter to close this window."
    [void][System.Console]::ReadLine()
}
