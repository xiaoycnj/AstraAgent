"""Small bounded DAG scheduler; independent work finishes without a batch barrier."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED


def validate(tasks):
    if not isinstance(tasks,list) or not 1<=len(tasks)<=6:raise ValueError('每批需 1–6 个任务')
    nodes=[];ids=set()
    for index,task in enumerate(tasks):
        if not isinstance(task,dict):raise ValueError('子任务格式无效')
        key=task.get('id',str(index+1));deps=task.get('depends_on',[]);retries=task.get('retries',0)
        if not isinstance(key,str) or not key or len(key)>80 or key in ids:raise ValueError('子任务 ID 必须唯一且不为空')
        if not isinstance(deps,list) or any(not isinstance(v,str) for v in deps) or len(deps)>6 or key in deps:raise ValueError('任务依赖无效')
        if type(retries) is not int or not 0<=retries<=2:raise ValueError('重试次数需为 0–2')
        ids.add(key);nodes.append({**task,'id':key,'depends_on':deps,'retries':retries})
    remaining={n['id']:set(n['depends_on']) for n in nodes}
    if any(not deps<=ids for deps in remaining.values()):raise ValueError('任务引用了不存在的依赖')
    while remaining:
        ready={key for key,deps in remaining.items() if not deps}
        if not ready:raise ValueError('任务依赖存在循环')
        remaining={key:deps-ready for key,deps in remaining.items() if key not in ready}
    return nodes


def run(nodes, work, check=lambda:None):
    results={};pending={n['id']:n for n in nodes};running={}
    with ThreadPoolExecutor(max_workers=3) as pool:
        while pending or running:
            check()
            for key,node in list(pending.items()):
                deps=node['depends_on']
                if not all(dep in results for dep in deps):continue
                if any(results[dep].get('error') for dep in deps):
                    results[key]={'name':node['name'],'error':'依赖任务未完成，此任务未执行','status':'blocked'};del pending[key]
                elif len(running)<3:
                    running[pool.submit(work,node,{dep:results[dep] for dep in deps})]=key;del pending[key]
            if running:
                done,_=wait(running,timeout=.15,return_when=FIRST_COMPLETED)
                for future in done:results[running.pop(future)]=future.result()
    return {'agents':[{'task_id':node['id'],**results[node['id']]} for node in nodes]}
