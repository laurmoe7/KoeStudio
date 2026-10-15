# Makes Windows open .koe project files with KoeStudio when you double-click them (current user only, no admin needed).
# The command runs app.py from this project folder with pythonw. Rerun it if the folder or Python moves.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\register_koe.ps1 [-Remove]
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$classes = 'HKCU:\Software\Classes'

if ($Remove) {
    Remove-Item "$classes\Applications\KoeStudio.exe", "$classes\.koe", "$classes\KoeStudio.Project" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item 'HKCU:\Software\KoeStudio' -Recurse -Force -ErrorAction SilentlyContinue
    Remove-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name 'KoeStudio' -ErrorAction SilentlyContinue
    Write-Host 'Removed the .koe association'
} else {
    $pyw = Get-Command pythonw.exe -All -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -notmatch '\\WindowsApps\\' } | Select-Object -First 1
    if (-not $pyw) { $pyw = Get-Command pythonw.exe -ErrorAction Stop }
    # An earlier "Open with > Always" choice (for example pythonw.exe, which would run the .koe file as a script)
    # outranks the association below, so clear it.
    $exts = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.koe'
    Remove-Item "$exts\UserChoice", "$exts\UserChoiceLatest", "$exts\OpenWithList", "$exts\OpenWithProgids" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$classes\koe_auto_file" -Recurse -Force -ErrorAction SilentlyContinue
    New-Item "$classes\.koe" -Force | Out-Null
    Set-ItemProperty "$classes\.koe" -Name '(default)' -Value 'KoeStudio.Project'
    New-Item "$classes\KoeStudio.Project\shell\open\command" -Force | Out-Null
    Set-ItemProperty "$classes\KoeStudio.Project" -Name '(default)' -Value 'KoeStudio project'
    New-Item "$classes\KoeStudio.Project\DefaultIcon" -Force | Out-Null
    Set-ItemProperty "$classes\KoeStudio.Project\DefaultIcon" -Name '(default)' -Value ((Join-Path $root 'web\icon.ico') + ',0')
    # Run the launcher when it exists, so Windows shows a program called KoeStudio;
    # otherwise start pythonw directly.
    $exe = Join-Path $root 'KoeStudio.exe'
    if (Test-Path $exe) { $cmd = '"{0}" "%1"' -f $exe }
    else { $cmd = '"{0}" "{1}" "%1"' -f $pyw.Source, (Join-Path $root 'app.py') }
    Set-ItemProperty "$classes\KoeStudio.Project\shell\open\command" -Name '(default)' -Value $cmd
    # Make "KoeStudio" a named choice in Open with and Settings > Default apps, so nobody has to browse to pythonw.exe
    # (picking that runs the .koe file as a script, which fails).
    New-Item "$classes\.koe\OpenWithProgids" -Force | Out-Null
    New-ItemProperty "$classes\.koe\OpenWithProgids" -Name 'KoeStudio.Project' -Value '' -PropertyType String -Force | Out-Null
    Set-ItemProperty "$classes\KoeStudio.Project" -Name 'FriendlyTypeName' -Value 'KoeStudio project'
    Set-ItemProperty "$classes\KoeStudio.Project\shell\open" -Name 'FriendlyAppName' -Value 'KoeStudio'
    New-Item 'HKCU:\Software\KoeStudio\Capabilities\FileAssociations' -Force | Out-Null
    Set-ItemProperty 'HKCU:\Software\KoeStudio\Capabilities' -Name 'ApplicationName' -Value 'KoeStudio'
    Set-ItemProperty 'HKCU:\Software\KoeStudio\Capabilities' -Name 'ApplicationDescription' -Value 'Drawing and painting program'
    Set-ItemProperty 'HKCU:\Software\KoeStudio\Capabilities\FileAssociations' -Name '.koe' -Value 'KoeStudio.Project'
    New-Item 'HKCU:\Software\RegisteredApplications' -Force | Out-Null
    Set-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name 'KoeStudio' -Value 'Software\KoeStudio\Capabilities'
    if (Test-Path $exe) {  # a named app in the Open with list
        $app = "$classes\Applications\KoeStudio.exe"
        New-Item "$app\shell\open\command" -Force | Out-Null
        Set-ItemProperty $app -Name 'FriendlyAppName' -Value 'KoeStudio'
        Set-ItemProperty "$app\shell\open\command" -Name '(default)' -Value $cmd
        New-Item "$app\SupportedTypes" -Force | Out-Null
        New-ItemProperty "$app\SupportedTypes" -Name '.koe' -Value '' -PropertyType String -Force | Out-Null
        New-Item "$classes\.koe\OpenWithList\KoeStudio.exe" -Force | Out-Null
    }
    Write-Host 'Registered .koe files to open with KoeStudio'
}
# tell Explorer the associations changed
Add-Type -Namespace Koe -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);'
[Koe.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
