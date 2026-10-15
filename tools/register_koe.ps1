# Makes Windows open .koe project files with KoeStudio when you double-click them (current user only, no admin needed).
# The command runs app.py from this project folder with pythonw. Rerun it if the folder or Python moves.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\register_koe.ps1 [-Remove]
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$classes = 'HKCU:\Software\Classes'

if ($Remove) {
    Remove-Item "$classes\.koe", "$classes\KoeStudio.Project" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'Removed the .koe association'
} else {
    $pyw = Get-Command pythonw.exe -All -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -notmatch '\\WindowsApps\\' } | Select-Object -First 1
    if (-not $pyw) { $pyw = Get-Command pythonw.exe -ErrorAction Stop }
    New-Item "$classes\.koe" -Force | Out-Null
    Set-ItemProperty "$classes\.koe" -Name '(default)' -Value 'KoeStudio.Project'
    New-Item "$classes\KoeStudio.Project\shell\open\command" -Force | Out-Null
    Set-ItemProperty "$classes\KoeStudio.Project" -Name '(default)' -Value 'KoeStudio project'
    New-Item "$classes\KoeStudio.Project\DefaultIcon" -Force | Out-Null
    Set-ItemProperty "$classes\KoeStudio.Project\DefaultIcon" -Name '(default)' -Value ((Join-Path $root 'web\icon.ico') + ',0')
    Set-ItemProperty "$classes\KoeStudio.Project\shell\open\command" -Name '(default)' `
        -Value ('"{0}" "{1}" "%1"' -f $pyw.Source, (Join-Path $root 'app.py'))
    Write-Host 'Registered .koe files to open with KoeStudio'
}
# tell Explorer the associations changed
Add-Type -Namespace Koe -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);'
[Koe.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
