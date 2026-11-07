"""MCP stdio client with initialization, tool pagination and serialized RPC."""
import atexit
import hashlib
import json
import runtime_paths
import security_core
import shutil
import secrets
import os
import queue
import re
import subprocess
import threading
import time
from pathlib import Path
from contextlib import nullcontext

CLIENTS={};LOCK=threading.RLock()


def resolved_argv(config):
    argv=runtime_paths.command_argv(Path(__file__).resolve().parent,[config['command'],*config['args']])
    executable=shutil.which(argv[0])
    if not executable:raise ValueError('MCP 可执行文件不存在')
    return [str(Path(executable).resolve()),*argv[1:]]


def fingerprint(config):
    argv=resolved_argv(config)
    paths=[Path(argv[0])]
    # Pin file arguments as well, so changing a Python/Node server script invalidates trust.
    paths.extend(Path(arg).resolve() for arg in argv[1:] if Path(arg).is_file())
    files=[]
    for path in paths:
        digest=hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
        files.append({'path':str(path),'sha256':digest.hexdigest()})
    return security_core.digest({'argv':argv,'files':files})


def trust(data, config, confirmed):
    current=fingerprint(config)
    if not isinstance(confirmed,str) or not secrets.compare_digest(current,confirmed):
        raise ValueError('MCP 命令或文件已变化，请重新确认完整命令')
    path=data/'mcp-trust.dpapi'
    with LOCK:
        trusted=json.loads(security_core.protect(path.read_bytes(),False)) if path.exists() else {}
        trusted[config['id']]=current
        security_core.atomic_write(path,security_core.protect(json.dumps(trusted).encode(),True))


def require_trust(data, config):
    path=data/'mcp-trust.dpapi'
    trusted=json.loads(security_core.protect(path.read_bytes(),False)) if path.exists() else {}
    if trusted.get(config['id'])!=fingerprint(config):
        stop(str(data.resolve())+':'+config['id'])
        raise ValueError('MCP 命令尚未信任或已变化，请在设置中确认连接')


def public_configs(data):
    rows=[]
    for item in configs(data):
        row=dict(item)
        try:
            row['fingerprint']=fingerprint(row)
            row['resolved_command']=resolved_argv(row)
        except (ValueError,OSError):row['fingerprint']=''
        rows.append(row)
    return rows


def protected_tools(data, config):
    require_trust(data,config)
    path=data/'mcp-tools.dpapi'
    cached=json.loads(security_core.protect(path.read_bytes(),False)) if path.exists() else {}
    entry=cached.get(config['id'],{})
    return entry.get('tools',[]) if entry.get('fingerprint')==fingerprint(config) else []

def configs(data):
    path=data/'mcp.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else []

def save(data,body):
    with LOCK:return _save(data,body)

def _save(data,body):
    rows=configs(data);key=body.get('id','')
    if not isinstance(key,str) or not re.fullmatch('[a-z][a-z0-9_-]{0,30}',key):raise ValueError('MCP ID 无效')
    if body.get('delete'):
        rows=[row for row in rows if row['id']!=key]
    else:
        command=body.get('command');args=body.get('args',[])
        if not isinstance(command,str) or not command or len(command)>1000 or not isinstance(args,list) or len(args)>50 or any(not isinstance(arg,str) or len(arg)>2000 for arg in args):raise ValueError('请输入可执行文件和参数数组')
        old=next((row for row in rows if row['id']==key),{})
        row={'id':key,'name':str(body.get('name',key))[:80],'command':command,'args':args,'enabled':bool(body.get('enabled',True)),'tools':old.get('tools',[]) if command==old.get('command') and args==old.get('args') else []}
        rows=[item for item in rows if item['id']!=key]+[row]
        if len(rows)>20:raise ValueError('最多配置 20 个 MCP 服务')
    with LOCK:
        stop(str(data.resolve())+':'+key)
        path=data/'mcp.json';tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(path)
    return rows

class Client:
    def __init__(self,config):
        argv=resolved_argv(config)
        self.process=subprocess.Popen(argv,cwd=Path(__file__).resolve().parent,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.messages=queue.Queue(maxsize=16);self.lock=threading.Lock();self.sequence=0
        threading.Thread(target=self.read,daemon=True).start()
        try:
            result=self.rpc('initialize',{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'AstraAgent','version':'2.0'}})
            if result.get('protocolVersion') not in ('2024-11-05','2025-03-26','2025-06-18','2025-11-25'):raise ValueError('MCP 协议版本不兼容')
            self.send({'jsonrpc':'2.0','method':'notifications/initialized'})
        except Exception:self.close();raise
    def read(self):
        try:
            while True:
                line=self.process.stdout.readline(2_000_001)
                if not line:break
                if len(line)>2_000_000:break
                try:self.messages.put(json.loads(line),timeout=1)
                except (ValueError,queue.Full):break
        except (OSError,ValueError):pass
        finally:
            try:self.messages.put_nowait({'disconnected':True})
            except queue.Full:pass
    def send(self,value):
        self.process.stdin.write((json.dumps(value)+'\n').encode());self.process.stdin.flush()
    def rpc(self,method,params):
        with self.lock:
            self.sequence+=1;key=self.sequence
            self.send({'jsonrpc':'2.0','id':key,'method':method,'params':params})
            deadline=time.monotonic()+45
            while True:
                try:message=self.messages.get(timeout=max(.1,deadline-time.monotonic()))
                except queue.Empty:self.close();raise ValueError('MCP 请求超时') from None
                if message.get('disconnected'):raise ValueError('MCP 服务已退出')
                if message.get('id')==key:
                    if 'error' in message:raise ValueError('MCP 返回错误 '+str(message['error'].get('message',''))[:200])
                    return message.get('result',{})
                if 'id' in message and 'method' in message:self.send({'jsonrpc':'2.0','id':message['id'],'error':{'code':-32601,'message':'Client requests not supported'}})
                if time.monotonic()>deadline:raise ValueError('MCP 请求超时')
    def close(self):
        if self.process.poll() is None:
            if os.name=='nt':subprocess.run(['taskkill','/PID',str(self.process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            else:self.process.terminate()
            try:self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:self.process.kill()
        for stream in (self.process.stdin,self.process.stdout):
            try:stream.close()
            except OSError:pass

def stop(key):
    client=CLIENTS.pop(key,None)
    if client:client.close()

def client(data,config):
    key=str(data.resolve())+':'+config['id']
    with LOCK:
        require_trust(data,config)
        existing=CLIENTS.get(key)
        if existing and existing.process.poll() is None:return existing
        CLIENTS[key]=Client(config)
        return CLIENTS[key]

def discover(data,key,confirmed=None):
    rows=configs(data);config=next((row for row in rows if row['id']==key),None)
    if not config or not config['enabled']:raise ValueError('MCP 服务未启用')
    if confirmed is not None:trust(data,config,confirmed)
    connection=client(data,config);tools=[];cursor=None
    for _ in range(20):
        result=connection.rpc('tools/list',{'cursor':cursor} if cursor else {})
        for tool in result.get('tools',[]):
            if not isinstance(tool.get('name'),str) or not isinstance(tool.get('inputSchema'),dict):continue
            digest=hashlib.sha256(tool['name'].encode()).hexdigest()[:8]
            alias=('mcp_'+key+'_'+re.sub('[^a-zA-Z0-9_]','_',tool['name']))[:52]+'_'+digest
            tools.append({'alias':alias,'name':tool['name'],'description':str(tool.get('description',''))[:2000],'schema':tool['inputSchema']})
            if len(tools)>=100:break
        cursor=result.get('nextCursor')
        if not cursor or len(tools)>=100:break
    config['tools']=tools
    with LOCK:
        current=configs(data)
        for row in current:
            if row['id']==key:
                if row['command']!=config['command'] or row['args']!=config['args']:raise ValueError('MCP 配置已变化，请重新连接')
                row['tools']=tools
        path=data/'mcp.json';tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(current,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(path)
        path=data/'mcp-tools.dpapi'
        cached=json.loads(security_core.protect(path.read_bytes(),False)) if path.exists() else {}
        cached[key]={'fingerprint':fingerprint(config),'tools':tools}
        security_core.atomic_write(path,security_core.protect(json.dumps(cached).encode(),True))
    return {'tools':tools,'count':len(tools)}

def definitions(data):
    tools=[]
    for row in configs(data):
        if not row['enabled']:continue
        try:cached=protected_tools(data,row)
        except (ValueError,OSError):continue
        tools.extend({'type':'function','function':{'name':tool['alias'],'description':'[MCP] '+tool['description'],'parameters':tool['schema']}} for tool in cached)
    return tools

def call(data,name,args,token=None):
    for row in configs(data):
        if not row['enabled']:continue
        try:cached=protected_tools(data,row)
        except (ValueError,OSError):continue
        for tool in cached:
            if tool['alias']==name:
                connection=client(data,row)
                with token.resource(connection.close) if token else nullcontext():
                    return connection.rpc('tools/call',{'name':tool['name'],'arguments':args})
    raise ValueError('MCP 工具不存在或服务已关闭')

@atexit.register
def close_all():
    for key in list(CLIENTS):stop(key)
