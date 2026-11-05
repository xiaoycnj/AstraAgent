"""Text workspace and persistent native shell sessions. Native shells are not sandboxes."""
import atexit
import base64,hashlib,json,os,queue,secrets,shutil,subprocess,threading,time
from pathlib import Path

TERMINALS={};LOCK=threading.Lock()
def file_path(data,name,root=None):
    root=Path(root).resolve() if root else (data/'files').resolve();root.mkdir(parents=True,exist_ok=True)
    if not isinstance(name,str) or not name or len(name)>240 or ':' in name or Path(name).is_absolute():raise ValueError('请使用工作区相对文件路径')
    path=(root/name).resolve()
    if path==root or not path.is_relative_to(root):raise ValueError('文件路径超出工作区')
    return path

def files(data,root=None):
    project_mode=bool(root);root=Path(root) if root else data/'files';root.mkdir(exist_ok=True);result=[]
    for folder,dirs,names in os.walk(root,followlinks=False):
        dirs[:]=[d for d in dirs if not (Path(folder)/d).is_symlink() and not getattr(Path(folder)/d,'is_junction',lambda:False)() and (not project_mode or d not in ('.git','node_modules','.venv','venv','__pycache__','.cache','dist','build'))]
        for name in names:
            p=Path(folder)/name
            if p.is_symlink():continue
            result.append({'path':str(p.relative_to(root)).replace('\\','/'),'size':p.stat().st_size})
            if len(result)>=500:return result
    return result

def read_file(data,name,root=None):
    p=file_path(data,name,root)
    if p.stat().st_size>500000:raise ValueError('编辑器最多打开 500 KB 的 UTF-8 文件')
    raw=p.read_bytes();return {'path':name,'content':raw.decode('utf-8'),'revision':hashlib.sha256(raw).hexdigest()}
def write_file(data,name,content,revision,root=None):
    p=file_path(data,name,root)
    if not isinstance(content,str) or len(content.encode())>500000:raise ValueError('最多保存 500 KB 文本')
    existing=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    if existing!=revision:raise FileExistsError('文件已在其他地方修改，请重新打开或另存为')
    p.parent.mkdir(parents=True,exist_ok=True);temp=p.with_suffix(p.suffix+'.'+secrets.token_hex(6)+'.tmp');temp.write_bytes(content.encode('utf-8'));temp.replace(p)
    return read_file(data,name,root)

def available_shells():
    choices=[('powershell',['powershell','-NoLogo','-NoProfile','-NonInteractive','-Command','-']),('pwsh',['pwsh','-NoLogo','-NoProfile','-NonInteractive','-Command','-']),('bash',['bash','--noprofile','--norc'])]
    return [(name,[shutil.which(argv[0]),*argv[1:]]) for name,argv in choices if shutil.which(argv[0])]
class Terminal:
    def __init__(self,argv,name,cwd):
        env={k:v for k,v in os.environ.items() if k.upper() in ('SYSTEMROOT','WINDIR','PATH','PATHEXT','COMSPEC','HOME','USERPROFILE','TEMP','TMP')};env.update(PYTHONIOENCODING='utf-8',TERM='dumb')
        self.process=subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));self.queue=queue.Queue(maxsize=128);self.lock=threading.Lock();self.name=name;self.updated=time.monotonic()
        def reader():
            for line in iter(lambda:self.process.stdout.readline(65536),b''):
                try:self.queue.put(line[:64000],timeout=2)
                except queue.Full:self.close();break
            try:self.queue.put_nowait(None)
            except queue.Full:pass
        threading.Thread(target=reader,daemon=True).start()
        if name in ('powershell','pwsh'):self.process.stdin.write(b'[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding\n');self.process.stdin.flush()
    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.write(b'\nexit\n');self.process.stdin.flush();self.process.stdin.close();self.process.wait(timeout=1)
            except (OSError,ValueError,subprocess.TimeoutExpired):
                if os.name=='nt':subprocess.run(['taskkill','/PID',str(self.process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                self.process.kill()
                try:self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:pass
    def execute(self,command):
        if not isinstance(command,str) or not command.strip() or len(command)>16000:raise ValueError('命令需为 1–16000 字符')
        if not self.lock.acquire(blocking=False):raise ValueError('终端正忙')
        try:
            if self.process.poll() is not None:raise ValueError('终端已关闭，请重新创建')
            marker='ASTRA_'+secrets.token_hex(20)
            if self.name in ('powershell','pwsh'):
                encoded=base64.b64encode(command.encode()).decode();script=f"$asCode=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}')); try {{ . ([ScriptBlock]::Create($asCode)) }} catch {{ Write-Output $_ }}; Write-Output '{marker}'\n"
            else:script=command+"\nprintf '\\n"+marker+"\\n'\n"
            self.process.stdin.write(script.encode());self.process.stdin.flush();output=[];size=0;deadline=time.monotonic()+30
            while time.monotonic()<deadline:
                try:line=self.queue.get(timeout=.2)
                except queue.Empty:continue
                if line is None:raise ValueError('Shell 已退出')
                text=line.decode('utf-8',errors='replace')
                if marker in text:self.updated=time.monotonic();return {'output':''.join(output),'alive':True}
                size+=len(line)
                if size>128000:self.close();return {'output':''.join(output)+'\n输出达到 128 KB，终端已停止。','alive':False}
                output.append(text)
            self.close();return {'output':''.join(output)+'\n命令超过 30 秒，终端已停止。','alive':False}
        finally:self.lock.release()

def start_terminal(data,name,acknowledged,root=None):
    if acknowledged is not True:raise ValueError('请先确认本机 Shell 权限')
    with LOCK:
        for key,term in list(TERMINALS.items()):
            if term.process.poll() is not None or time.monotonic()-term.updated>900:term.close();TERMINALS.pop(key,None)
        if len(TERMINALS)>=4:raise ValueError('最多创建 4 个终端，请先关闭现有终端')
        argv=next((a for n,a in available_shells() if n==name),None)
        if not argv:raise ValueError('此 Shell 不可用')
        root=Path(root) if root else data/'files';root.mkdir(parents=True,exist_ok=True);term=Terminal(argv,name,root);key=secrets.token_urlsafe(24);TERMINALS[key]=term
    return {'id':key,'shell':name,'cwd':str(root),'isolated':False}

@atexit.register
def close_terminals():
    for term in list(TERMINALS.values()):term.close()
