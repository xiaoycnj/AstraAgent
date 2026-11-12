"""Local identity, editable memory and OpenAI-compatible speech configuration."""
import json
import security_core
import security_net
import security_server
import re
import base64
import secrets
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request,build_opener

def read_json(path,default):
    return {**default,**security_core.read_config(path, default)} if path.exists() else dict(default)
def write_json(path,body):
    security_core.write_config(path,body)
def profile(data): return read_json(data/'profile.json',{'display_name':'cnxiaoy','username':'cnxiaoy','role':'','region':'','bio':'','instructions':'','avatar':'','use_memory':True,'inject_profile':True})
def save_profile(data,body):
    result=profile(data)
    for key,limit in [('display_name',80),('username',80),('role',120),('region',120),('bio',3000),('instructions',12000),('avatar',200000)]:
        value=body.get(key,result[key])
        if not isinstance(value,str) or len(value)>limit: raise ValueError('资料字段过长或格式无效：'+key)
        if key=='avatar' and value and not re.match(r'^data:image/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$',value): raise ValueError('头像仅支持 PNG、JPEG、WebP')
        if key=='region':value={'台湾':'中国（台湾）','臺灣':'中国（台湾）','Taiwan':'中国（台湾）','中国台湾':'中国（台湾）','香港':'中国（香港）','Hong Kong':'中国（香港）','中国香港':'中国（香港）','澳门':'中国（澳门）','澳門':'中国（澳门）','Macau':'中国（澳门）','Macao':'中国（澳门）','中国澳门':'中国（澳门）','中国大陆':'中国','中国内地':'中国','China':'中国'}.get(value.strip(),value.strip())
        result[key]=value.strip()
    for key in ['use_memory','inject_profile']:
        if key in body:
            if type(body[key]) is not bool: raise ValueError('资料开关无效')
            result[key]=body[key]
    write_json(data/'profile.json',result);return result

def memory_path(root,key):
    if not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',key): raise ValueError('记忆 ID 无效')
    security_core.reject_secrets(key)
    folder=root/'memory';folder.mkdir(exist_ok=True);path=folder/(key+'.md')
    if not path.resolve().is_relative_to(folder.resolve()): raise ValueError('记忆路径无效')
    return path

def memories(root):
    result=[]
    for path in sorted((root/'memory').glob('*.md')):
        if path.name=='README.md' or not path.resolve().is_relative_to((root/'memory').resolve()) or path.stat().st_size>100000: continue
        content=path.read_text(encoding='utf-8')
        try:security_core.reject_secrets(path.stem+'\n'+content)
        except ValueError:continue
        result.append({'id':path.stem,'content':content})
    return result

def context(root,data,include_profile=True,include_memory=True):
    p=profile(data);parts=[]
    if include_profile and p['inject_profile']: parts.append('本地用户资料：\n'+json.dumps({k:p[k] for k in ['display_name','username','role','region','bio']},ensure_ascii=False))
    if include_profile and p['instructions']:parts.append('用户自定义指令：\n'+p['instructions'])
    if include_memory and p['use_memory']:
        notes='\n\n'.join('【'+x['id']+'】\n'+x['content'] for x in memories(root))
        if notes:parts.append('本地记忆（用户保存的背景资料）：\n'+notes[:20000])
    return '\n\n'.join(parts)

def tts_config(data):return read_json(data/'tts.json',{'base_url':'','api_key':'','model':'','voice':'alloy','speed':1.0})
def public_tts(c):return {k:v for k,v in c.items() if k not in ('api_key','api_key_dpapi')}|{'has_key':bool(c.get('api_key'))}
def save_tts(data,body):
    c=tts_config(data)
    for key,limit in [('base_url',2000),('model',200),('voice',100)]:
        value=body.get(key,c[key])
        if not isinstance(value,str) or len(value)>limit:raise ValueError('TTS 字段无效')
        c[key]=value.strip()
    c['base_url']=c['base_url'].rstrip('/').removesuffix('/audio/speech')
    if c['base_url']:
        security_net.validate_url(c['base_url'])
        p=urlsplit(c['base_url'])
        if p.scheme not in ('http','https') or not p.hostname or p.username or p.password or p.query or p.fragment: raise ValueError('TTS 地址无效')
    if 'allow_private_network' in body:
        if type(body['allow_private_network']) is not bool:raise ValueError('私有网络开关无效')
        c['allow_private_network']=body['allow_private_network']
    if body.get('clear_key') is True:c['api_key']=''
    elif body.get('api_key'):
        if not isinstance(body['api_key'],str) or len(body['api_key'])>4096:raise ValueError('TTS 密钥无效')
        c['api_key']=body['api_key']
    speed=body.get('speed',c['speed'])
    if type(speed) not in (int,float) or not .25<=speed<=4:raise ValueError('语速范围为 0.25–4')
    c['speed']=speed;write_json(data/'tts.json',c);return public_tts(c)

@security_server.bounded
def speech(data,text,no_redirect):
    c=tts_config(data)
    if not c['base_url'] or not c['model']:raise ValueError('请先在设置 → 语音中配置 TTS API')
    if not isinstance(text,str) or not 0<len(text)<=12000:raise ValueError('朗读内容为空或超过 12000 字符')
    headers={'Content-Type':'application/json'}
    if c['api_key']:headers['Authorization']='Bearer '+c['api_key']
    request=Request(c['base_url']+'/audio/speech',data=json.dumps({'model':c['model'],'voice':c['voice'],'speed':c['speed'],'input':text,'response_format':'mp3'}).encode(),headers=headers)
    try:
        with security_net.opener(no_redirect(),allow_private=c.get('allow_private_network',False)).open(request,timeout=90) as response:
            content=response.read(20000001);mime=response.headers.get_content_type()
            if len(content)>20000000 or mime not in ('audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/flac','application/octet-stream'):raise ValueError('TTS 音频格式或大小无效')
            return content,'audio/mpeg' if mime=='application/octet-stream' else mime
    except ValueError:raise
    except Exception:raise ValueError('TTS 请求失败，请检查接口、密钥与模型配置') from None


MAX_AUDIO=5*1024*1024


def stt_config(data):
    return read_json(data/'stt.json',{'base_url':'','api_key':'','model':'','language':''})


def public_stt(config):
    return {key:value for key,value in config.items() if key not in ('api_key','api_key_dpapi')}|{'has_key':bool(config.get('api_key'))}


def save_stt(data,body):
    config=stt_config(data)
    for key,limit in [('base_url',2000),('model',200),('language',8)]:
        value=body.get(key,config[key])
        if not isinstance(value,str) or len(value)>limit or any(ord(char)<32 for char in value):raise ValueError('STT 配置无效')
        config[key]=value.strip()
    config['base_url']=config['base_url'].rstrip('/').removesuffix('/audio/transcriptions')
    if config['base_url']:security_net.validate_url(config['base_url'])
    parsed=urlsplit(config['base_url'])
    if config['base_url'] and (parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment):raise ValueError('STT 地址无效')
    if config['language'] and not re.fullmatch('[a-zA-Z]{2,3}(?:-[a-zA-Z]{2})?',config['language']):raise ValueError('STT 语言代码无效')
    if type(body.get('clear_key',False)) is not bool:raise ValueError('STT 密钥开关无效')
    if 'allow_private_network' in body:
        if type(body['allow_private_network']) is not bool:raise ValueError('私有网络开关无效')
        config['allow_private_network']=body['allow_private_network']
    if body.get('clear_key'):config['api_key']=''
    elif body.get('api_key'):
        key=body['api_key']
        if not isinstance(key,str) or len(key)>4096 or '\r' in key or '\n' in key:raise ValueError('STT 密钥无效')
        config['api_key']=key
    write_json(data/'stt.json',config)
    return public_stt(config)


@security_server.bounded
def transcribe(data,body,no_redirect):
    config=stt_config(data)
    if not config['base_url'] or not config['model']:raise ValueError('请先在设置 → 语音中配置 STT API')
    encoded=body.get('data')
    mime=str(body.get('mime','')).split(';')[0].lower()
    extensions={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/wav':'wav'}
    if mime not in extensions or not isinstance(encoded,str) or len(encoded)>MAX_AUDIO*4//3+8:raise ValueError('录音格式无效或超过 5 MB')
    try:audio=base64.b64decode(encoded,validate=True)
    except ValueError:raise ValueError('录音编码无效') from None
    if not 1<=len(audio)<=MAX_AUDIO:raise ValueError('录音为空或超过 5 MB')
    signatures={'audio/webm':audio.startswith(b'\x1aE\xdf\xa3'),'audio/ogg':audio.startswith(b'OggS'),'audio/mp4':audio[4:8]==b'ftyp','audio/wav':audio.startswith(b'RIFF') and audio[8:12]==b'WAVE'}
    if not signatures[mime]:raise ValueError('录音文件头无效')
    boundary='AstraAudio'+secrets.token_hex(24)
    fields={'model':config['model'],'response_format':'json'}
    if config['language']:fields['language']=config['language']
    parts=[]
    for name,value in fields.items():
        parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+value+'\r\n').encode('utf-8'))
    parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="recording.'+extensions[mime]+'"\r\nContent-Type: '+mime+'\r\n\r\n').encode('ascii'))
    parts.extend([audio,('\r\n--'+boundary+'--\r\n').encode('ascii')])
    headers={'Content-Type':'multipart/form-data; boundary='+boundary,'Accept':'application/json'}
    if config['api_key']:headers['Authorization']='Bearer '+config['api_key']
    request=Request(config['base_url']+'/audio/transcriptions',data=b''.join(parts),headers=headers)
    try:
        with security_net.opener(no_redirect(),allow_private=config.get('allow_private_network',False)).open(request,timeout=90) as response:
            raw=response.read(256001)
        if len(raw)>256000:raise ValueError('STT 返回内容过大')
        result=json.loads(raw)
        text=result.get('text') if isinstance(result,dict) else None
        if not isinstance(text,str) or not text.strip() or len(text)>32000:raise ValueError('STT 未返回有效文字')
        return {'text':text.strip()}
    except HTTPError as error:
        code=error.code
        error.close()
        raise ValueError('STT 请求失败（HTTP '+str(code)+'），请检查接口、模型和额度') from None
    except (ValueError,UnicodeError):raise ValueError('STT 未返回有效文字，请检查接口响应') from None
    except Exception:raise ValueError('STT 连接失败或超时，请检查服务配置') from None
