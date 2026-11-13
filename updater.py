"""Official-release updater. The isolated helper owns download, transaction and rollback."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.request import Request, build_opener
import zipfile
import release_feed

REPO='xiaoycnj/AstraAgent'
ROOT=Path(__file__).resolve().parent

def version(value):
    import re
    if not re.fullmatch(r'v?\d+\.\d+\.\d+',value):raise ValueError('不支持的版本号')
    return tuple(map(int,value.lstrip('v').split('.')))

def latest(root=ROOT):
    import runtime_paths
    local=runtime_paths.release_info(root)
    import release_feed
    release=release_feed.fetch()
    tag=release['tag_name'];edition=local['edition']
    name=f'AstraAgent-V{tag.lstrip("v")}-{edition}-win-x64.zip'
    asset=next((a for a in release.get('assets',[]) if a['name']==name),None)
    return {'current':local['version'],'version':tag,'available':version(tag)>version(local['version']),
            'can_install':edition in ('standard','lite') and not (root/'.git').exists(),
            'asset':asset,'page':release['html_url'],'notes':release.get('body','')[:12000]}

def checked_members(archive):
    import security_core
    names=set();total=0;members=[]
    for info in archive.infolist():
        if info.is_dir():continue
        parts=info.filename.split('/')
        if parts[0]!='AstraAgent' or len(parts)<2:raise ValueError('发行包根目录无效')
        relative='/'.join(parts[1:]);security_core.relative_path(relative)
        if relative.casefold() in names or (info.external_attr>>16)&0o170000==0o120000:raise ValueError('发行包含重复路径或链接')
        names.add(relative.casefold());total+=info.file_size
        if total>3_000_000_000 or len(names)>50000:raise ValueError('发行包超过安全限制')
        root_name=parts[1].casefold()
        if root_name in ('data','.git','work','output','outputs') or Path(relative).suffix.casefold()=='.dpapi' or Path(relative).name.casefold()=='.env':
            raise ValueError('发行包含私有数据')
        if root_name=='memory' and relative.casefold()!='memory/readme.md':raise ValueError('发行包含私有记忆')
        members.append((info,relative))
    return members

def install(package,target,progress=lambda text:None):
    target=Path(target).absolute()
    for candidate in (target,*target.parents):
        if candidate.is_symlink() or getattr(candidate,'is_junction',lambda:False)():
            raise ValueError('更新目标路径不能包含链接')
    target=target.resolve()
    if (target/'.git').exists():raise ValueError('源码工作区不支持覆盖更新')
    temporary=tempfile.mkdtemp(prefix='.astra-update-',dir=target.parent)
    try:
        stage=Path(temporary)/'stage';backup=Path(temporary)/'backup';changed=[]
        with zipfile.ZipFile(package) as archive:
            members=checked_members(archive)
            inventory=json.loads(archive.read('AstraAgent/file-integrity.json'))
            if set(inventory)!={relative for _,relative in members if relative!='file-integrity.json'}:raise ValueError('发行包文件清单不完整')
            for info,relative in members:
                raw=archive.read(info)
                if relative!='file-integrity.json' and hashlib.sha256(raw).hexdigest()!=inventory[relative]:raise ValueError('文件校验失败')
                path=stage/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        try:
            for _,relative in members:
                destination=target/relative
                current=target
                for part in Path(relative).parts:
                    current=current/part
                    if current.is_symlink() or getattr(current,'is_junction',lambda:False)():raise ValueError('安装目录包含链接')
                old=backup/relative
                if destination.exists():old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(destination,old)
                existed=destination.exists()
                destination.parent.mkdir(parents=True,exist_ok=True)
                os.replace(stage/relative,destination)
                changed.append((destination,old,existed))
                progress('正在安装 '+relative)
        except BaseException:
            for destination,old,existed in reversed(changed):
                if existed:os.replace(old,destination)
                else:destination.unlink(missing_ok=True)
            raise
        shutil.rmtree(temporary)
    finally:
        # Failed transactions retain the backup for recovery.
        if not any((Path(temporary)/'backup').rglob('*')):shutil.rmtree(temporary,ignore_errors=True)

def launch(data,parent):
    # Copy the interpreter and native GUI libraries out of the installation before replacing it.
    folder=Path(tempfile.mkdtemp(prefix='astra-updater-'))
    for name in ('updater.py','release_feed.py','native_frame.py','security_core.py','openai_oauth.py','runtime_paths.py','watchdog.py'):
        shutil.copy2(ROOT/name,folder/name)
    shutil.copytree(ROOT/'vendor_desktop',folder/'vendor_desktop')
    if (ROOT/'runtimes/webview2').exists():shutil.copytree(ROOT/'runtimes/webview2',folder/'webview2')
    executable=Path(sys.executable)
    if executable.is_relative_to(ROOT):
        shutil.copytree(executable.parent,folder/'python');executable=folder/'python'/executable.name
        for pth in (folder/'python').glob('*._pth'):
            pth.write_text('python314.zip\n.\n..\n../vendor_desktop\nLib/site-packages\nimport site\n',encoding='utf-8')
    shutil.copy2(ROOT/'web/assets/startup/update.html',folder/'update.html')
    process=subprocess.Popen([str(executable),str(folder/'updater.py'),'--worker',str(ROOT),str(data),str(parent)],cwd=folder,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    (folder/'owner.json').write_text(json.dumps({'pid':process.pid,'root':str(ROOT)}),encoding='utf-8')

def cleanup(root):
    import watchdog
    temporary=Path(tempfile.gettempdir()).resolve()
    for folder in temporary.glob('astra-updater-*'):
        try:
            resolved=folder.resolve()
            if not resolved.is_relative_to(temporary) or resolved==temporary or folder.is_symlink():continue
            owner=json.loads((folder/'owner.json').read_text(encoding='utf-8'))
            if owner.get('root')==str(root) and not watchdog.parent_alive(owner['pid']):shutil.rmtree(resolved)
        except (OSError,ValueError,KeyError):pass

def worker(target,data,parent):
    sys.path.insert(0,str(ROOT/'vendor_desktop'))
    import webview
    import watchdog
    fixed=list((ROOT/'webview2').glob('**/msedgewebview2.exe'))
    if fixed:webview.settings['WEBVIEW2_RUNTIME_PATH']=str(fixed[0].parent)
    failed=threading.Event()
    class Bridge:
        def close(self):
            if failed.is_set():window.destroy()
    def execute():
        try:
            while watchdog.parent_alive(parent):time.sleep(.2)
            state_path=data/'desktop-state.json'
            if state_path.exists():
                pid=json.loads(state_path.read_text()) .get('watchdog_pid')
                for _ in range(100):
                    if not watchdog.parent_alive(pid):break
                    time.sleep(.2)
                else:raise ValueError('后台服务尚未退出，请关闭后重试')
            info=latest(target)
            if not info['available'] or not info['can_install'] or not info['asset']:raise ValueError('没有可安装的新版本')
            asset=info['asset'];url=asset['browser_download_url'];digest=asset.get('digest','')
            if not url.startswith('https://github.com/'+REPO+'/releases/download/') or not digest.startswith('sha256:'):raise ValueError('发行包缺少可信来源或 SHA-256')
            if type(asset.get('size')) is not int or not 0<asset['size']<=600_000_000:raise ValueError('发行包体积无效')
            package=ROOT/'release.zip';hashed=hashlib.sha256();size=0
            with build_opener(release_feed.Redirect()).open(Request(url,headers={'User-Agent':'AstraAgent-Updater'}),timeout=60) as response,package.open('wb') as output:
                while block:=response.read(1024*1024):
                    size+=len(block)
                    if size>asset['size']:raise ValueError('下载超过发行清单体积限制')
                    output.write(block);hashed.update(block);status(f'正在下载 {size//1048576} MB')
            if size!=asset['size'] or 'sha256:'+hashed.hexdigest()!=digest:raise ValueError('下载校验失败')
            install(package,target,status);status('更新完成，正在重新启动')
            subprocess.Popen([str(target/'runtimes/python/pythonw.exe') if (target/'runtimes/python/pythonw.exe').exists() else sys.executable,str(target/'desktop.py'),'--data-dir',str(data)],cwd=target)
            window.destroy()
        except Exception as error:
            failed.set()
            message='更新未完成，可关闭窗口后重新启动。'
            if getattr(error,'code',None)==403:message='更新服务暂时拒绝请求或已限流，请稍后重试。'
            window.evaluate_js('setUpdateFailure('+json.dumps(message)+','+json.dumps(str(error)[:2000])+')')
    def status(text):window.evaluate_js('document.getElementById("status").textContent='+json.dumps(text))
    window=webview.create_window('AstraAgent · Update',url=str(ROOT/'update.html'),width=560,height=350,frameless=True,easy_drag=True,resizable=False,js_api=Bridge())
    import native_frame
    window.events.shown += lambda:native_frame.center(window)
    webview.start(execute)

if __name__=='__main__':
    if len(sys.argv)==5 and sys.argv[1]=='--worker':worker(Path(sys.argv[2]),Path(sys.argv[3]),int(sys.argv[4]))
