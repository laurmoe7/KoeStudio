# Builds KoeStudio.exe in the project folder: a tiny windowless launcher that runs "pythonw app.py <arguments>" for the
# app.py next to it. Windows lists real programs by name (Open with, Default apps), and KoeStudio itself is a Python
# script, so this stands in for it. It finds pythonw.exe when it starts (PATH, then the Python install registry
# entries), so the same file works on any PC with Python and is committed to the repo. Rebuild only after changing
# this script. Uses the C# compiler that ships with Windows.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\make_launcher.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'The .NET Framework C# compiler was not found.' }

$src = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

static class KoeLauncher {
    static string FindPythonw() {
        foreach (string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
            try {
                if (dir.Length == 0 || dir.IndexOf("\\WindowsApps", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                string p = Path.Combine(dir.Trim().Trim('"'), "pythonw.exe");
                if (File.Exists(p)) return p;
            } catch { }
        }
        foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine }) {
            try {
                using (var core = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64).OpenSubKey(@"Software\Python\PythonCore")) {
                    if (core == null) continue;
                    foreach (string ver in core.GetSubKeyNames()) {
                        using (var ip = core.OpenSubKey(ver + @"\InstallPath")) {
                            string dir = ip == null ? null : ip.GetValue("") as string;
                            if (dir == null) continue;
                            string p = Path.Combine(dir, "pythonw.exe");
                            if (File.Exists(p)) return p;
                        }
                    }
                }
            } catch { }
        }
        return null;
    }

    [STAThread]
    static void Main(string[] args) {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string app = Path.Combine(dir, "app.py");
        string pyw = FindPythonw();
        if (pyw == null || !File.Exists(app)) {
            MessageBox.Show(pyw == null ? "KoeStudio needs Python (pythonw.exe), which was not found. Install Python from python.org and try again."
                                        : "app.py was not found next to KoeStudio.exe.", "KoeStudio");
            return;
        }
        var line = new StringBuilder("\"" + app + "\"");
        foreach (string a in args) line.Append(" \"" + a.Replace("\"", "\\\"") + "\"");
        var psi = new ProcessStartInfo(pyw, line.ToString());
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process.Start(psi);
    }
}
'@
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'KoeLauncher.cs'
Set-Content -Path $tmp -Value $src -Encoding UTF8
$out = Join-Path $root 'KoeStudio.exe'
& $csc /nologo /target:winexe "/out:$out" "/win32icon:$(Join-Path $root 'web\icon.ico')" /reference:System.Windows.Forms.dll $tmp
if ($LASTEXITCODE -ne 0) { throw 'Compiling the launcher failed.' }
Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Host "Built $out"
