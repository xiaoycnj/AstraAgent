using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Runtime.InteropServices;
[assembly: System.Reflection.AssemblyTitle("AstraAgent")]
[assembly: System.Reflection.AssemblyVersion("3.0.1.0")]
[assembly: System.Reflection.AssemblyFileVersion("3.0.1.0")]
class Launcher {
 [DllImport("kernel32.dll")] static extern bool AttachConsole(uint process);
 [DllImport("kernel32.dll")] static extern bool AllocConsole();
 static readonly object LogLock=new object();
 static string Quote(string value) {
  var result=new StringBuilder("\"");int slashes=0;
  foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
  result.Append('\\',slashes*2);return result.Append('"').ToString();
 }
 static string OnPath(string name) {
  foreach(string directory in (Environment.GetEnvironmentVariable("PATH")??"").Split(Path.PathSeparator)){
   try{string candidate=Path.Combine(directory.Trim('"'),name);if(File.Exists(candidate))return candidate;}catch(ArgumentException){}
  }return null;
 }
 static string Python(bool cli,string root,out string prefix) {
  prefix="";string name=cli?"python.exe":"pythonw.exe";
  string bundled=Path.Combine(root,"runtimes","python",name);if(File.Exists(bundled))return bundled;
  foreach(RegistryKey registry in new[]{Registry.CurrentUser,Registry.LocalMachine}){
   using(var key=registry.OpenSubKey(@"SOFTWARE\Python\PythonCore\3.14\InstallPath")){
    string path=key==null?null:key.GetValue(null) as string;
    if(path!=null&&File.Exists(Path.Combine(path,name)))return Path.Combine(path,name);
   }
  }
  string py=OnPath("py.exe");if(py==null){string path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"py.exe");if(File.Exists(path))py=path;}
  if(py!=null){prefix="-3.14 ";return py;}
  throw new Exception("Lite requires CPython 3.14 x64 with Python Launcher. Install it from python.org, or use the Standard edition.");
 }
 [STAThread] static int Main(string[] args) {
  bool cli=false;
#if CLI
  cli=true;
#endif
  var arguments=new List<string>(args);
  if(arguments.Count>0&&arguments[0]=="--cli"){cli=true;arguments.RemoveAt(0);}
  if(cli){if(!AttachConsole(0xffffffff))AllocConsole();Console.OutputEncoding=new UTF8Encoding(false);Console.InputEncoding=Encoding.UTF8;}
  try{
   string root=AppDomain.CurrentDomain.BaseDirectory,prefix;
   string executable=Python(cli,root,out prefix),script=Path.Combine(root,cli?"cli.py":"desktop.py");
   if(!File.Exists(script))throw new Exception("Please extract the complete AstraAgent package before launching.");
   var start=new ProcessStartInfo(executable);start.WorkingDirectory=root;start.UseShellExecute=false;start.CreateNoWindow=!cli;
   start.Arguments=prefix+Quote(script);
   foreach(string arg in arguments)start.Arguments+=" "+Quote(arg);
   start.EnvironmentVariables["PYTHONUTF8"]="1";
   string log=null;
   if(!cli){string folder=Path.Combine(root,"data","logs");Directory.CreateDirectory(folder);log=Path.Combine(folder,"launcher.log");if(File.Exists(log)&&new FileInfo(log).Length>500000)File.WriteAllText(log,"");start.RedirectStandardOutput=true;start.RedirectStandardError=true;start.StandardOutputEncoding=Encoding.UTF8;start.StandardErrorEncoding=Encoding.UTF8;}
   using(var process=new Process()){
    process.StartInfo=start;
    if(!cli){DataReceivedEventHandler output=(sender,e)=>{if(e.Data!=null)lock(LogLock){File.AppendAllText(log,e.Data+Environment.NewLine,Encoding.UTF8);}};process.OutputDataReceived+=output;process.ErrorDataReceived+=output;}
    process.Start();if(!cli){process.BeginOutputReadLine();process.BeginErrorReadLine();}process.WaitForExit();
    if(!cli&&process.ExitCode!=0)MessageBox.Show("AstraAgent could not start. See "+log,"AstraAgent",MessageBoxButtons.OK,MessageBoxIcon.Error);
    return process.ExitCode;
   }
  }catch(Exception error){if(cli)Console.Error.WriteLine(error.Message);else MessageBox.Show(error.Message,"AstraAgent",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
 }
}
