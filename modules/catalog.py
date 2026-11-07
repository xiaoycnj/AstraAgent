"""Explicit adapters for first-party modules. Never import user-supplied code."""
import json
import threading
import security_core
LOCK=threading.RLock()

from . import core_tools,image_generation,workspace
TOOL_MODULES={'calculator':core_tools,'current_time':core_tools,'generate_image':image_generation}

TOOL_MODULES.update({name:workspace for name in workspace.NAMES})

def definitions():return core_tools.DEFINITIONS+workspace.DEFINITIONS+image_generation.DEFINITIONS

def execute(name,args,config,context):
    if name not in TOOL_MODULES:raise ValueError('模块工具不存在')
    if context.get('data') and name not in available_tools(context['data']):raise ValueError('此功能模块已关闭')
    return TOOL_MODULES[name].execute(args,config,context,name)

def catalog(data=None):
    rows=[{'id':'core-tools','name':'基础计算','tools':['calculator','current_time'],'status':'available'},
            {'id':'workspace','name':'项目与文件','tools':sorted(workspace.NAMES),'status':'available'},
            {'id':'image-generation','name':'图片生成','tools':['generate_image'],'status':'available'}]
    states=read_states(data) if data else {}
    for row in rows:row['enabled']=states.get(row['id'],True) is True
    return rows

def read_states(data):
    path=data/'modules.json'
    with LOCK:return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}

def set_enabled(data,key,value):
    if not isinstance(key,str) or key not in {row['id'] for row in catalog()} or type(value) is not bool:raise ValueError('模块或开关格式无效')
    with LOCK:
        states=read_states(data);states[key]=value
        security_core.atomic_write(data/'modules.json',json.dumps(states).encode())
    return catalog(data)

def available_tools(data):
    return {name for row in catalog(data) if row['enabled'] for name in row['tools']}
