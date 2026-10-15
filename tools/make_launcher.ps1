# Builds KoeStudio.exe in the project folder: a tiny windowless launcher that runs "pythonw app.py <arguments>".
# Windows lists real programs by name (Open with, Default apps), and KoeStudio itself is a Python script, so this
# stands in for it. It is git-ignored and holds no app code, so app.py changes need no rebuild; rebuild only if
# the folder or Python moves. Uses the C# compiler that ships with Windows.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\make_launcher.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$pyw = Get-Command pythonw.exe -All -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -notmatch '\\WindowsApps\\' } | Select-Object -First 1
if (-not $pyw) { $pyw = Get-Command pythonw.exe -ErrorAction Stop }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'The .NET Framework C# compiler was not found.' }

$lit = { param($s) '@"' + $s.Replace('"', '""') + '"' }
$src = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class KoeLauncher {
    static void Main(string[] args) {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string app = Path.Combine(dir, "app.py");
        var line = new StringBuilder("\"" + app + "\"");
        foreach (string a in args) line.Append(" \"" + a.Replace("\"", "\\\"") + "\"");
        var psi = new ProcessStartInfo($(& $lit $pyw.Source), line.ToString());
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process.Start(psi);
    }
}
"@
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'KoeLauncher.cs'
Set-Content -Path $tmp -Value $src -Encoding UTF8
$out = Join-Path $root 'KoeStudio.exe'
& $csc /nologo /target:winexe "/out:$out" "/win32icon:$(Join-Path $root 'web\icon.ico')" $tmp
if ($LASTEXITCODE -ne 0) { throw 'Compiling the launcher failed.' }
Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Host "Built $out"
