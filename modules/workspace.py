"""File operations share the same permission and project boundary adapters."""
from pathlib import Path
import project_workspace
import workspace_tools
import attachments
import base64
import task_control
import sqlite3
NAMES=workspace_tools.NAMES|{'read_file','write_file','list_files'}
DEFINITIONS=workspace_tools.DEFINITIONS+[
 {'type':'function','function':{'name':name,'description':description,'parameters':{'type':'object','properties':properties,'required':required,'additionalProperties':False}}}
 for name,description,properties,required in [
 ('read_file','读取工作区 UTF-8 文件',{'path':{'type':'string'}},['path']),
 ('write_file','写入工作区 UTF-8 文件。用户要求直接交付文件时设 deliver=true，返回真实下载链接并保存至会话产物，适用于 HTML、SVG、Markdown、代码及数据文件。',{'path':{'type':'string'},'content':{'type':'string'},'revision':{'type':['string','null']},'deliver':{'type':'boolean'}},['path','content']),
 ('list_files','列出工作区文件',{},[])]]

def execute(args,config,context,name):
    emit=context['emit'];approve=context['approve']
    if name in workspace_tools.NAMES:
        if config.get('project_root'):
            for field in ('path','destination'):
                if args.get(field) and args[field]!='.':project_workspace.target(Path(config['project_root']),args[field])
            if name=='replace_in_file' and not args.get('sha256'):raise ValueError('项目替换需提供 SHA-256')
        return workspace_tools.invoke(context['data'],name,args,config,(emit or (lambda event:None)) if config.get('access_policy') else emit,approve)
    if (not emit and not config.get('_authorized_tool')) or config.get('file_permission','none')=='none':return {'error':'文件访问未授权'}
    needs_approval=config['file_permission']=='ask' or (name=='write_file' and config['file_permission']!='all')
    allowed=config.get('_authorized_tool')==name or not needs_approval or approve(name,args,emit)
    if not allowed:return {'error':'用户拒绝或授权已过期'}
    if name=='write_file' and 'deliver' in args and type(args['deliver']) is not bool:
        raise ValueError('deliver 必须为布尔值')
    result=context['file_tool'](name,args,config.get('project_root'))
    if name=='write_file' and args.get('deliver') and isinstance(result,dict) and not result.get('error'):
        # The authorized write already succeeded. Delivery errors must not turn
        # it into an apparent write failure and encourage duplicate mutations.
        try:
            item=deliver(args,config,context)
            url='/api/attachments/'+item['id']+'/content'
            result={**result,'attachment':item,'url':url,'markdown':'[下载文件]('+url+')'}
            if emit:emit({'type':'file_generated','name':'write_file','result':result})
        except (ValueError,OSError,sqlite3.Error) as error:
            result={**result,'delivery_error':str(error)[:300]}
    return result


def deliver(args,config,context):
    sid=config.get('_session_id')
    if not sid or 'database' not in context:
        raise ValueError('文件已写入，当前执行没有可关联的会话')
    task_control.check(config)
    item=attachments.upload(context['data'],{'name':Path(args['path']).name,'data':base64.b64encode(args['content'].encode('utf-8')).decode('ascii')})
    try:
        task_control.check(config)
        with context['database']() as db:
            db.execute('INSERT INTO session_outputs(session_id,attachment_id) VALUES(?,?)',(sid,item['id']))
    except BaseException:
        folder=attachments.location(context['data'],item['id'])
        (folder/'content').unlink(missing_ok=True)
        (folder/'meta.json').unlink(missing_ok=True)
        folder.rmdir()
        raise
    return item
