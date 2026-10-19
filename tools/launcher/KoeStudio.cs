// KoeStudio.exe: the launcher the shortcuts and the .koe association start. It runs app.py from its own folder
// with Python *inside this process* (python3XX.dll + Py_Main), so the window belongs to KoeStudio.exe: Task Manager,
// the taskbar, Open with and anything that looks programs up by process name see "KoeStudio", never pythonw.exe.
// No Python is bundled: it finds an install at start, so edits to app.py and web/ stay live.
// Build with tools\build_launcher.ps1 (.NET Framework csc.exe, x64, carries web\icon.ico).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("KoeStudio")]  // the name Task Manager shows
[assembly: AssemblyProduct("KoeStudio")]
[assembly: AssemblyDescription("KoeStudio drawing and painting")]
[assembly: AssemblyFileVersion("2.0.0.0")]

static class Launcher
{
    const uint LOAD_WITH_ALTERED_SEARCH_PATH = 8;  // the dll's own folder is searched for its dependencies

    [DllImport("kernel32", CharSet = CharSet.Auto, SetLastError = true)]
    static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);

    [DllImport("kernel32", CharSet = CharSet.Ansi, SetLastError = true)]
    static extern IntPtr GetProcAddress(IntPtr module, string name);

    [DllImport("kernel32", CharSet = CharSet.Auto, SetLastError = true)]
    static extern bool SetDllDirectory(string path);

    // int Py_Main(int argc, wchar_t **argv)
    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
    delegate int PyMain(int argc, [MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr, SizeParamIndex = 0)] string[] argv);

    static int Main(string[] args)
    {
        string exe = Assembly.GetExecutingAssembly().Location;
        string root = Path.GetDirectoryName(exe);
        string app = Path.Combine(root, "app.py");
        Environment.CurrentDirectory = root;
        if (!File.Exists(app)) return Fail("app.py was not found next to KoeStudio.exe.");

        List<string> homes = PythonHomes();
        // Python in this process: sys.executable is then KoeStudio.exe, so app.py must never start Python children
        // through it.
        foreach (string home in homes)
        {
            string dll = PythonDll(home);
            if (dll == null) continue;
            SetDllDirectory(home);
            IntPtr lib = LoadLibraryEx(dll, IntPtr.Zero, LOAD_WITH_ALTERED_SEARCH_PATH);
            if (lib == IntPtr.Zero) continue;  // e.g. a 32-bit Python: the dll must match this x64 process
            IntPtr main = GetProcAddress(lib, "Py_Main");
            if (main == IntPtr.Zero) continue;
            SetDllDirectory(null);
            Environment.SetEnvironmentVariable("PYTHONHOME", home);
            var argv = new List<string>();
            argv.Add(exe);
            argv.Add(app);
            argv.AddRange(args);
            var pyMain = (PyMain)Marshal.GetDelegateForFunctionPointer(main, typeof(PyMain));
            return pyMain(argv.Count, argv.ToArray());
        }
        // Last resort, when no install's dll loads: that install's pythonw.exe runs it (the window is then
        // pythonw.exe's), and this process waits so it still shows as the parent.
        foreach (string home in homes)
        {
            string pyw = Path.Combine(home, "pythonw.exe");
            if (!File.Exists(pyw)) continue;
            var info = new ProcessStartInfo(pyw);
            info.UseShellExecute = false;
            info.WorkingDirectory = root;
            info.Arguments = Quote(app);
            foreach (string a in args) info.Arguments += " " + Quote(a);
            using (Process p = Process.Start(info))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        return Fail("Python 3 was not found. Install it from python.org, then run: pip install pywebview");
    }

    // Python install folders: the PythonCore registry keys, PATH, the usual install folders. Only folders holding
    // python3XX.dll or a real pythonw.exe count, so never the install manager's Python\bin or the WindowsApps
    // aliases. Those with pywebview come first, then the newest.
    static List<string> PythonHomes()
    {
        var found = new List<string>();
        Action<string> add = delegate (string dir)
        {
            if (string.IsNullOrEmpty(dir)) return;
            try { dir = Path.GetFullPath(dir.Trim().Trim('"')).TrimEnd('\\'); } catch { return; }
            if (dir.IndexOf("WindowsApps", StringComparison.OrdinalIgnoreCase) >= 0) return;
            // a real install has its standard library next to it (the install manager's bin folder does not)
            if (!Directory.Exists(Path.Combine(dir, "Lib"))) return;
            if (!File.Exists(Path.Combine(dir, "pythonw.exe")) && PythonDll(dir) == null) return;
            if (!found.Exists(d => string.Equals(d, dir, StringComparison.OrdinalIgnoreCase))) found.Add(dir);
        };
        foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
            using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64))
            using (RegistryKey core = baseKey.OpenSubKey(@"Software\Python\PythonCore"))
            {
                if (core == null) continue;
                foreach (string ver in core.GetSubKeyNames())
                    using (RegistryKey key = core.OpenSubKey(ver + @"\InstallPath"))
                        if (key != null) add(key.GetValue("") as string);
            }
        foreach (string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) add(dir);
        var parents = new[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Python"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Python"),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            @"C:\",
        };
        foreach (string parent in parents)
        {
            if (!Directory.Exists(parent)) continue;
            try { foreach (string dir in Directory.GetDirectories(parent, "*ython*")) add(dir); } catch { }
        }
        found.Sort(delegate (string a, string b)
        {
            int c = HasWebview(b).CompareTo(HasWebview(a));
            return c != 0 ? c : Version(b).CompareTo(Version(a));
        });
        return found;
    }

    // python3XX.dll in the folder (not python3.dll, the stable-ABI forwarder, which has no Py_Main of its own)
    static string PythonDll(string dir)
    {
        try
        {
            foreach (string f in Directory.GetFiles(dir, "python3*.dll"))
                if (Regex.IsMatch(Path.GetFileName(f), @"^python3\d+\.dll$", RegexOptions.IgnoreCase)) return f;
        }
        catch { }
        return null;
    }

    static bool HasWebview(string home) { return Directory.Exists(Path.Combine(home, @"Lib\site-packages\webview")); }

    // 314 for python314.dll, 0 without one
    static int Version(string home)
    {
        string dll = PythonDll(home);
        int v;
        return dll != null && int.TryParse(Path.GetFileNameWithoutExtension(dll).Substring(6), out v) ? v : 0;
    }

    static string Quote(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }

    static int Fail(string message)
    {
        MessageBox.Show(message, "KoeStudio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }
}
