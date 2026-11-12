"""Optional official DLC downloads; no install scripts, bounded archives, atomic payload swap."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import zipfile
import runtime_paths
import security_core
import updater

MAX_DOWNLOAD=2_000_000_000
MAX_EXPANDED=6_000_000_000
SLUG=re.compile(r'[a-z0-9][a-z0-9-]{0,63}')
ACTIVE=('resolving','downloading','verifying','installing')

class Cancelled(Exception):pass
class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        check_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def check_url(url):
    p=urlsplit(url)
    if p.scheme!='https' or p.hostname not in ('api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com') or p.username or p.password or p.port not in (None,443):
        raise ValueError('DLC 下载来源无效')

def open_official(url):
    check_url(url)
    return build_opener(OfficialRedirect()).open(Request(url,headers={'User-Agent':'AstraAgent-DLC','Accept':'application/vnd.github+json'}),timeout=25)

def release_tag(value):
    if value=='latest':return value
    updater.version(value)
    return 'v'+value.lstrip('v')

def read_json(path,limit=65536):
    if path.stat().st_size>limit:raise ValueError('DLC 元数据过大')
    return json.loads(path.read_text(encoding='utf-8'))

def linked(path):
    try:return path.is_symlink() or bool(getattr(path.lstat(),'st_file_attributes',0)&0x400)
    except FileNotFoundError:return False

def no_links(root,path):
    current=root
    if linked(current):raise ValueError('安装目录不能是链接')
    for part in path.relative_to(root).parts:
        current=current/part
        if linked(current):raise ValueError('安装目录包含链接')

def installed(root):
    paths=[root/'.local-stt/dlc.json']
    folder=root/'dlcs'
    if folder.is_dir() and not linked(folder):
        paths.extend(p/'dlc.json' for p in list(folder.iterdir())[:128] if SLUG.fullmatch(p.name))
    rows=[]
    for path in paths:
        try:
            no_links(root,path)
            value=read_json(path)
            if not SLUG.fullmatch(value.get('id','')):continue
            rows.append({'id':value['id'],'version':str(value.get('version',''))[:80],'path':path.parent.relative_to(root).as_posix()})
        except (OSError,ValueError,TypeError):continue
    return rows

def install(package,root,progress=lambda **kw:None,cancel=None):
    root=Path(root).resolve()
    def check_cancel():
        if cancel and cancel.is_set():raise Cancelled('已取消 DLC 下载')
    with tempfile.TemporaryDirectory(prefix='.astra-dlc-install-',dir=root) as folder:
        stage=Path(folder)/'payload'
        with zipfile.ZipFile(package) as archive:
            files={};total=0
            for info in archive.infolist():
                name=info.filename
                if '\\' in name or any(part in ('','.','..') for part in name.rstrip('/').split('/')):raise ValueError('DLC 路径无效')
                security_core.relative_path(name.rstrip('/'))
                mode=(info.external_attr>>16)&0o170000
                if mode not in (0,0o100000,0o040000) or info.flag_bits&1:raise ValueError('DLC 包含链接、特殊文件或加密文件')
                if info.is_dir():continue
                if name.casefold() in files:raise ValueError('DLC 包含重复路径')
                files[name.casefold()]=(name,info);total+=info.file_size
                if total>MAX_EXPANDED or len(files)>50000:raise ValueError('DLC 解压体积超过限制')
            manifests=[name for name,_ in files.values() if name.endswith('/dlc.json') and (name=='.local-stt/dlc.json' or re.fullmatch(r'dlcs/[a-z0-9-]+/dlc.json',name))]
            if len(manifests)!=1:raise ValueError('DLC 清单缺失或不唯一')
            manifest_path=manifests[0];payload=manifest_path.rsplit('/',1)[0]
            mi=archive.getinfo(manifest_path)
            if mi.file_size>65536:raise ValueError('DLC 清单过大')
            manifest=json.loads(archive.read(mi))
            ident=manifest.get('id','')
            if not SLUG.fullmatch(ident):raise ValueError('DLC ID 无效')
            if payload!=('.local-stt' if ident=='astra-local-stt-base' else 'dlcs/'+ident):raise ValueError('DLC 安装目录与 ID 不符')
            if manifest.get('platform')!='windows-x64':raise ValueError('DLC 平台不兼容')
            updater.version(manifest.get('version',''))
            if updater.version(manifest.get('minimum_app_version',''))>updater.version(runtime_paths.release_info(root)['version']):raise ValueError('请先更新 AstraAgent 再安装此 DLC')
            inventory_path=payload+'/file-integrity.json'
            inv_info=archive.getinfo(inventory_path)
            if inv_info.file_size>16_000_000:raise ValueError('DLC 文件清单过大')
            inventory=json.loads(archive.read(inv_info))
            names={name for name,_ in files.values()}
            if not isinstance(inventory,dict) or set(inventory)!=names-{inventory_path}:raise ValueError('DLC 文件清单不完整')
            if any(not (n.startswith(payload+'/') or (payload=='.local-stt' and n=='INSTALL-STT-DLC.txt')) for n in names):raise ValueError('DLC 试图写入安装目录之外')
            if shutil.disk_usage(root).free<total+64_000_000:raise ValueError('磁盘空间不足')
            progress(phase='verifying',message='正在校验 DLC 文件')
            for name,info in files.values():
                check_cancel()
                digest=hashlib.sha256()
                path=stage/name
                path.parent.mkdir(parents=True,exist_ok=True)
                with archive.open(info) as source,path.open('wb') as output:
                    while block:=source.read(1024*1024):
                        check_cancel();digest.update(block);output.write(block)
                if name!=inventory_path and digest.hexdigest()!=inventory[name]:raise ValueError('DLC 文件校验失败：'+name)
        check_cancel()
        target=root/payload;no_links(root,target)
        backup=root/'dlcs/.backups'/(ident+'-'+uuid.uuid4().hex)
        no_links(root,backup)
        progress(phase='installing',message='正在安装；请勿关闭应用')
        target.parent.mkdir(parents=True,exist_ok=True)
        existed=target.exists()
        if existed:
            backup.parent.mkdir(parents=True,exist_ok=True)
            os.replace(target,backup)
        try:os.replace(stage/payload,target)
        except BaseException:
            if existed:os.replace(backup,target)
            raise
        return {'id':ident,'version':manifest['version'],'path':payload,'backup':backup.relative_to(root).as_posix() if existed else None}

class Manager:
    def __init__(self,root):
        self.root=Path(root).resolve();self.lock=threading.RLock();self.cache={};self.job={'phase':'idle'};self.cancelled=threading.Event()
    def catalog(self,tag='latest'):
        tag=release_tag(tag)
        with self.lock:cached=self.cache.get(tag)
        if cached and time.monotonic()-cached[0]<300:release=cached[1]
        else:
            endpoint='latest' if tag=='latest' else 'tags/'+quote(tag,safe='')
            try:
                import release_feed
                release=release_feed.fetch(tag)
            except HTTPError as error:
                raise ValueError('GitHub 限流或拒绝访问，请稍后重试' if error.code in (403,429) else '未找到该发行版本或下载服务不可用') from error
            updater.version(release['tag_name'])
            if release.get('draft') or release.get('prerelease'):raise ValueError('仅支持正式发行版 DLC')
            with self.lock:
                if len(self.cache)>=16:self.cache.clear()
                self.cache[tag]=(time.monotonic(),release)
        rows=[]
        for asset in release.get('assets',[]):
            name=asset.get('name','');size=asset.get('size',0);digest=asset.get('digest','') or ''
            if not re.fullmatch(r'AstraAgent-[A-Za-z0-9._-]*DLC[A-Za-z0-9._-]*\.zip',name):continue
            url=asset.get('browser_download_url','')
            expected='https://github.com/'+updater.REPO+'/releases/download/'+release['tag_name']+'/'+name
            valid=type(size) is int and 0<size<=MAX_DOWNLOAD and re.fullmatch('sha256:[0-9a-f]{64}',digest) is not None and url==expected
            rows.append({'asset_id':asset['id'],'name':name,'size':size,'sha256':digest,'available':valid,'reason':'' if valid else '缺少官方 SHA-256 或体积/下载地址不符合要求','url':url})
        return {'release':release['tag_name'],'assets':rows,'installed':installed(self.root)}
    def status(self):
        with self.lock:return {**self.job,'installed':installed(self.root)}
    def update(self,**values):
        with self.lock:
            if values.get('phase')=='installing' and self.cancelled.is_set():raise Cancelled()
            self.job.update(values)
    def start(self,tag,asset_id):
        tag=release_tag(tag)
        if type(asset_id) is not int:raise ValueError('DLC 资产 ID 无效')
        with self.lock:
            if self.job['phase'] in ACTIVE:raise ValueError('已有 DLC 下载或安装任务')
            self.cancelled=threading.Event();self.job={'id':uuid.uuid4().hex,'phase':'resolving','message':'正在读取发行目录','received':0,'total':0}
            result=dict(self.job)
            threading.Thread(target=self.run,args=(tag,asset_id),daemon=False,name='Astra-DLC').start()
            return result
    def cancel(self):
        with self.lock:
            if self.job['phase']=='installing':raise ValueError('正在提交安装，暂时无法取消')
            if self.job['phase'] in ACTIVE:self.cancelled.set();self.job['message']='正在取消…'
            return dict(self.job)
    def run(self,tag,asset_id):
        try:
            catalog=self.catalog(tag)
            if self.cancelled.is_set():raise Cancelled()
            asset=next((a for a in catalog['assets'] if a['asset_id']==asset_id),None)
            if not asset or not asset['available']:raise ValueError('该版本没有可校验的指定 DLC')
            self.update(phase='downloading',message='正在下载 '+asset['name'],name=asset['name'],total=asset['size'])
            if shutil.disk_usage(self.root).free<asset['size']+64_000_000:raise ValueError('磁盘空间不足')
            with tempfile.TemporaryDirectory(prefix='.astra-dlc-download-',dir=self.root) as folder:
                package=Path(folder)/'dlc.zip';digest=hashlib.sha256();received=0
                with open_official(asset['url']) as response,package.open('wb') as output:
                    while block:=response.read(1024*1024):
                        if self.cancelled.is_set():raise Cancelled()
                        received+=len(block)
                        if received>asset['size']:raise ValueError('DLC 下载体积超出发行清单')
                        output.write(block);digest.update(block);self.update(received=received)
                if received!=asset['size'] or 'sha256:'+digest.hexdigest()!=asset['sha256']:raise ValueError('DLC 压缩包 SHA-256 校验失败')
                result=install(package,self.root,self.update,self.cancelled)
            self.update(phase='complete',message='DLC 安装完成',result=result)
        except PermissionError:self.update(phase='failed',message='安装目录被占用或不可写，请停止对应 DLC 服务并检查权限后重试。')
        except Cancelled:self.update(phase='cancelled',message='已取消，未安装 DLC')
        except Exception as error:self.update(phase='failed',message=str(error)[:1000])

_MANAGERS={}
_MANAGER_LOCK=threading.Lock()
def manager(root):
    key=str(Path(root).resolve())
    with _MANAGER_LOCK:
        if key not in _MANAGERS:_MANAGERS[key]=Manager(root)
        return _MANAGERS[key]
