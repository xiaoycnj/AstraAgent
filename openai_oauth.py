"""Loopback OAuth with PKCE and Windows-protected, application-owned credentials."""
import base64
import ctypes
from contextlib import contextmanager
from ctypes import wintypes
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlencode, urlsplit, parse_qs
from urllib.request import Request, build_opener, HTTPRedirectHandler

AUTH='https://auth.openai.com'
RESOURCE='https://api.openai.com/v1'
LOCK=threading.RLock()
MANAGERS={}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args):return None

def request_json(url,payload=None,form=False):
    data=(urlencode(payload).encode() if form else json.dumps(payload).encode()) if payload is not None else None
    headers={'Content-Type':'application/x-www-form-urlencoded' if form else 'application/json'}
    try:
        with build_opener(NoRedirect()).open(Request(url,data=data,headers=headers),timeout=30) as response:
            raw=response.read(2000001)
        if len(raw)>2000000:raise ValueError('OAuth 响应过大')
        return json.loads(raw)
    except Exception as error:
        raise ValueError('OpenAI 授权服务请求失败，请重新登录') from error

def decode(value):return base64.urlsafe_b64decode(value+'='*(-len(value)%4))

def validate_identity(token,client_id,nonce,jwks):
    head,body,signature=token.split('.')
    header=json.loads(decode(head));claims=json.loads(decode(body))
    if header.get('alg')!='RS256':raise ValueError('不支持的身份签名')
    key=next((k for k in jwks['keys'] if k.get('kid')==header.get('kid') and k.get('kty')=='RSA'),None)
    if not key:raise ValueError('身份签名密钥无效')
    modulus=int.from_bytes(decode(key['n']),'big');exponent=int.from_bytes(decode(key['e']),'big')
    width=(modulus.bit_length()+7)//8;sig=decode(signature)
    if width<256 or len(sig)!=width or int.from_bytes(sig,'big')>=modulus:raise ValueError('身份签名无效')
    digest=bytes.fromhex('3031300d060960864801650304020105000420')+hashlib.sha256((head+'.'+body).encode()).digest()
    expected=b'\x00\x01'+b'\xff'*(width-len(digest)-3)+b'\x00'+digest
    actual=pow(int.from_bytes(sig,'big'),exponent,modulus).to_bytes(width,'big')
    audience=claims.get('aud');audience=[audience] if isinstance(audience,str) else audience
    if not hmac.compare_digest(actual,expected) or claims.get('iss')!=AUTH or not audience or client_id not in audience:
        raise ValueError('身份签名或受众无效')
    if len(audience)>1 and claims.get('azp')!=client_id:raise ValueError('身份客户端无效')
    if claims.get('exp',0)<=time.time() or claims.get('iat',0)>time.time()+60 or not claims.get('sub'):
        raise ValueError('身份令牌已过期或无效')
    if nonce is not None and not hmac.compare_digest(str(claims.get('nonce','')),nonce):raise ValueError('身份 nonce 无效')
    return claims

def protect(raw,encrypt):
    if os.name!='nt':raise ValueError('本版本 OAuth 凭证存储需要 Windows DPAPI')
    class Blob(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
    buffer=ctypes.create_string_buffer(raw);source=Blob(len(raw),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)));target=Blob()
    crypt=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    function=crypt.CryptProtectData if encrypt else crypt.CryptUnprotectData
    function.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    if not function(ctypes.byref(source),None,None,None,None,1,ctypes.byref(target)):
        raise ValueError('无法访问 Windows 加密凭证')
    try:return ctypes.string_at(target.data,target.size)
    finally:
        kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree(target.data)

class Manager:
    def __init__(self,data):
        self.data=Path(data);self.lock=threading.RLock();self.pending=None;self.error='';self.server=None
    @property
    def path(self):return self.data/'openai-oauth.dpapi'
    def read(self):
        return json.loads(protect(self.path.read_bytes(),False)) if self.path.exists() else {}
    @contextmanager
    def file_lock(self):
        self.data.mkdir(parents=True,exist_ok=True)
        if os.name!='nt':raise ValueError('OAuth 凭证存储需要 Windows')
        import msvcrt
        with (self.data/'openai-oauth.lock').open('a+b') as stream:
            if stream.tell()==0:stream.write(b'0');stream.flush()
            stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_LOCK,1)
            try:yield
            finally:stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
    def write(self,value):
        with self.file_lock():self._write(value)
    def _write(self,value):
        self.data.mkdir(parents=True,exist_ok=True)
        temporary=self.path.with_suffix('.tmp');temporary.write_bytes(protect(json.dumps(value).encode(),True));temporary.replace(self.path)
    def status(self):
        with self.lock:
            try:account=self.read()
            except (OSError,ValueError):return {'connected':False,'error':'无法解密此设备的 OAuth 凭证，请重新登录'}
            return {'connected':bool(account),'email':account.get('email',''),'pending':self.pending is not None,'error':self.error}
    def cancel(self,expected=None):
        with self.lock:
            if expected is not None and self.server is not expected:return
            self.pending=None;server=self.server;self.server=None
        if server:server.shutdown();server.server_close()
    def begin(self,body):
        client=body.get('client_id','')
        if not isinstance(client,str):raise ValueError('client ID 格式无效')
        client=client.strip()
        if not client or len(client)>300:raise ValueError('请填写为 AstraAgent 注册的 OAuth client ID')
        callback=body.get('redirect_uri','http://127.0.0.1:1455/auth/callback')
        if not isinstance(callback,str) or len(callback)>2000:raise ValueError('回调地址格式无效')
        parsed=urlsplit(callback)
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or parsed.path!='/auth/callback' or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('回调必须为 http://127.0.0.1:端口/auth/callback')
        port=parsed.port
        if not port or not 1024<=port<=65535:raise ValueError('回调端口应为 1024–65535')
        self.cancel();manager=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                try:
                    if self.headers.get('Host')!=f'127.0.0.1:{port}' or len(self.path)>8192 or urlsplit(self.path).path!='/auth/callback':raise ValueError('回调无效')
                    manager.complete(parse_qs(urlsplit(self.path).query))
                    text='AstraAgent sign-in completed. You can close this window.'
                    code=200
                except Exception:
                    text='AstraAgent sign-in failed. Return to the app to retry.';code=400
                self.send_response(code);self.send_header('Content-Type','text/plain; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(text.encode())
        verifier=secrets.token_urlsafe(48)
        self.data.mkdir(parents=True,exist_ok=True)
        host_path=self.data/'openai-host-id'
        with self.file_lock():
            if not host_path.exists():host_path.write_text(secrets.token_urlsafe(32),encoding='ascii')
            host_id=host_path.read_text(encoding='ascii').strip()
        server=ThreadingHTTPServer(('127.0.0.1',port),Handler);server.daemon_threads=True
        with self.lock:
            self.error='';self.server=server
            self.pending={'state':secrets.token_urlsafe(32),'nonce':secrets.token_urlsafe(32),'verifier':verifier,'client_id':client,'redirect_uri':callback,'deadline':time.time()+300}
            params={'ext_agent_host_id':host_id,'client_id':client,'response_type':'code','redirect_uri':callback,'scope':'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct','resource':RESOURCE,'state':self.pending['state'],'nonce':self.pending['nonce'],'code_challenge':base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),'code_challenge_method':'S256'}
        threading.Thread(target=server.serve_forever,daemon=True).start()
        def expire():
            with self.lock:active=self.server is server
            if active:self.cancel(server)
        timer=threading.Timer(300,expire);timer.daemon=True;timer.start()
        return {'authorization_url':AUTH+'/api/accounts/authorize?'+urlencode(params)}
    def identity(self,token,client,nonce):
        discovery=request_json(AUTH+'/.well-known/openid-configuration')
        if discovery.get('issuer')!=AUTH or urlsplit(discovery.get('jwks_uri','')).hostname!='auth.openai.com' or urlsplit(discovery['jwks_uri']).scheme!='https':raise ValueError('OpenID 配置无效')
        return validate_identity(token,client,nonce,request_json(discovery['jwks_uri']))
    def complete(self,query):
        with self.lock:
            pending=self.pending;server=self.server
            if not pending or time.time()>pending['deadline'] or not hmac.compare_digest(query.get('state',[''])[0],pending['state']):raise ValueError('授权状态无效')
            self.pending=None
            try:
                if query.get('error'):raise ValueError('用户取消或服务拒绝授权')
                code=query.get('code',[''])[0]
                if not code:raise ValueError('缺少授权码')
                token=request_json(AUTH+'/api/accounts/oauth/token',{'grant_type':'authorization_code','client_id':pending['client_id'],'redirect_uri':pending['redirect_uri'],'code_verifier':pending['verifier'],'code':code,'resource':RESOURCE},True)
                claims=self.identity(token['id_token'],pending['client_id'],pending['nonce'])
                self.write({**token,'client_id':pending['client_id'],'expires_at':time.time()+int(token.get('expires_in',3600)),'email':claims.get('email',''),'sub':claims['sub']})
            except Exception:
                self.error='登录未完成，请检查 client ID、回调配置和账户授权后重试';raise
            finally:threading.Thread(target=lambda:self.cancel(server),daemon=True).start()
    def access_token(self):
        with self.lock,self.file_lock():
            account=self.read()
            if not account:raise ValueError('请先使用 OpenAI OAuth 登录')
            if account['expires_at']<time.time()+60:
                if not account.get('refresh_token'):raise ValueError('登录已过期，请重新授权')
                token=request_json(AUTH+'/api/accounts/oauth/token',{'grant_type':'refresh_token','client_id':account['client_id'],'refresh_token':account['refresh_token'],'resource':RESOURCE},True)
                if token.get('id_token'):
                    claims=self.identity(token['id_token'],account['client_id'],None)
                    if claims['sub']!=account['sub']:raise ValueError('刷新后的账户身份不一致')
                account.update(token);account['expires_at']=time.time()+int(token.get('expires_in',3600));self._write(account)
            return account['access_token']
    def logout(self):
        self.cancel()
        with self.lock,self.file_lock():self.path.unlink(missing_ok=True);self.error=''
        return {'connected':False}

def manager(data):
    with LOCK:return MANAGERS.setdefault(str(Path(data).resolve()),Manager(data))
