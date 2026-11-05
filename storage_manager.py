"""Storage accounting and narrowly scoped cleanup operations."""
import os
import time

CACHE={}

def directory_bytes(path):
    total=0
    if not path.exists():return total
    for parent,dirs,files in os.walk(path,followlinks=False):
        dirs[:]=[name for name in dirs if not (type(path)(parent)/name).is_symlink() and not getattr(type(path)(parent)/name,'is_junction',lambda:False)()]
        for name in files:
            file=type(path)(parent)/name
            try:
                if not file.is_symlink():total+=file.stat().st_size
            except OSError:pass
    return total

def usage(root,data,database):
    key=str(data.resolve());cached=CACHE.get(key)
    if cached and time.monotonic()-cached[0]<5:return cached[1]
    groups=[('attachments','附件',data/'attachments'),('workspace','工作文件',data/'files'),('projects','项目检查点',data/'project-history'),('memory','长期记忆',root/'memory'),('skills','Skills 与版本',root/'skills'),('versions','Skill 版本',data/'skill-versions'),('desktop','桌面缓存',data/'webview'),('logs','运行日志',data/'logs')]
    categories=[{'id':key,'name':label,'bytes':directory_bytes(path)} for key,label,path in groups]
    database_size=sum(file.stat().st_size for file in data.glob('*.sqlite3*') if file.is_file())
    categories.append({'id':'database','name':'会话与数据库','bytes':database_size})
    accounted=sum(item['bytes'] for item in categories if item['id'] not in ('memory','skills'))
    categories.append({'id':'other','name':'配置与其他数据','bytes':max(0,directory_bytes(data)-accounted)})
    with database() as db:
        sessions=db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]
        archived=db.execute('SELECT COUNT(*) FROM sessions WHERE archived=1').fetchone()[0]
        messages=db.execute('SELECT COUNT(*) FROM messages').fetchone()[0]
        cache=db.execute("SELECT COALESCE(SUM(LENGTH(event)),0) FROM stream_events WHERE request_id IN (SELECT id FROM stream_requests WHERE status!='running')").fetchone()[0]
    value={'path':str(data),'total':sum(item['bytes'] for item in categories),'categories':categories,'sessions':sessions,'archived':archived,'messages':messages,'completed_stream_bytes':cache}
    CACHE[key]=(time.monotonic(),value);return value

def cleanup(data,database,action):
    if action!='completed_streams':raise ValueError('清理操作无效')
    with database() as db:
        count=db.execute("SELECT COUNT(*) FROM stream_requests WHERE status!='running'").fetchone()[0]
        db.execute("DELETE FROM stream_events WHERE request_id IN (SELECT id FROM stream_requests WHERE status!='running')")
        db.execute("DELETE FROM stream_requests WHERE status!='running'")
    with database() as db:db.execute('VACUUM')
    CACHE.pop(str(data.resolve()),None)
    return {'ok':True,'requests':count}
