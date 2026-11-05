"""Own and supervise the local backend independently of the desktop window."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import runtime_paths
from urllib.request import urlopen

def parent_alive(pid):
    if not pid:return True
    if os.name!='nt':
        try:os.kill(pid,0);return True
        except OSError:return False
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.restype=ctypes.c_void_p
    kernel.GetExitCodeProcess.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_ulong)]
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.OpenProcess(0x1000,False,pid)
    if not handle:return False
    code=ctypes.c_ulong()
    try:return bool(kernel.GetExitCodeProcess(handle,ctypes.byref(code))) and code.value==259
    finally:kernel.CloseHandle(handle)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',required=True);parser.add_argument('--port',type=int,default=8787);parser.add_argument('--parent',type=int,default=0)
    args=parser.parse_args();root=Path(__file__).resolve().parent;data=Path(args.data_dir).resolve();data.mkdir(parents=True,exist_ok=True)
    state=data/'desktop-state.json';stop=data/'desktop-stop';stop.unlink(missing_ok=True)
    port=args.port
    if not port:
        with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
    url=f'http://127.0.0.1:{port}';process=None;restarts=0;failures=0;owned=False;log=None
    def publish(status,error=''):
        value={'status':status,'url':url,'watchdog_pid':os.getpid(),'backend_pid':process.pid if process else None,'restarts':restarts,'error':error,'time':time.time()}
        temporary=state.with_suffix('.tmp');temporary.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');temporary.replace(state)
    def healthy():
        try:
            with urlopen(url+'/api/health',timeout=2) as response:
                value=json.load(response)
                return value.get('app')=='astra-agent' and value.get('workspace_id')==runtime_paths.workspace_id(data)
        except Exception:return False
    def terminate():
        if process and process.poll() is None:
            if os.name=='nt':subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            else:process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait()
    with socket.socket() as probe:
        try:probe.bind(('127.0.0.1',port))
        except OSError:
            if not healthy():
                with socket.socket() as available:
                    available.bind(('127.0.0.1',0));port=available.getsockname()[1]
                url=f'http://127.0.0.1:{port}'
    try:
        publish('starting')
        attached=healthy()
        while not stop.exists() and parent_alive(args.parent):
            if not attached and (process is None or process.poll() is not None):
                if process is not None:
                    restarts+=1
                    publish('recovering','后台进程已退出，正在重新启动')
                    time.sleep(min(10,restarts))
                (data/'logs').mkdir(exist_ok=True)
                log_path=data/'logs/backend.log'
                if log:log.close()
                if log_path.exists() and log_path.stat().st_size>2_000_000:log_path.replace(log_path.with_suffix('.old'))
                log=log_path.open('ab')
                process=subprocess.Popen([sys.executable,'-u',str(root/'server.py'),'--port',str(port),'--data-dir',str(data)],cwd=root,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONUTF8':'1'},creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));owned=True
                publish('starting');time.sleep(1)
            if healthy():
                failures=0;publish('ready')
            else:
                failures+=1;publish('recovering','等待后台服务恢复')
                if failures>=3:
                    if owned:terminate()
                    attached=False;process=None;failures=0;restarts+=1
                    publish('recovering','正在重启后台服务');time.sleep(min(15,1+restarts*2))
            time.sleep(1)
    finally:
        if owned:terminate()
        if log:log.close()
        publish('stopped')

if __name__=='__main__':main()
