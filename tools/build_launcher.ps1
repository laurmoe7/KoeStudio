# Builds KoeStudio.exe (the launcher in the project folder) from tools\launcher\KoeStudio.cs with the .NET Framework
# compiler that comes with Windows. Rebuild after changing the source or web\icon.ico, then commit the exe.
# Close KoeStudio first: a running KoeStudio.exe cannot be replaced.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\build_launcher.ps1 [-Out <path>]
param([string]$Out)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Out) { $Out = Join-Path $root 'KoeStudio.exe' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw ".NET Framework 4 compiler not found at $csc" }
# x64: the python3XX.dll loaded into the process must match it
& $csc /nologo /optimize+ /target:winexe /platform:x64 "/out:$Out" "/win32icon:$(Join-Path $root 'web\icon.ico')" `
    /reference:System.Windows.Forms.dll (Join-Path $PSScriptRoot 'launcher\KoeStudio.cs')
if ($LASTEXITCODE) { throw "csc failed ($LASTEXITCODE)" }
Write-Host "Built $Out"
