// Compact conversation toolbar with the workbench as the rightmost control.
const headerActions=$('.header-actions');
const headerMore=elem('button','header-icon');
headerMore.type='button';headerMore.id='conversation-more';
headerMore.title='更多会话操作';headerMore.setAttribute('aria-label','更多会话操作');
headerMore.setAttribute('aria-expanded','false');headerMore.setAttribute('aria-controls','conversation-menu');
headerMore.append(svgIcon('more'));
const headerMenu=elem('div','conversation-menu');
headerMenu.id='conversation-menu';headerMenu.hidden=true;headerMenu.setAttribute('role','menu');
$('.topbar').append(headerMenu);
const headerOriginals={rename:$('#rename'),export:$('#export'),delete:$('#delete'),project:projectButton,window:newWindowButton};
const headerPin=actionButton('',async()=>{
    if(!state.session)return;
    const pinned=!state.session.pinned;
    await api('/api/sessions/'+state.session.id,'PATCH',{pinned});
    state.session.pinned=pinned;await refreshList();
},'');
const headerBranch=actionButton('创建分支',async()=>{
    if(!state.session)return;
    const branch=await api('/api/sessions/'+state.session.id+'/branch','POST',{});
    await openSession(branch);await refreshList();
},'');
const headerTask=actionButton('任务看板',()=>{hubView='task';hubOpen.click();},'');
function headerTranscript(){
    return '# '+(state.session?.title||'AstraAgent')+'\n\n'+state.messages.map(message=>'## '+(message.role==='user'?'我':'AstraAgent')+'\n\n'+message.content).join('\n\n');
}
const headerShare=actionButton('分享',async()=>{
    if(navigator.share){
        try{await navigator.share({title:state.session?.title||'AstraAgent',text:headerTranscript()});return;}
        catch(error){if(error.name==='AbortError')return;}
    }
    headerOriginals.export.click();
},'');
const headerCopy=actionButton('复制对话',async()=>{await navigator.clipboard.writeText(headerTranscript());toast('对话已复制');},'');
const headerArchive=actionButton('',async()=>{
    if(!state.session)return;
    const archived=!state.session.archived;
    await api('/api/sessions/'+state.session.id,'PATCH',{archived});
    state.session.archived=archived;await refreshList();
},'');
const headerRows=[
    [headerOriginals.rename,'note',false],
    [headerPin,'pin',true],
    [headerBranch,'review',true],
    [headerTask,'tools',true],
    [headerShare,'share',true],
    [headerCopy,'copy',true],
    [headerOriginals.export,'download',false],
    [headerOriginals.window,'window',false],
    [headerOriginals.project,'canvas',false],
    [headerArchive,'archive',true],
    [headerOriginals.delete,'close',false],
];
const headerPaths={pin:'m15 3 6 6-4 1-4 5-1 4-7-7 4-1 5-4 1-4ZM3 21l5-5',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',window:'M3 3h18v18H3zM3 8h18',archive:'M3 3h18v5H3zM5 8v13h14V8M9 12h6'};
for(const [button,name] of headerRows){
    const label=button.textContent;
    button.replaceChildren();
    const icon=svgIcon(headerPaths[name]?'note':name);
    if(headerPaths[name])icon.querySelector('path').setAttribute('d',headerPaths[name]);
    button.append(icon,elem('span','',label));
    button.type='button';button.setAttribute('role','menuitem');
    button.addEventListener('click',closeHeaderMenu);
    headerMenu.append(button);
}
function closeHeaderMenu(){headerMenu.hidden=true;headerMore.setAttribute('aria-expanded','false');}
function syncHeaderMenu(){
    const chat=state.mode==='chat'&&!!state.session;
    headerPin.querySelector('span').textContent=uiText(state.session?.pinned?'取消置顶':'置顶');
    headerArchive.querySelector('span').textContent=uiText(state.session?.archived?'取消归档':'归档');
    for(const [button,,chatOnly] of headerRows)if(chatOnly)button.hidden=!chat;
    headerMore.hidden=!$('#settings').hidden;
    openWorkbenchButton.hidden=!$('#settings').hidden;
    if(!$('#settings').hidden)closeHeaderMenu();
}
headerMore.onclick=()=>{
    if(!headerMenu.hidden){closeHeaderMenu();return;}
    closeResources();syncHeaderMenu();headerMenu.hidden=false;headerMore.setAttribute('aria-expanded','true');
    headerMenu.querySelector('button:not([hidden]):not(:disabled)')?.focus();
};
headerMenu.addEventListener('keydown',event=>{
    const rows=[...headerMenu.querySelectorAll('button:not([hidden]):not(:disabled)')];
    const index=rows.indexOf(document.activeElement);
    if(event.key==='Escape'){closeHeaderMenu();headerMore.focus();event.preventDefault();}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();
        const next=event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
        rows[next]?.focus();
    }
});
document.addEventListener('pointerdown',event=>{if(!headerMenu.contains(event.target)&&!headerMore.contains(event.target))closeHeaderMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!headerMenu.hidden){closeHeaderMenu();headerMore.focus();}});
const headerDivider=elem('span','header-divider');headerDivider.setAttribute('aria-hidden','true');
const workbenchPlus=svgIcon('plus');
openWorkbenchButton.replaceChildren(workbenchPlus);openWorkbenchButton.title='打开工作台';openWorkbenchButton.setAttribute('aria-label','打开工作台');
openWorkbenchButton.classList.add('header-icon');
const headerStorageStatus=$('#save-status');
headerActions.replaceChildren(headerMore,resourceButton,headerDivider,openWorkbenchButton);
// The save status remains available inside the menu.
if(headerStorageStatus)headerMenu.append(headerStorageStatus);
const beforeCompactHeader=updateHeader;
updateHeader=function(){beforeCompactHeader();closeHeaderMenu();syncHeaderMenu();};
syncHeaderMenu();
