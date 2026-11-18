"""Declarative extension registry. No plugin code is imported or executed."""
import json
import re
import agent_hub
from pathlib import Path

def valid_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}',value): raise ValueError('ID 仅支持小写字母、数字、下划线和短横线。')
    return value

def read_manifest(path):
    if path.stat().st_size > 100000:
        raise ValueError('插件清单过大')
    m = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(m, dict) or valid_id(m.get('id')) != path.parent.name or type(m.get('schema_version')) is not int or m['schema_version'] not in (1, 2):
        raise ValueError('插件 ID 或版本无效')
    if m['schema_version'] == 2:
        import application_plugins
        return application_plugins.validate(m)
    if not isinstance(m.get('name'), str) or not m['name'].strip():
        raise ValueError('插件名称无效')
    for field in ('tools', 'permissions'):
        if not isinstance(m.get(field, []), list) or not all(isinstance(v, str) for v in m.get(field, [])):
            raise ValueError('插件字段无效：' + field)
    if m.get('hooks') or m.get('panels') or not isinstance(m.get('skills', []), list):
        raise ValueError('插件贡献格式无效')
    ids = set()
    for item in m.get('skills', []):
        if not isinstance(item, dict) or not isinstance(item.get('prompt'), str) or not 0 < len(item['prompt']) <= 12000 or not isinstance(item.get('name'), str):
            raise ValueError('插件 Skill 无效')
        ident = valid_id(item.get('id'))
        if ident in ids:
            raise ValueError('插件 Skill ID 重复')
        ids.add(ident)
    return m


def catalog(root,data,include_disabled=False):
    skills={};errors=[];plugins=[]
    disabled_path=data/"skill-settings.json"
    try:skill_states=json.loads(disabled_path.read_text(encoding="utf-8")) if disabled_path.exists() else {}
    except (ValueError,OSError):skill_states={};errors.append("Skill 状态无法读取")
    for path in sorted((root/'skills').glob('*/SKILL.md')):
        try:
            key=valid_id(path.parent.name)
            if not path.resolve().is_relative_to((root/'skills').resolve()) or path.stat().st_size>50000: raise ValueError('Skill 路径或大小无效')
            content=path.read_text(encoding='utf-8');title,_,prompt=content.partition('\n')
            if not title.startswith('# ') or not prompt.strip() or len(prompt.strip())>12000: raise ValueError('Skill 需以 # 名称 开头并包含提示词，正文最多 12000 字符')
            active=key=='general' or skill_states.get(key,True) is True
            if not active and not include_disabled:continue
            skills[key]={'enabled':active,'name':title[2:].strip(),'prompt':prompt.strip(),'source':'skills/'+key+'/SKILL.md','editable':True}
        except (ValueError,OSError) as e: errors.append(str(path.name)+': '+str(e))
    import extension_safety
    if extension_safety.status(data)['active']:
        return {'skills':skills,'plugins':[],'errors':errors}
    state_path=data/'extensions.json'
    try: enabled=json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
    except (ValueError,OSError,RecursionError):
        enabled=None
    if not isinstance(enabled, dict) or any(type(v) is not bool for v in enabled.values()):
        reason=extension_safety.latch(data, '检查损坏的 extensions.json。')['reason']
        return {'skills':skills,'plugins':[],'errors':errors+[reason]}
    core_skills = skills.copy()
    for path in sorted((root/'plugins').glob('*/manifest.json')):
        try:
            if not path.resolve().is_relative_to((root/'plugins').resolve()) or path.stat().st_size>100000: raise ValueError('插件路径或大小无效')
            m=read_manifest(path);pid=m['id']
            contributions={}
            for item in m.get('skills',[]):
                sid=pid+'__'+valid_id(item['id']);prompt=item['prompt'];name=item['name']
                if not isinstance(prompt,str) or not 0<len(prompt)<=12000 or not isinstance(name,str): raise ValueError('插件 Skill 无效')
                contributions[sid]={'name':name,'prompt':prompt,'source':'plugin:'+pid,'editable':False}
            builtin=pid in agent_hub.PLUGINS and m.get('tools',[])==agent_hub.PLUGINS[pid][1]
            supported=builtin or not bool(m.get('tools'))
            active=enabled.get(pid,builtin) and supported
            plugins.append({'id':pid,'name':m['name'],'version':m.get('version','1.0'),'description':m.get('description',''),'enabled':active,'supported':supported,'skills':len(contributions),'permissions':m.get('permissions',[]),'tools':agent_hub.PLUGINS[pid][1] if builtin else [],'builtin':builtin,'hooks':m.get('hooks',[]),'panels':m.get('panels',[])})
            if active or (include_disabled and supported): skills.update(contributions)
        except (KeyError,ValueError,TypeError,OSError,RecursionError):
            label = path.parent.name if re.fullmatch(r'[a-z][a-z0-9_-]{0,63}',path.parent.name) else '?'
            reason=extension_safety.latch(data, '检查损坏的 plugins/'+label+'/manifest.json。')['reason']
            return {'skills':core_skills,'plugins':[],'errors':errors+[reason]}
    return {'skills':skills,'plugins':plugins,'errors':errors}

def save_skill(root,key,body):
    valid_id(key);name=body.get('name');prompt=body.get('prompt')
    if not isinstance(name,str) or not name.strip() or len(name)>80 or '\n' in name or not isinstance(prompt,str) or not 0<len(prompt.strip())<=12000: raise ValueError('请填写名称及提示词（最多 12000 字符）。')
    path=root/'skills'/key/'SKILL.md'
    if not path.resolve().is_relative_to((root/'skills').resolve()): raise ValueError('Skill 路径无效')
    path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text('# '+name.strip()+'\n\n'+prompt.strip()+'\n',encoding='utf-8');temp.replace(path)

def toggle_plugin(root,data,pid,active):
    valid_id(pid);plugin=next((p for p in catalog(root,data)['plugins'] if p['id']==pid),None)
    if not plugin: raise ValueError('插件不存在')
    if active and not plugin['supported']: raise ValueError('此插件需要尚未支持的可执行工具适配器')
    path=data/'extensions.json';state=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {};state[pid]=active
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(state),encoding='utf-8');temp.replace(path)


def toggle_skill(root,data,key,active):
    valid_id(key)
    if key=='general' and not active:raise ValueError('通用助手始终可用')
    available=catalog(root,data,True)['skills']
    if key not in available or not available[key]['editable']:raise ValueError('请通过所属插件管理此 Skill')
    path=data/'skill-settings.json'
    state=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    state[key]=bool(active);temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state),encoding='utf-8');temporary.replace(path)
