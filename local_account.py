"""Local identity, editable memory and OpenAI-compatible speech configuration."""
import json
import re
from urllib.parse import urlsplit
from urllib.request import Request,build_opener

def read_json(path,default):
    return {**default,**json.loads(path.read_text(encoding='utf-8'))} if path.exists() else dict(default)
def write_json(path,body):
    path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(body,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
def profile(data): return read_json(data/'profile.json',{'display_name':'cnxiaoy','username':'cnxiaoy','role':'','bio':'','instructions':'','avatar':'','use_memory':True,'inject_profile':True})
def save_profile(data,body):
    result=profile(data)
    for key,limit in [('display_name',80),('username',80),('role',120),('bio',3000),('instructions',12000),('avatar',200000)]:
        value=body.get(key,result[key])
        if not isinstance(value,str) or len(value)>limit: raise ValueError('资料字段过长或格式无效：'+key)
        if key=='avatar' and value and not re.match(r'^data:image/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$',value): raise ValueError('头像仅支持 PNG、JPEG、WebP')
        result[key]=value.strip()
    for key in ['use_memory','inject_profile']:
        if key in body:
            if type(body[key]) is not bool: raise ValueError('资料开关无效')
            result[key]=body[key]
    write_json(data/'profile.json',result);return result

def memory_path(root,key):
    if not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',key): raise ValueError('记忆 ID 无效')
    folder=root/'memory';folder.mkdir(exist_ok=True);path=folder/(key+'.md')
    if not path.resolve().is_relative_to(folder.resolve()): raise ValueError('记忆路径无效')
    return path

def memories(root):
    result=[]
    for path in sorted((root/'memory').glob('*.md')):
        if path.name=='README.md' or not path.resolve().is_relative_to((root/'memory').resolve()) or path.stat().st_size>100000: continue
        result.append({'id':path.stem,'content':path.read_text(encoding='utf-8')})
    return result

def context(root,data,include_profile=True,include_memory=True):
    p=profile(data);parts=[]
    if include_profile and p['inject_profile']: parts.append('本地用户资料：\n'+json.dumps({k:p[k] for k in ['display_name','username','role','bio']},ensure_ascii=False))
    if include_profile and p['instructions']:parts.append('用户自定义指令：\n'+p['instructions'])
    if include_memory and p['use_memory']:
        notes='\n\n'.join('【'+x['id']+'】\n'+x['content'] for x in memories(root))
        if notes:parts.append('本地记忆（用户保存的背景资料）：\n'+notes[:20000])
    return '\n\n'.join(parts)

def tts_config(data):return read_json(data/'tts.json',{'base_url':'','api_key':'','model':'','voice':'alloy','speed':1.0})
def public_tts(c):return {k:v for k,v in c.items() if k!='api_key'}|{'has_key':bool(c.get('api_key'))}
def save_tts(data,body):
    c=tts_config(data)
    for key,limit in [('base_url',2000),('model',200),('voice',100)]:
        value=body.get(key,c[key])
        if not isinstance(value,str) or len(value)>limit:raise ValueError('TTS 字段无效')
        c[key]=value.strip()
    c['base_url']=c['base_url'].rstrip('/').removesuffix('/audio/speech')
    if c['base_url']:
        p=urlsplit(c['base_url'])
        if p.scheme not in ('http','https') or not p.hostname or p.username or p.password or p.query or p.fragment: raise ValueError('TTS 地址无效')
    if body.get('clear_key') is True:c['api_key']=''
    elif body.get('api_key'):
        if not isinstance(body['api_key'],str) or len(body['api_key'])>4096:raise ValueError('TTS 密钥无效')
        c['api_key']=body['api_key']
    speed=body.get('speed',c['speed'])
    if type(speed) not in (int,float) or not .25<=speed<=4:raise ValueError('语速范围为 0.25–4')
    c['speed']=speed;write_json(data/'tts.json',c);return public_tts(c)

def speech(data,text,no_redirect):
    c=tts_config(data)
    if not c['base_url'] or not c['model']:raise ValueError('请先在设置 → 语音中配置 TTS API')
    if not isinstance(text,str) or not 0<len(text)<=12000:raise ValueError('朗读内容为空或超过 12000 字符')
    headers={'Content-Type':'application/json'}
    if c['api_key']:headers['Authorization']='Bearer '+c['api_key']
    request=Request(c['base_url']+'/audio/speech',data=json.dumps({'model':c['model'],'voice':c['voice'],'speed':c['speed'],'input':text,'response_format':'mp3'}).encode(),headers=headers)
    try:
        with build_opener(no_redirect()).open(request,timeout=90) as response:
            content=response.read(20000001);mime=response.headers.get_content_type()
            if len(content)>20000000 or mime not in ('audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/flac','application/octet-stream'):raise ValueError('TTS 音频格式或大小无效')
            return content,'audio/mpeg' if mime=='application/octet-stream' else mime
    except ValueError:raise
    except Exception:raise ValueError('TTS 请求失败，请检查接口、密钥与模型配置') from None
