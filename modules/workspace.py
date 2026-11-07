"""File operations share the same permission and project boundary adapters."""
from pathlib import Path
import project_workspace
import workspace_tools
NAMES=workspace_tools.NAMES|{'read_file','write_file','list_files'}
DEFINITIONS=workspace_tools.DEFINITIONS+[
 {'type':'function','function':{'name':name,'description':description,'parameters':{'type':'object','properties':properties,'required':required,'additionalProperties':False}}}
 for name,description,properties,required in [
 ('read_file','读取工作区 UTF-8 文件',{'path':{'type':'string'}},['path']),
 ('write_file','写入工作区 UTF-8 文件',{'path':{'type':'string'},'content':{'type':'string'},'revision':{'type':['string','null']}},['path','content']),
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
    return context['file_tool'](name,args,config.get('project_root')) if allowed else {'error':'用户拒绝或授权已过期'}
