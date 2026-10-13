# Creates KoeStudio shortcuts that run the app straight from this project folder (no build, no installer):
#   - "Run KoeStudio.lnk" in the project folder
#   - "KoeStudio.lnk" on the Desktop and in the Start menu (skip them with -LocalOnly)
# They start app.py with pythonw, so no console window appears. Rerun this if the folder or Python moves.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1 [-LocalOnly]
param([switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# Prefer a real pythonw.exe over the Microsoft Store alias in WindowsApps.
$pyw = Get-Command pythonw.exe -All -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -notmatch '\\WindowsApps\\' } | Select-Object -First 1
if (-not $pyw) { $pyw = Get-Command pythonw.exe -ErrorAction Stop }

$targets = @(Join-Path $root 'Run KoeStudio.lnk')
if (-not $LocalOnly) {
    $targets += Join-Path ([Environment]::GetFolderPath('Desktop')) 'KoeStudio.lnk'
    $targets += Join-Path ([Environment]::GetFolderPath('Programs')) 'KoeStudio.lnk'
}

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = $pyw.Source
    $lnk.Arguments = '"' + (Join-Path $root 'app.py') + '"'
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = (Join-Path $root 'web\icon.ico') + ',0'
    $lnk.Description = 'KoeStudio drawing program (runs from the project folder)'
    $lnk.Save()
    Write-Host "Created $path"
}
