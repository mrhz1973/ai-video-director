# uninstall_gpu_power_tasks.ps1
#
# Removes ONLY the three AI Video Director GPU Power helper tasks:
#
#   \AI Video Director\GPU Power\ECO
#   \AI Video Director\GPU Power\BALANCED
#   \AI Video Director\GPU Power\NORMAL
#
# Idempotent: tasks that are already absent are reported and skipped.
# Never touches any other Scheduled Task. Run as Administrator:
#
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall_gpu_power_tasks.ps1

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: this uninstaller must run in an elevated (Administrator) PowerShell." -ForegroundColor Red
    exit 1
}

$taskPath = "\AI Video Director\GPU Power\"
$taskNames = @("ECO", "BALANCED", "NORMAL")

$removed = 0
$absent = 0
foreach ($name in $taskNames) {
    $existing = Get-ScheduledTask -TaskPath $taskPath -TaskName $name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskPath $taskPath -TaskName $name -Confirm:$false
        Write-Host "Removed  $taskPath$name"
        $removed++
    } else {
        Write-Host "Absent   $taskPath$name (nothing to do)"
        $absent++
    }
}

Write-Host ""
Write-Host "Result: $removed removed, $absent already absent."
exit 0
