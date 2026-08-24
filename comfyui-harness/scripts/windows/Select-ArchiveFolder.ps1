# Select-ArchiveFolder.ps1
# Native Windows folder picker for AI Video Director archive destination.
# Exit 0 + path on stdout when OK; exit 2 when cancelled.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Seleziona la cartella Archivio locale Director"
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
  [Console]::Out.WriteLine($dialog.SelectedPath)
  exit 0
}
exit 2
