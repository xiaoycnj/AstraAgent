// Agent hub: goals, task board, persistent world tree and reader browser.
const hubDialog=elem('dialog','hub-dialog');
const hubHeader=elem('header','hub-header');
hubHeader.append(elem('div','','ASTRA / AGENT HUB'));
const hubClose=elem('button','secondary','返回工作空间');hubClose.type='button';hubClose.onclick=()=>hubDialog.close();hubHeader.append(hubClose);
const hubTabs=elem('nav','hub-tabs');
const hubBody=elem('div','hub-body');hubDialog.append(hubHeader,hubTabs,hubBody);document.body.append(hubDialog);
const hubOpen=elem('button','settings-button');hubOpen.type='button';hubOpen.append(svgIcon('tools'),elem('span','','Agent 工作台'));$('.side-bottom').prepend(hubOpen);
let hubData={records:[],jobs:[],pages:[]},hubView='goal',browserHistory=[],browserIndex=-1;
const hubKinds={goal:'目标',task:'任务看板',tree:'世界树',note:'笔记库',decision:'决策日志',jobs:'子智能体',browser:'内部浏览器'};
const hubStatus={todo:'待开始',active:'进行中',blocked:'已阻塞',done:'已完成',archived:'已归档'};
for(const [kind,label] of Object.entries(hubKinds)){
    const button=elem('button','',label);button.type='button';button.dataset.hubTab=kind;
    button.onclick=safely(async()=>{hubView=kind;await refreshHub()});hubTabs.append(button);
}
async function refreshHub(){hubData=await api('/api/hub');renderHub()}
hubOpen.onclick=safely(async()=>{hubDialog.showModal();await refreshHub()});
function hubAction(label,action){const button=elem('button','secondary',label);button.type='button';button.onclick=safely(action);return button}
async function saveHubRecord(body){await api('/api/hub/record','POST',body);await refreshHub()}
async function editHubRecord(kind,item=null,parent=''){
    if(item?.truncated){try{item=await api('/api/hub/record/'+item.id)}catch(error){toast(error.message);return}}
    hubBody.replaceChildren();const form=elem('form','hub-editor');
    const title=elem('input');title.placeholder='标题';title.required=true;title.maxLength=200;title.value=item?.title||'';title.setAttribute('aria-label','记录标题');
    const content=elem('textarea');content.placeholder='内容、验收条件或事实依据';content.rows=8;content.maxLength=12000;content.value=item?.content||'';content.setAttribute('aria-label','记录内容');
    const parentInput=elem('input');parentInput.placeholder='父目标 / 世界树节点 ID（可留空）';parentInput.value=item?.parent||parent;parentInput.setAttribute('aria-label','父记录 ID');
    const status=elem('select');status.setAttribute('aria-label','状态');for(const [value,label] of Object.entries(hubStatus))status.append(new Option(label,value));status.value=item?.status||'todo';
    const save=elem('button','primary','保存');const cancel=hubAction('取消',async()=>renderHub());
    const feedback=elem('p','hint');feedback.setAttribute('role','status');form.append(elem('h2','',(item?'编辑':'新增')+' '+hubKinds[kind]),title,content,parentInput,status,feedback,save,cancel);hubBody.append(form);buildSelect(status);
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await saveHubRecord({kind,action:item?'update':'create',...(item?{id:item.id}:{}),title:title.value,content:content.value,parent:parentInput.value,status:status.value})}catch(error){feedback.textContent=error.message}finally{save.disabled=false}};
    title.focus();
}
function hubCard(item){
    const card=elem('article','hub-card');card.append(elem('small','',hubStatus[item.status]||item.status),elem('h3','',item.title),elem('p','',item.content));
    if(item.parent){const parent=hubData.records.find(record=>record.id===item.parent);card.append(elem('small','hint','关联 '+(parent?.title||item.parent)))}
    const actions=elem('div','hub-card-actions');actions.append(hubAction('编辑',async()=>editHubRecord(item.kind,item)));
    if(item.kind==='goal')actions.append(hubAction('添加任务',async()=>editHubRecord('task',null,item.id)));
    if(item.kind==='tree')actions.append(hubAction('生长分支',async()=>editHubRecord('tree',null,item.id)));
    if(item.status!=='done'&&item.kind!=='tree')actions.append(hubAction('完成',async()=>saveHubRecord({kind:item.kind,id:item.id,action:'update',status:'done'})));
    actions.append(hubAction('删除',async()=>{if(confirm('删除这条记录？'))await saveHubRecord({kind:item.kind,id:item.id,action:'delete'})}));card.append(actions);
    if(item.kind==='goal'){
        const tasks=hubData.records.filter(record=>record.kind==='task'&&record.parent===item.id);const completed=tasks.filter(task=>task.status==='done').length;
        card.append(elem('small','hint',`${completed} / ${tasks.length} 个关联任务完成`));
    }
    return card;
}
function renderWorldTree(rows){
    const graph=document.createElementNS('http://www.w3.org/2000/svg','svg');graph.classList.add('world-tree-graph');graph.setAttribute('role','img');graph.setAttribute('aria-label','世界树长期记忆关系');
    const positions=new Map();const visible=rows.slice(0,100);
    function depth(item){let level=0,cursor=item;const seen=new Set();while(cursor?.parent&&!seen.has(cursor.id)){seen.add(cursor.id);cursor=visible.find(node=>node.id===cursor.parent);if(cursor)level++}return Math.min(level,6)}
    visible.forEach((item,index)=>positions.set(item.id,{x:25+depth(item)*60,y:30+index*55}));
    graph.setAttribute('viewBox',`0 0 720 ${Math.max(160,visible.length*55+30)}`);
    for(const item of visible){const point=positions.get(item.id),parent=positions.get(item.parent);if(parent){const edge=document.createElementNS(graph.namespaceURI,'path');edge.setAttribute('d',`M ${parent.x+8} ${parent.y} V ${point.y} H ${point.x}`);edge.classList.add('world-tree-edge');graph.append(edge)}const node=document.createElementNS(graph.namespaceURI,'g');node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label','编辑 '+item.title);const circle=document.createElementNS(graph.namespaceURI,'circle');circle.setAttribute('cx',point.x);circle.setAttribute('cy',point.y);circle.setAttribute('r',7);const label=document.createElementNS(graph.namespaceURI,'text');label.setAttribute('x',point.x+18);label.setAttribute('y',point.y+5);label.textContent=item.title.slice(0,32);node.append(circle,label);node.onclick=()=>editHubRecord('tree',item);node.onkeydown=event=>{if(event.key==='Enter')editHubRecord('tree',item)};graph.append(node)}
    hubBody.append(graph);
}
function renderHub(){
    hubBody.replaceChildren();for(const button of hubTabs.children)button.classList.toggle('active',button.dataset.hubTab===hubView);
    if(hubView==='browser'){renderReaderBrowser();return}
    const heading=elem('div','hub-section-heading');heading.append(elem('h2','',hubKinds[hubView]),hubAction('刷新',refreshHub));
    if(hubView!=='jobs')heading.append(hubAction('新增',async()=>editHubRecord(hubView)));hubBody.append(heading);
    if(hubView==='jobs'){
        hubBody.append(elem('p','hint','在对话中让智能体派发任务，例如“派三个子智能体分别研究、审阅、汇总这个方案”。使用当前 API 和模型，每批最多三项。'));
        for(const job of hubData.jobs){const card=elem('article','hub-card');card.append(elem('small','',job.status+' · '+job.model),elem('h3','',job.name),elem('p','',job.result||job.task),hubAction('打开会话',async()=>{const session=(await api('/api/sessions')).find(row=>row.id===job.session_id);if(session){hubDialog.close();await openSession(session)}}));hubBody.append(card)}
        if(!hubData.jobs.length)hubBody.append(elem('p','hub-empty','派发后的子智能体会出现在这里。'));return;
    }
    const rows=hubData.records.filter(item=>item.kind===hubView);
    if(hubView==='tree'){
        hubBody.append(elem('p','hint','长期事实会在对话完成后自动提炼，保存到 memory/ 与世界树。点击节点编辑，使用“生长分支”建立关系。'));
        renderWorldTree(rows);
    }
    if(hubView==='task'){
        const board=elem('div','hub-kanban');for(const status of ['todo','active','blocked','done']){const column=elem('section','hub-kanban-column');column.append(elem('h3','',hubStatus[status]));for(const item of rows.filter(record=>record.status===status))column.append(hubCard(item));board.append(column)}hubBody.append(board);
    }else{const grid=elem('div','hub-grid');for(const item of rows)grid.append(hubCard(item));hubBody.append(grid)}
    if(hubData.next_offset!==null&&hubData.next_offset!==undefined)hubBody.append(hubAction('加载更多',async()=>{const next=await api('/api/hub?offset='+hubData.next_offset);hubData={...next,records:[...hubData.records,...next.records]};renderHub()}));
    if(!rows.length)hubBody.append(elem('p','hub-empty','从一条'+hubKinds[hubView]+'开始。'));
}
function renderReaderBrowser(){
    const bar=elem('form','hub-browser-bar');const url=elem('input');url.type='url';url.required=true;url.placeholder='https://example.com';url.setAttribute('aria-label','浏览器地址');const go=elem('button','primary','打开');const back=hubAction('后退',async()=>{if(browserIndex>0){browserIndex--;await showStoredPage(browserHistory[browserIndex])}});bar.append(back,url,go);hubBody.append(bar);
    hubBody.append(elem('p','hint','阅读模式浏览器 · 提取公网网页正文与链接。动态网页、登录和网页脚本交互需使用外部浏览器。'));
    const reader=elem('article','hub-reader');hubBody.append(reader);
    async function showPage(page){
        url.value=page.url;reader.replaceChildren();const source=elem('a','','在系统浏览器打开原页');source.href=page.url;source.target='_blank';source.rel='noopener noreferrer';const find=elem('input');find.placeholder='在此页查找文字';find.setAttribute('aria-label','页内搜索');const body=elem('div','hub-reader-text');body.textContent=page.content;const matches=elem('p','hint');find.oninput=()=>{const query=find.value.trim();matches.textContent=query?`${page.content.toLowerCase().split(query.toLowerCase()).length-1} 处匹配`:'';body.textContent='';if(!query){body.textContent=page.content;return}let start=0,index;const lower=page.content.toLowerCase();while((index=lower.indexOf(query.toLowerCase(),start))>=0){body.append(document.createTextNode(page.content.slice(start,index)));const mark=elem('mark','',page.content.slice(index,index+query.length));body.append(mark);start=index+query.length}body.append(document.createTextNode(page.content.slice(start)))};
        reader.append(elem('h2','',page.title),source,find,matches,body);const links=typeof page.links==='string'?JSON.parse(page.links):page.links;const details=elem('details');details.append(elem('summary','',`${links.length} 个页面链接`));for(const link of links){const button=hubAction(link,async()=>navigate(link));details.append(button)}reader.append(details);
    }
    async function showStoredPage(id){await showPage(await api('/api/hub/page/'+id))}
    async function navigate(value){go.disabled=true;reader.textContent='正在读取网页…';try{const page=await api('/api/hub/browser','POST',{url:value});browserHistory=browserHistory.slice(0,browserIndex+1);browserHistory.push(page.page_id);browserIndex++;await showPage(page)}catch(error){reader.textContent=error.message}finally{go.disabled=false}}
    bar.onsubmit=event=>{event.preventDefault();navigate(url.value)};
    if(browserIndex>=0)showStoredPage(browserHistory[browserIndex]).catch(error=>reader.textContent=error.message);
    else for(const page of hubData.pages)reader.append(hubAction(page.title,async()=>{browserHistory.push(page.id);browserIndex=browserHistory.length-1;await showStoredPage(page.id)}));
}
Object.assign(eventNames,{subagent_start:'子智能体开始',subagent_done:'子智能体完成',subagent_failed:'子智能体失败'});
if(localStorage.getItem('astra-tools-v111')!=='true'){allowTools.checked=true;localStorage.setItem('astra-allow-tools','true');localStorage.setItem('astra-tools-v111','true');saveRuntime()}

setInterval(()=>{if(hubDialog.open&&hubView==='jobs')refreshHub().catch(()=>{})},3000);
