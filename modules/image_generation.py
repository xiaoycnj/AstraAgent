"""OpenAI-compatible image generation, using the existing bounded attachment store."""
import base64
import json
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler
from urllib.error import HTTPError,URLError
import attachments
import security_net
import security_server
import task_control

DEFINITIONS=[{'type':'function','function':{'name':'generate_image','description':'使用已配置的 image_api 服务商生成图片并保存为当前会话产物。一次一张，可能产生费用。','parameters':{'type':'object','properties':{'prompt':{'type':'string'},'provider':{'type':'string','description':'image_api 服务商 ID，可留空使用第一个'},'size':{'type':'string','enum':['1024x1024','1536x1024','1024x1536','1792x1024','1024x1792']}},'required':['prompt'],'additionalProperties':False}}}]

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

@security_server.bounded
def request_image(provider,args,config):
    prompt=args.get('prompt');size=args.get('size','1024x1024')
    if not isinstance(prompt,str) or not 1<=len(prompt.strip())<=12000:raise ValueError('生图提示词需为 1–12000 字符')
    if size not in DEFINITIONS[0]['function']['parameters']['properties']['size']['enum']:raise ValueError('图片尺寸无效')
    body={'model':provider['model'],'prompt':prompt,'n':1,'size':size}
    if not provider['model'].lower().startswith('gpt-image'):body['response_format']='b64_json'
    headers={'Content-Type':'application/json'}
    key=provider.get('api_key','')
    if not isinstance(key,str) or '\r' in key or '\n' in key:raise ValueError('生图密钥格式无效')
    if key:headers['Authorization']='Bearer '+key
    request=Request(provider['base_url']+'/images/generations',data=json.dumps(body).encode(),headers=headers)
    token=config.get('_cancel_token')
    try:
        with security_net.opener(NoRedirect(),allow_private=provider.get('allow_private_network',False)).open(request,timeout=provider.get('timeout',180)) as response:
            from contextlib import ExitStack
            with ExitStack() as resources:
                if token:resources.enter_context(token.resource(lambda:task_control.close_response(response)))
                raw=response.read(12_000_001)
                if len(raw)>12_000_000:raise ValueError('生图响应超过限制')
                result=json.loads(raw)
        image=result['data'][0]
        if image.get('b64_json'):return base64.b64decode(image['b64_json'],validate=True)
        url=image.get('url','');parsed=urlsplit(url);origin=urlsplit(provider['base_url'])
        same_origin=(parsed.scheme,parsed.hostname,parsed.port)==(origin.scheme,origin.hostname,origin.port)
        if not same_origin and parsed.scheme!='https':raise ValueError('图片下载需要 HTTPS')
        # Download with no provider Authorization header, pinning DNS and prohibiting redirects.
        with security_net.opener(NoRedirect(),allow_private=bool(same_origin and provider.get('allow_private_network')),allow_query=True).open(url,timeout=60) as response:
            with ExitStack() as resources:
                if token:resources.enter_context(token.resource(lambda:task_control.close_response(response)))
                raw=response.read(attachments.MAX_FILE+1)
        return raw
    except HTTPError as error:
        code=error.code;error.close();raise ValueError('生图服务返回 HTTP '+str(code)) from None
    except (URLError,TimeoutError):raise ValueError('生图服务连接失败或超时') from None
    except (ValueError,UnicodeError):raise ValueError('生图响应、下载地址或内容无效') from None
    except (KeyError,IndexError,TypeError):raise ValueError('生图服务响应格式无效') from None

def execute(args,config,context,name=None):
    providers=[p for p in context['providers']() if p.get('type','chat_api')=='image_api']
    if args.get('provider'):providers=[p for p in providers if p['id']==args['provider']]
    if not providers:raise ValueError('请先在服务商中添加 image_api 类型与图片模型')
    provider=providers[0]
    if not provider.get('base_url') or not provider.get('model'):raise ValueError('请完善图片服务商的地址与模型配置')
    raw=task_control.io_call(config.get('_cancel_token'),lambda:request_image(provider,args,config))
    task_control.check(config)
    name='generated.png' if raw.startswith(b'\x89PNG') else 'generated.jpg' if raw.startswith(b'\xff\xd8') else 'generated.webp'
    item=attachments.upload(context['data'],{'name':name,'data':base64.b64encode(raw).decode()})
    sid=config.get('_session_id')
    try:
        task_control.check(config)
        if sid:
            with context['database']() as db:
                db.execute('INSERT INTO session_outputs(session_id,attachment_id) VALUES(?,?)',(sid,item['id']))
    except BaseException:
        import shutil
        folder=attachments.location(context['data'],item['id'])
        shutil.rmtree(folder)
        raise
    url='/api/attachments/'+item['id']+'/content'
    return {'ok':True,'attachment':item,'url':url,'markdown':'![生成的图片]('+url+')','provider':provider['id']}
