"""Validated application behavior contributions for manifest v2 plugins."""
import json
import threading
from pathlib import Path
import extensions

LOCK=threading.RLock()
ACTIONS={'before_send':{'limit_length','prefix'},'after_response':{'save_output','notify'},'startup':{'reading_layout'}}

def validate(manifest):
    if not isinstance(manifest,dict):raise ValueError('插件清单需为 JSON 对象')
    extensions.valid_id(manifest.get('id'))
    if manifest.get('schema_version')!=2:raise ValueError('应用插件需要 schema_version 2')
    for field,limit in [('name',80),('description',2000),('version',40)]:
        if not isinstance(manifest.get(field),str) or not 0<len(manifest[field])<=limit:raise ValueError('插件字段无效：'+field)
    hooks=manifest.get('hooks',[])
    if not isinstance(hooks,list) or len(hooks)>16:raise ValueError('插件事件数量无效')
    normalized=[]
    for hook in hooks:
        if not isinstance(hook,dict) or not isinstance(hook.get('event'),str) or not isinstance(hook.get('action'),str) or hook.get('action') not in ACTIONS.get(hook.get('event'),set()):raise ValueError('未知插件事件或动作')
        value=hook.get('value','')
        if hook['action']=='limit_length':
            if type(value) is not int or not 1<=value<=100000:raise ValueError('消息长度限制无效')
        elif not isinstance(value,str) or len(value)>2000:raise ValueError('插件动作参数无效')
        if hook['action']=='reading_layout' and value not in ('compact','comfortable'):raise ValueError('阅读布局无效')
        normalized.append({'event':hook['event'],'action':hook['action'],'value':value})
    panels=manifest.get('panels',[])
    if not isinstance(panels,list) or len(panels)>8:raise ValueError('插件页面数量无效')
    for panel in panels:
        if not isinstance(panel,dict) or any(not isinstance(panel.get(k),str) or len(panel[k])>4000 for k in ('title','text')):raise ValueError('插件页面无效')
    return {k:manifest[k] for k in ('schema_version','id','name','description','version')}|{'hooks':normalized,'panels':panels,'tools':[],'skills':[],'permissions':sorted({h['action'] for h in normalized})}

def install(root,manifest):
    value=validate(manifest);folder=Path(root)/'plugins'/value['id']
    with LOCK:
        # Check the plugin root itself, including Windows directory junctions.
        plugin_root=Path(root)/'plugins'
        for candidate in (plugin_root,folder):
            if candidate.is_symlink() or getattr(candidate,'is_junction',lambda:False)():
                raise ValueError('插件安装路径不能包含链接')
        if folder.exists():raise ValueError('同名插件已存在，请更换 ID')
        if not folder.resolve().is_relative_to((Path(root)/'plugins').resolve()):raise ValueError('插件目录无效')
        folder.mkdir(parents=True)
        try:(folder/'manifest.json').write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
        except Exception:
            folder.rmdir();raise
    return value

def before_send(root,data,content):
    for plugin in extensions.catalog(root,data)['plugins']:
        if not plugin['enabled']:continue
        for hook in plugin.get('hooks',[]):
            if hook['event']!='before_send':continue
            if hook['action']=='limit_length' and len(content)>hook['value']:raise ValueError('插件 '+plugin['name']+' 限制消息长度：'+str(hook['value']))
            if hook['action']=='prefix' and not content.startswith(hook['value']):content=hook['value']+content
    return content

def after_response(root,data,database,sid,message_id,emit):
    import attachments
    for plugin in extensions.catalog(root,data)['plugins']:
        if not plugin['enabled']:continue
        for hook in plugin.get('hooks',[]):
            if hook['event']!='after_response' or hook['action']!='save_output':continue
            try:
                with database() as db:attachments.save_output(db,data,sid,{'message_id':message_id})
                emit({'type':'plugin','name':plugin['name'],'status':'complete'})
            except Exception as error:emit({'type':'plugin','name':plugin['name'],'status':'error','message':str(error)[:200]})
