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
const collapsedSessionGroups = new Set();
renderList=function(search = ''){
    listFilters.hidden=state.mode!=='chat';
    if(state.mode!=='chat'){baseWorkspaceRenderList();return}
    const rows=state.sessions.filter(item=>!item.archived&&(!projectFilter||(item.project||'').includes(projectFilter))&&(!search||item.title.toLowerCase().includes(search)));
    $('#item-list').replaceChildren();$('#item-count').textContent=rows.length;
    const groups=new Map();
    for(const item of rows){const key=item.project||'未分组';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item)}
    for(const [name,items] of groups){
        const group = elem('details', 'session-group');
        const heading = elem('summary', 'session-group-title');
        heading.append(elem('span', 'session-group-name', name), elem('span', 'session-group-count', String(items.length)));
        group.open = Boolean(search) || !collapsedSessionGroups.has(name);
        group.addEventListener('toggle', () => {
            if (search || !group.isConnected) return;
            if (group.open) collapsedSessionGroups.delete(name);
            else collapsedSessionGroups.add(name);
        });
        // Keep existing row selectors and the context menu independent of the group toggle.
        group.append(heading);
        for(const item of items){
            const row=elem('div','session-list-row');
            const button=elem('button','list-item'+(state.session?.id===item.id?' active':''));
            if (state.session?.id === item.id) button.setAttribute('aria-current', 'true');
            button.append(sidebarIcon(item.parent_id?'review':'chat'),elem('span','',item.title),elem('small','',String(item.message_count||0)));
            button.onclick=safely(()=>openSession(item));
            row.oncontextmenu=event=>{event.preventDefault();showSessionMenu(item,event.clientX,event.clientY)};
            const more=elem('button','session-more');more.type='button';more.setAttribute('aria-label','会话操作 '+item.title);more.append(sidebarIcon('settings'));more.onclick=()=>{const rect=more.getBoundingClientRect();showSessionMenu(item,rect.right,rect.bottom)};
            row.append(button,more);group.append(row);
        }
        $('#item-list').append(group);
    }
    if(!rows.length)$('#item-list').append(elem('p','hint','这里还没有会话。'));
};
renderList();
// Archived conversations live alongside the other personal settings.
const archivePanel=settingPanel('archives','已归档的聊天','搜索、恢复或管理归档会话。');
const archiveNav=elem('button');
archiveNav.type='button';
archiveNav.dataset.settingsTab='archives';
archiveNav.append(sidebarIcon('note'),elem('span','','已归档的聊天'));
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
