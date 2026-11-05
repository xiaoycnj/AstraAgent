"""Bounded, permission-gated local workspace tools. No shell or network."""
import fnmatch
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import time

LIMIT = 100_000
LOCK = threading.RLock()
WRITES = {'create_directory', 'copy_file', 'move_file', 'replace_in_file'}
PATH = {'type': 'string', 'description': '相对 data/files 的路径'}
SPECS = [
    ('search_files', '按 glob 搜索工作区文件名，返回全部匹配（最多 200 项）', {'pattern': {'type':'string'}, 'path':PATH}, ['pattern']),
    ('search_text', '逐行搜索 UTF-8 文件中的字面文本，返回路径、行号与片段（最多 100 项）', {'query':{'type':'string'}, 'path':PATH, 'case_sensitive':{'type':'boolean'}}, ['query']),
    ('file_info', '查看工作区文件大小、修改时间和 SHA-256；目录返回类型', {'path':PATH}, ['path']),
    ('create_directory', '创建工作区目录（包括缺失的父目录）', {'path':PATH}, ['path']),
    ('copy_file', '复制工作区单个文件，不覆盖已有目标', {'path':PATH, 'destination':PATH}, ['path','destination']),
    ('move_file', '移动或重命名工作区单个文件，不覆盖已有目标', {'path':PATH, 'destination':PATH}, ['path','destination']),
    ('replace_in_file', '精确替换 UTF-8 文件文本；expected_count 必须等于实际匹配数量。可传 file_info 的 SHA-256 防止过期修改', {'path':PATH, 'old':{'type':'string'}, 'new':{'type':'string'}, 'expected_count':{'type':'integer','minimum':1,'maximum':1000}, 'sha256':{'type':'string'}}, ['path','old','new','expected_count']),
]
NAMES = {s[0] for s in SPECS}
DEFINITIONS = [{'type':'function','function':{'name':n,'description':d,'parameters':{'type':'object','properties':p,'required':r,'additionalProperties':False}}} for n,d,p,r in SPECS]

def target(root, value, allow_root=False):
    if not isinstance(value,str) or not value.strip() or len(value)>240 or ':' in value or '\x00' in value:
        raise ValueError('路径无效')
    path = Path(value)
    if path.is_absolute() or path.drive or '..' in path.parts: raise ValueError('仅允许工作区相对路径')
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink() or getattr(current,'is_junction',lambda:False)(): raise ValueError('不跟随链接或联接目录')
    resolved = current.resolve()
    if not resolved.is_relative_to(root) or (resolved==root and not allow_root): raise ValueError('路径超出工作区')
    return resolved

def read(path):
    if not path.is_file(): raise ValueError('文件不存在')
    with path.open('rb') as f: data=f.read(LIMIT+1)
    if len(data)>LIMIT: raise ValueError('文件超过 100 KB 工具限制')
    return data

def entries(root, directory, status, project_mode=False):
    deadline=time.monotonic()+3
    for parent, dirs, files in os.walk(directory, followlinks=False):
        status['visited']+=1
        if status['visited']>2000 or time.monotonic()>deadline:
            status['truncated']=True; return
        dirs[:] = sorted(d for d in dirs if (not project_mode or d not in ('.git','node_modules','.venv','venv','__pycache__','.cache','dist','build')) and not (Path(parent)/d).is_symlink() and not getattr(Path(parent)/d,'is_junction',lambda:False)())
        for name in sorted(files):
            status['visited']+=1
            if status['visited']>2000 or time.monotonic()>deadline:
                status['truncated']=True; return
            try: yield target(root,str((Path(parent)/name).relative_to(root)))
            except (ValueError,OSError): continue

def execute(data, name, args, root=None):
    try:
        if name not in NAMES or not isinstance(args,dict): raise ValueError('工具参数无效')
        project_mode=bool(root);root=Path(root).resolve() if root else (data/'files').resolve(); root.mkdir(parents=True,exist_ok=True)
        with LOCK:
            if name in ('search_files','search_text'):
                folder=target(root,args.get('path','.'),True)
                if not folder.is_dir(): raise ValueError('搜索路径不是目录')
                key='pattern' if name=='search_files' else 'query'; query=args[key]
                if not isinstance(query,str) or not query or len(query)>300: raise ValueError('查询长度须为 1–300 字符')
                case=args.get('case_sensitive',False)
                if type(case) is not bool: raise ValueError('case_sensitive 必须为布尔值')
                status={'visited':0,'truncated':False}; found=[]; budget=0; skipped=0
                for path in entries(root,folder,status,project_mode):
                    relative=path.relative_to(root).as_posix()
                    if name=='search_files':
                        if fnmatch.fnmatchcase(relative.casefold(),query.casefold()) or fnmatch.fnmatchcase(path.name.casefold(),query.casefold()): found.append(relative)
                    else:
                        try:
                            raw=read(path); budget+=len(raw)
                            if budget>5_000_000: status['truncated']=True; break
                            text=raw.decode('utf-8-sig')
                            if '\x00' in text: skipped+=1; continue
                        except (OSError,UnicodeError,ValueError): skipped+=1; continue
                        for number,line in enumerate(text.splitlines(),1):
                            index=(line if case else line.casefold()).find(query if case else query.casefold())
                            if index>=0:
                                start=max(0,index-80);found.append({'path':relative,'line':number,'text':line[start:start+400]})
                                if len(found)>=100: break
                    if len(found)>=(200 if name=='search_files' else 100): status['truncated']=True; break
                return {'matches':found,**status,'skipped':skipped}
            path=target(root,args['path'])
            relative=path.relative_to(root).as_posix()
            if name=='file_info':
                stat=path.stat(); result={'path':relative,'type':'directory' if path.is_dir() else 'file','bytes':stat.st_size,'modified':stat.st_mtime}
                if path.is_file(): result['sha256']=hashlib.sha256(read(path)).hexdigest()
                return result
            if name=='create_directory':
                created=not path.exists();path.mkdir(parents=True,exist_ok=True)
                return {'ok':True,'path':relative,'created':created}
            if name in ('copy_file','move_file'):
                raw=read(path); destination=target(root,args['destination'])
                destination.parent.mkdir(parents=True,exist_ok=True)
                with destination.open('xb') as output: output.write(raw)
                if name=='move_file':
                    try: path.unlink()
                    except OSError:
                        destination.unlink();raise
                return {'ok':True,'source':relative,'path':destination.relative_to(root).as_posix(),'bytes':len(raw)}
            raw=read(path); old=args['old']; new=args['new']; count=args['expected_count']
            if not isinstance(old,str) or not old or not isinstance(new,str) or type(count) is not int or not 1<=count<=1000: raise ValueError('替换参数无效')
            if args.get('sha256') and args['sha256']!=hashlib.sha256(raw).hexdigest(): raise ValueError('文件已变化，请重新读取后修改')
            content=raw.decode('utf-8')
            if content.count(old)!=count: raise ValueError('匹配数量与 expected_count 不符，未修改文件')
            updated=content.replace(old,new).encode('utf-8')
            if len(updated)>LIMIT: raise ValueError('替换结果超过 100 KB')
            temp=None
            try:
                with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f: temp=Path(f.name);f.write(updated)
                if read(path)!=raw: raise ValueError('文件已变化，未修改文件')
                temp.replace(path)
            finally:
                if temp and temp.exists(): temp.unlink()
            return {'ok':True,'path':relative,'replacements':count,'sha256':hashlib.sha256(updated).hexdigest()}
    except (ValueError,OSError,UnicodeError,KeyError,TypeError) as exc:
        return {'error':str(exc) if isinstance(exc,ValueError) else '文件不可访问、目标已存在或参数无效'}

def invoke(data,name,args,config,emit,approve):
    permission=config.get('file_permission','none')
    if not emit or permission not in ('ask','read','all'): return {'error':'文件访问未授权'}
    if (permission=='ask' or (name in WRITES and permission!='all')) and not approve(name,args,emit):
        return {'error':'用户拒绝或授权已过期'}
    return execute(data,name,args,config.get('project_root'))
