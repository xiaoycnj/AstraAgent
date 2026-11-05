"""Finite-command worker. Never imports user code, invokes a shell or opens network connections."""
import csv,hashlib,json,shutil,sys
from pathlib import Path
COMMANDS=['pwd','ls','cat','write','mkdir','cp','rm','grep','sha256','json','csv']
def execute(root,argv):
    root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True)
    if not isinstance(argv,list) or not 1<=len(argv)<=20 or any(not isinstance(x,str) or len(x)>16000 for x in argv):raise ValueError('argv 格式无效')
    command,*args=argv
    if command not in COMMANDS:raise ValueError('受控工作区不支持此命令；可用：'+', '.join(COMMANDS))
    def target(value='.'):
        if ':' in value or Path(value).is_absolute():raise ValueError('必须使用工作区相对路径')
        p=(root/value).resolve()
        if not p.is_relative_to(root):raise ValueError('路径超出工作区')
        return p
    def read(value):
        p=target(value)
        if p.stat().st_size>100000:raise ValueError('最多读取 100 KB')
        return p.read_text(encoding='utf-8')
    if command=='pwd':return {'cwd':str(root)}
    if command=='ls':return {'files':[{'name':p.name,'directory':p.is_dir()} for p in list(target(args[0] if args else '.').iterdir())[:200]]}
    if command=='mkdir':p=target(args[0]);p.mkdir(parents=True,exist_ok=True);return {'ok':True}
    if command=='write':
        if len(args)!=2 or len(args[1].encode())>64000:raise ValueError('write 需要路径和最多 64 KB 文本')
        p=target(args[0]);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(args[1],encoding='utf-8');return {'ok':True}
    if command=='rm':
        p=target(args[0])
        if p==root or not p.is_file():raise ValueError('rm 只允许删除单个文件')
        p.unlink();return {'ok':True}
    if command=='cp':
        source=target(args[0]);dest=target(args[1])
        if not source.is_file() or source.stat().st_size>100000:raise ValueError('cp 只支持最多 100 KB 的文件')
        dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest);return {'ok':True}
    content=read(args[-1])
    if command=='cat':return {'text':content[:64000]}
    if command=='sha256':return {'sha256':hashlib.sha256(content.encode()).hexdigest()}
    if command=='grep':return {'matches':[{'line':i+1,'text':line[:500]} for i,line in enumerate(content.splitlines()) if args[0].lower() in line.lower()][:100]}
    if command=='json':return {'data':json.loads(content)}
    if command=='csv':return {'rows':list(csv.DictReader(content.splitlines()))[:100]}
    raise ValueError('命令无效')
if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        body=json.loads(sys.stdin.read(100000));result=execute(sys.argv[1],body['argv']);out=json.dumps(result,ensure_ascii=False)
        if len(out)>64000:out=json.dumps({'error':'输出超过 64 KB，请缩小范围'},ensure_ascii=False)
        print(out)
    except Exception as error:print(json.dumps({'error':str(error)[:500]},ensure_ascii=False));sys.exit(1)
