# Creates KoeStudio shortcuts that run the app straight from this project folder (no build, no installer):
#   - "Run KoeStudio.lnk" in the project folder
#   - "KoeStudio.lnk" on the Desktop and in the Start menu (skip them with -LocalOnly)
# They start KoeStudio.exe, the small launcher in the project folder that runs app.py with Python inside its own
# process (no console window), so the window is KoeStudio.exe's and Task Manager and the taskbar show KoeStudio with its icon. Rerun this if the folder moves.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1 [-LocalOnly]
param([switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$exe = Join-Path $root 'KoeStudio.exe'
if (-not (Test-Path $exe)) { throw "KoeStudio.exe is missing from $root" }

$targets = @(Join-Path $root 'Run KoeStudio.lnk')
if (-not $LocalOnly) {
    $targets += Join-Path ([Environment]::GetFolderPath('Desktop')) 'KoeStudio.lnk'
    $targets += Join-Path ([Environment]::GetFolderPath('Programs')) 'KoeStudio.lnk'
}

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = $exe
    $lnk.Arguments = ''
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = (Join-Path $root 'web\icon.ico') + ',0'
    $lnk.Description = 'KoeStudio drawing program (runs from the project folder)'
    $lnk.Save()
    Write-Host "Created $path"
}
