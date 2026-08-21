# install_gpu_power_tasks.ps1
#
# One-time manual installer for the AI Video Director GPU Power helper tasks.
# Run ONCE from an elevated (Administrator) PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File scripts\install_gpu_power_tasks.ps1
#
# Creates exactly three on-demand Scheduled Tasks whose action is a DIRECT
# nvidia-smi.exe call with fixed arguments (no shell, no script wrapper):
#
#   \AI Video Director\GPU Power\ECO       -> nvidia-smi.exe -i 0 -pl 100
#   \AI Video Director\GPU Power\BALANCED  -> nvidia-smi.exe -i 0 -pl 130
#   \AI Video Director\GPU Power\NORMAL    -> nvidia-smi.exe -i 0 -pl 170
#
# Security constraints (by design):
# - No parameters: executable path, GPU index, wattages and task names are fixed.
# - No triggers: the tasks exist for explicit on-demand execution only.
# - No credentials are prompted for or stored (InteractiveToken principal).
# - nvidia-smi.exe is resolved only from trusted system/NVIDIA locations.

$ErrorActionPreference = "Stop"

# --- Require Administrator -------------------------------------------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: this installer must run in an elevated (Administrator) PowerShell." -ForegroundColor Red
    Write-Host "Open PowerShell with 'Run as administrator' and run the script again."
    exit 1
}

# --- Resolve nvidia-smi.exe from trusted locations only ---------------------
$trustedCandidates = @(
    (Join-Path $env:SystemRoot "System32\nvidia-smi.exe"),
    (Join-Path $env:ProgramFiles "NVIDIA Corporation\NVSMI\nvidia-smi.exe")
)
$nvidiaSmi = $null
foreach ($candidate in $trustedCandidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $nvidiaSmi = $candidate
        break
    }
}
if (-not $nvidiaSmi) {
    Write-Host "ERROR: nvidia-smi.exe was not found in a trusted location:" -ForegroundColor Red
    $trustedCandidates | ForEach-Object { Write-Host "  $_" }
    Write-Host "Install/repair the NVIDIA driver, then run this installer again."
    exit 1
}
Write-Host "Using nvidia-smi: $nvidiaSmi"

# --- Fixed task definitions (never override from input) ---------------------
$taskPath = "\AI Video Director\GPU Power\"
$tasks = @(
    @{ Name = "ECO";      Watts = 100 },
    @{ Name = "BALANCED"; Watts = 130 },
    @{ Name = "NORMAL";   Watts = 170 }
)

$taskPrincipal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 1) `
    -Compatibility Win8

foreach ($task in $tasks) {
    $arguments = "-i 0 -pl $($task.Watts)"
    $action = New-ScheduledTaskAction -Execute $nvidiaSmi -Argument $arguments
    Register-ScheduledTask `
        -TaskPath $taskPath `
        -TaskName $task.Name `
        -Action $action `
        -Principal $taskPrincipal `
        -Settings $taskSettings `
        -Force | Out-Null
    Write-Host "Installed $taskPath$($task.Name)  ->  nvidia-smi.exe $arguments"
}

Write-Host ""
Write-Host "Done. The harness GPU Power panel can now switch modes without UAC."
Write-Host "To remove the tasks later run scripts\uninstall_gpu_power_tasks.ps1 as Administrator."
exit 0
