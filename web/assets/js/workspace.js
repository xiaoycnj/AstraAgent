// Keep the settings viewport outside transformed application ancestors.
document.body.append($('#settings'));
// Persistent conversation organization and canvas navigation.
let projectFilter='';
const listFilters=elem('div','workspace-filters');
const projectFilterInput=elem('input');
projectFilterInput.placeholder='筛选项目组';
projectFilterInput.setAttribute('aria-label','筛选项目组');
projectFilterInput.oninput=()=>{projectFilter=projectFilterInput.value.trim();renderList()};
listFilters.append(projectFilterInput);
$('#item-list').before(listFilters);
const sessionMenu=elem('div','session-context-menu');
sessionMenu.hidden=true;
sessionMenu.setAttribute('role','menu');
document.body.append(sessionMenu);
function closeSessionMenu(){sessionMenu.hidden=true}
document.addEventListener('pointerdown',event=>{if(!sessionMenu.contains(event.target))closeSessionMenu()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSessionMenu()});
window.addEventListener('resize',closeSessionMenu);
function showSessionMenu(item,x,y){
    sessionMenu.replaceChildren();
    const actions=[
        [item.archived?'取消归档':'归档','note',async()=>{await api('/api/sessions/'+item.id,'PATCH',{archived:!item.archived});await refreshList()}],
        ['创建分支','review',async()=>{const branch=await api('/api/sessions/'+item.id+'/branch','POST',{});await openSession(branch);await refreshList()}],
        ['移动至项目组','canvas',async()=>{const name=await appPrompt('项目组名称，留空移回未分组',item.project||'');if(name===null)return;await api('/api/sessions/'+item.id,'PATCH',{project:name.trim()});await refreshList()}],
        ['删除','close',async()=>{if(!await appConfirm('永久删除这个会话？'))return;await api('/api/sessions/'+item.id,'DELETE');if(state.session?.id===item.id){state.session=null;state.messages=[];renderMessages();updateHeader()}await refreshList()}]
    ];
    for(const [label,icon,action] of actions){const button=elem('button',label==='删除'?'danger-text':'');button.type='button';button.setAttribute('role','menuitem');button.append(svgIcon(icon),elem('span','',label));button.onclick=safely(async()=>{closeSessionMenu();await action()});sessionMenu.append(button)}
    sessionMenu.hidden=false;
    sessionMenu.style.left=Math.max(8,Math.min(x,innerWidth-sessionMenu.offsetWidth-8))+'px';
    sessionMenu.style.top=Math.max(8,Math.min(y,innerHeight-sessionMenu.offsetHeight-8))+'px';
    sessionMenu.querySelector('button').focus();
}
const baseWorkspaceRenderList=renderList;
renderList=function(){
    listFilters.hidden=state.mode!=='chat';
    if(state.mode!=='chat'){baseWorkspaceRenderList();return}
    const rows=state.sessions.filter(item=>!item.archived&&(!projectFilter||(item.project||'').includes(projectFilter)));
    $('#item-list').replaceChildren();$('#item-count').textContent=rows.length;
    const groups=new Map();
    for(const item of rows){const key=item.project||'未分组';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item)}
    for(const [name,items] of groups){
        $('#item-list').append(elem('div','session-group-title',name));
        for(const item of items){
            const row=elem('div','session-list-row');
            const button=elem('button','list-item'+(state.session?.id===item.id?' active':''));
            button.append(svgIcon(item.parent_id?'review':'chat'),elem('span','',item.title),elem('small','',String(item.message_count||0)));
            button.onclick=safely(()=>openSession(item));
            row.oncontextmenu=event=>{event.preventDefault();showSessionMenu(item,event.clientX,event.clientY)};
            const more=elem('button','session-more');more.type='button';more.setAttribute('aria-label','会话操作 '+item.title);more.append(svgIcon('settings'));more.onclick=()=>{const rect=more.getBoundingClientRect();showSessionMenu(item,rect.right,rect.bottom)};
            row.append(button,more);$('#item-list').append(row);
        }
    }
    if(!rows.length)$('#item-list').append(elem('p','hint','这里还没有会话。'));
};
// Canvas search, topological layout, duplication and clickable overview.
const canvasActions=elem('div','canvas-extra-actions');
const canvasSearch=elem('input');canvasSearch.placeholder='查找节点…';canvasSearch.setAttribute('aria-label','查找画布节点');
const canvasResults=elem('div','canvas-search-results');canvasResults.hidden=true;
const layoutButton=elem('button','','整理');layoutButton.type='button';
const duplicateButton=elem('button','','复制节点');duplicateButton.type='button';
canvasActions.append(canvasSearch,layoutButton,duplicateButton,canvasResults);$('#viewport').append(canvasActions);
const minimap=document.createElementNS('http://www.w3.org/2000/svg','svg');minimap.classList.add('canvas-minimap');minimap.setAttribute('viewBox','0 0 200 120');minimap.setAttribute('aria-label','画布小地图');$('#viewport').append(minimap);
function focusCanvasNode(node){pick(node.id);const viewport=$('#viewport');state.x=viewport.clientWidth/2-(node.x+140)*state.scale;state.y=viewport.clientHeight/2-(node.y+100)*state.scale;viewTransform()}
canvasSearch.oninput=()=>{
    const query=canvasSearch.value.trim().toLowerCase();canvasResults.replaceChildren();canvasResults.hidden=!query;
    if(!query)return;
    const nodes=(state.board?.data.nodes||[]).filter(node=>(node.title+' '+node.content).toLowerCase().includes(query));
    for(const node of nodes){const button=elem('button','',node.title||'未命名');button.type='button';button.onclick=()=>{focusCanvasNode(node);canvasResults.hidden=true};canvasResults.append(button)}
    if(!nodes.length)canvasResults.append(elem('p','hint','没有匹配节点'));
};
layoutButton.onclick=()=>{
    if(!state.board||state.running.size)return;
    const {nodes,edges}=state.board.data;record();
    const levels=new Map(nodes.map(node=>[node.id,0]));
    const pending=new Map(nodes.map(node=>[node.id,edges.filter(edge=>edge.to===node.id).length]));
    const queue=nodes.filter(node=>!pending.get(node.id)).map(node=>node.id);
    for(let index=0;index<queue.length;index++){const id=queue[index];for(const edge of edges.filter(edge=>edge.from===id)){levels.set(edge.to,Math.max(levels.get(edge.to),levels.get(id)+1));pending.set(edge.to,pending.get(edge.to)-1);if(!pending.get(edge.to))queue.push(edge.to)}}
    const columns=new Map();
    for(const node of nodes){const level=levels.get(node.id);const row=columns.get(level)||0;node.x=60+level*360;node.y=70+row*260;columns.set(level,row+1)}
    changed();renderNodes();fit();
};
duplicateButton.onclick=()=>{
    const source=selectedNode();if(!source||state.running.size)return;
    if(state.board.data.nodes.length>=300){toast('画布最多 300 个节点');return}
    record();const node={...source,id:uid(),title:(source.title+' · 副本').slice(0,200),...vacant(source.x+50,source.y+50)};state.board.data.nodes.push(node);changed();renderNodes();focusCanvasNode(node);
};
function drawMinimap(){
    minimap.replaceChildren();const nodes=state.board?.data.nodes||[];if(!nodes.length)return;
    const left=Math.min(...nodes.map(node=>node.x)),top=Math.min(...nodes.map(node=>node.y));
    const width=Math.max(...nodes.map(node=>node.x+280))-left,height=Math.max(...nodes.map(node=>node.y+200))-top;
    const scale=Math.min(184/Math.max(width,1),104/Math.max(height,1));
    for(const node of nodes){const rect=document.createElementNS(minimap.namespaceURI,'rect');rect.setAttribute('x',8+(node.x-left)*scale);rect.setAttribute('y',8+(node.y-top)*scale);rect.setAttribute('width',280*scale);rect.setAttribute('height',200*scale);rect.setAttribute('rx',3);rect.setAttribute('class',node.id===state.selected?'selected':'');rect.onclick=()=>focusCanvasNode(node);minimap.append(rect)}
}
const baseWorkspaceRenderNodes=renderNodes;
renderNodes=function(){baseWorkspaceRenderNodes();drawMinimap()};
const baseWorkspacePick=pick;pick=function(id){baseWorkspacePick(id);drawMinimap()};
canvasActions.addEventListener('pointerdown',event=>event.stopPropagation());minimap.addEventListener('pointerdown',event=>event.stopPropagation());
renderList();drawMinimap();
// Archived conversations live alongside the other personal settings.
const archivePanel=settingPanel('archives','已归档的聊天','搜索、恢复或管理归档会话。');
const archiveNav=elem('button');
archiveNav.type='button';
archiveNav.dataset.settingsTab='archives';
archiveNav.append(svgIcon('note'),elem('span','','已归档的聊天'));
settingsNav.insertBefore(archiveNav,$('[data-settings-tab=voice]'));
archiveNav.onclick=()=>selectSettingsTab('archives');
let archivedSessions=[];
let archiveLoading=0;
const archiveActions=elem('div','archive-heading-actions');
const deleteArchives=actionButton('全部删除',deleteAllArchives,'danger-text');
archiveActions.append(deleteArchives);
archivePanel.prepend(archiveActions);
const archiveFilters=elem('div','archive-filters');
const archiveSearch=elem('input');
archiveSearch.type='search';
archiveSearch.placeholder='搜索已归档的聊天';
archiveSearch.setAttribute('aria-label','搜索已归档的聊天');
const archiveType=elem('select');
archiveType.setAttribute('aria-label','归档会话类型');
for(const [value,label] of [['all','全部聊天'],['ordinary','普通聊天'],['branch','分支聊天']])archiveType.append(new Option(label,value));
const archiveProject=elem('select');
archiveProject.setAttribute('aria-label','归档项目组');
archiveProject.append(new Option('所有项目','all'));
archiveFilters.append(archiveSearch,archiveType,archiveProject);
archivePanel.append(archiveFilters);
buildSelect(archiveType);
buildSelect(archiveProject);
const archiveFeedback=elem('div','archive-feedback');
archiveFeedback.setAttribute('role','status');
const archiveRows=elem('div','archive-rows');
archivePanel.append(archiveFeedback,archiveRows);
archiveSearch.oninput=renderArchives;
archiveType.onchange=renderArchives;
archiveProject.onchange=renderArchives;
async function loadArchives(){
    const request=++archiveLoading;
    archiveFeedback.textContent='正在读取归档…';
    try{
        const rows=await api('/api/sessions');
        if(request!==archiveLoading)return;
        archivedSessions=rows.filter(item=>item.archived);
        const previous=archiveProject.value;
        archiveProject.replaceChildren(new Option('所有项目','all'),new Option('无项目','none'));
        for(const project of [...new Set(archivedSessions.map(item=>item.project).filter(Boolean))].sort()){
            archiveProject.append(new Option(project,'project:'+project));
        }
        archiveProject.value=[...archiveProject.options].some(option=>option.value===previous)?previous:'all';
        archiveProject._refresh?.();
        archiveFeedback.replaceChildren();
        renderArchives();
    }catch(error){
        if(request!==archiveLoading)return;
        archiveRows.replaceChildren();
        archiveFeedback.replaceChildren(elem('span','',error.message),actionButton('重试',loadArchives,'secondary'));
    }
}
function renderArchives(){
    archiveRows.replaceChildren();
    const query=archiveSearch.value.trim().toLowerCase();
    const rows=archivedSessions.filter(item=>{
        const projectMatches=archiveProject.value==='all'||(archiveProject.value==='none'?!item.project:archiveProject.value==='project:'+item.project);
        const typeMatches=archiveType.value==='all'||(archiveType.value==='branch'?Boolean(item.parent_id):!item.parent_id);
        return projectMatches&&typeMatches&&item.title.toLowerCase().includes(query);
    });
    deleteArchives.disabled=archivedSessions.length===0;
    const groups=new Map();
    for(const item of rows){
        const project=item.project||'无项目';
        if(!groups.has(project))groups.set(project,[]);
        groups.get(project).push(item);
    }
    for(const [project,items] of groups){
        const heading=elem('div','archive-group-heading');
        heading.append(svgIcon('canvas'),elem('strong','',project),elem('small','',items.length+' 个聊天'));
        archiveRows.append(heading);
        for(const item of items){
            const row=elem('article','archive-row');
            const info=elem('div','archive-row-info');
            const open=actionButton(item.title,async()=>{
                if(!await closeSettingsPage())return;
                await openSession(item);
            },'archive-title');
            const date=new Date(item.created.replace(' ','T')+'Z');
            info.append(open,elem('small','hint',Number.isNaN(date.getTime())?item.created:date.toLocaleString(document.documentElement.lang||undefined)));
            const remove=actionButton('删除',async()=>{
                if(!await appConfirm('永久删除这个归档会话？'))return;
                await mutateArchive(item,'DELETE');
            },'danger-text');
            const restore=actionButton('取消归档',()=>mutateArchive(item,'PATCH',{archived:false}),'secondary');
            row.append(info,remove,restore);
            archiveRows.append(row);
        }
    }
    if(!rows.length)archiveRows.append(elem('p','archive-empty',archivedSessions.length?'没有匹配的归档会话。':'归档的聊天会显示在这里。'));
}
async function mutateArchive(item,method,body){
    try{
        await api('/api/sessions/'+item.id,method,body);
        if(method==='DELETE'&&state.session?.id===item.id){state.session=null;state.messages=[];renderMessages();updateHeader()}
    }finally{
        await loadArchives();
        await refreshList();
    }
}
async function deleteAllArchives(){
    if(!archivedSessions.length||!await appConfirm('永久删除全部 '+archivedSessions.length+' 个归档会话？'))return;
    deleteArchives.disabled=true;
    let failed=0;
    for(const item of archivedSessions){
        try{
            await api('/api/sessions/'+item.id,'DELETE');
            if(state.session?.id===item.id){state.session=null;state.messages=[];renderMessages();updateHeader()}
        }catch(error){failed++}
    }
    await loadArchives();
    await refreshList();
    if(failed)archiveFeedback.textContent=failed+' 个会话未能删除，请等待生成完成后重试。';
}
const previousArchiveSettingsTab=selectSettingsTab;
selectSettingsTab=function(name){
    previousArchiveSettingsTab(name);
    if(name==='archives')loadArchives();
};
