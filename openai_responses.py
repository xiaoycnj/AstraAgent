"""Translate the tool loop to OpenAI Responses with API-key or OAuth transport."""
from contextlib import ExitStack
import json
from urllib.request import Request, build_opener
from urllib.error import HTTPError
import model_adapters
import security_net
import openai_oauth
import task_control

def payload_for(payload):
    items=[]
    for message in payload['messages']:
        if message.get('_response_items'):
            items.extend(message['_response_items']);continue
        if message['role']=='tool':
            items.append({'type':'function_call_output','call_id':message['tool_call_id'],'output':str(message.get('content',''))});continue
        content=message.get('content')
        if content:
            if isinstance(content,list):
                content=[{'type':'input_text','text':part['text']} if part['type']=='text' else {'type':'input_image','image_url':part['image_url']['url']} for part in content if part['type'] in ('text','image_url')]
            items.append({'role':message['role'],'content':content})
        for call in message.get('tool_calls',[]):
            items.append({'type':'function_call','call_id':call['id'],'name':call['function']['name'],'arguments':call['function']['arguments']})
    result={'model':payload['model'],'input':items,'store':False,'stream':True}
    if payload.get('tools'):result['tools']=[{'type':'function',**tool['function']} for tool in payload['tools']]
    if payload.get('reasoning_effort'):result['reasoning']={'effort':payload['reasoning_effort'],'summary':'auto'}
    result['include']=['reasoning.encrypted_content']
    if payload.get('prompt_cache_key'):result['prompt_cache_key']=payload['prompt_cache_key']
    if payload.get('max_tokens'):result['max_output_tokens']=payload['max_tokens']
    return result

def call(data,c,endpoint,payload=None,emit=None):
    task_control.check(c)
    oauth=c.get('auth_type')=='openai_oauth' or not c.get('base_url')
    if payload is not None:c.setdefault('model',payload['model'])
    token=openai_oauth.manager(data).access_token() if oauth else c.get('api_key','')
    task_control.check(c)
    base=openai_oauth.RESOURCE if oauth else c['base_url']
    transport=build_opener(openai_oauth.NoRedirect()) if oauth else security_net.opener(openai_oauth.NoRedirect(),allow_private=c.get('allow_private_network',False))
    task_control.check(c)
    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'text/event-stream','User-Agent':'AstraAgent/2.4'}
    if endpoint=='/models':
        try:
            with transport.open(Request(base+'/models',headers=headers),timeout=c['timeout']) as response:
                result=json.loads(response.read(2000000))
            models=result.get('models',result.get('data',[]))
            return {'data':[{'id':model.get('slug',model.get('id')),'name':model.get('display_name',model.get('id'))} for model in models if model.get('visibility','list')=='list']}
        except Exception as error:raise ValueError('无法读取 OpenAI OAuth 模型目录') from error
    if endpoint!='/chat/completions':raise ValueError('OAuth 提供商不支持此接口')
    prepared=model_adapters.prepare(c,payload)
    body=payload_for(prepared)
    body['max_output_tokens']=c.get('max_output_tokens',16384)
    if prepared.get('max_completion_tokens'):body['max_output_tokens']=prepared['max_completion_tokens']
    if c.get('verbosity','default')!='default':body['text']={'verbosity':c['verbosity']}
    model=c['model'].lower()
    if model_adapters.vendor(c)=='openai' and (model.startswith('gpt-6') or model.startswith(('gpt-5.6','gpt-5.7','gpt-5.8','gpt-5.9'))) and c.get('cache_mode','auto')!='off':body['prompt_cache_options']={'mode':'implicit'}
    request=Request(base+'/responses',data=json.dumps(body,sort_keys=True).encode(),headers=headers)
    completed=None;fragments=[];calls={};buffer=[];total=0
    try:
        with transport.open(request,timeout=c['timeout']) as response,ExitStack() as resources:
            if c.get('_cancel_token'):resources.enter_context(c['_cancel_token'].resource(lambda:task_control.close_response(response)))
            for raw in response:
                total+=len(raw)
                if total>8_000_000:raise ValueError('Responses 流超过大小限制')
                task_control.check(c)
                line=raw.decode('utf-8').rstrip('\r\n')
                if line.startswith('data:'):buffer.append(line[5:].lstrip());continue
                if line or not buffer:continue
                event=json.loads('\n'.join(buffer));buffer=[];kind=event.get('type')
                if kind=='response.output_text.delta':
                    delta=event.get('delta','');fragments.append(delta)
                    if emit:emit({'type':'delta','text':delta})
                elif kind=='response.reasoning_summary_text.delta' and emit:emit({'type':'reasoning_summary','text':event.get('delta','')})
                elif kind=='response.output_item.added' and event.get('item',{}).get('type')=='function_call':
                    item=event['item'];calls[item['id']]={**item,'arguments':item.get('arguments','')}
                elif kind=='response.function_call_arguments.delta':
                    item=calls.get(event.get('item_id'))
                    if item is not None:item['arguments']+=event.get('delta','')
                elif kind=='response.output_item.done' and event.get('item',{}).get('type')=='function_call':calls[event['item']['id']]=event['item']
                elif kind in ('response.failed','response.incomplete','error'):raise ValueError('OpenAI OAuth 推理未完成，请检查账户额度或重试')
                elif kind=='response.completed':
                    completed=event['response'];c['_reported_usage']=completed.get('usage')
    except HTTPError as error:
        status=error.code;error.close();raise ValueError('OpenAI OAuth 请求失败（HTTP '+str(status)+'），请检查账户授权或额度') from None
    if completed is None or completed.get('status','completed')!='completed':raise ValueError('OpenAI OAuth 流中断，未收到完成事件')
    output=completed.get('output',[])
    final_calls=[item for item in output if item.get('type')=='function_call'] or list(calls.values())
    content=''.join(fragments) or ''.join(part.get('text','') for item in output if item.get('type')=='message' for part in item.get('content',[]) if part.get('type')=='output_text')
    message={'role':'assistant','content':content,'_response_items':output}
    if final_calls:message['tool_calls']=[{'id':item['call_id'],'type':'function','function':{'name':item['name'],'arguments':item.get('arguments','{}')}} for item in final_calls]
    return {'choices':[{'message':message}],'usage':completed.get('usage',{})}
