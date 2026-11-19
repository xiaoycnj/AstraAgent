function libraryIcon(name) {
    const icon = elem('span', 'color-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.style.setProperty('--library-icon', 'url("/assets/icons/library/' + name + '.svg")');
    return icon;
}
const pluginIconNames = new Set(["agent-dispatch", "code-review", "data-lab", "decision-log", "goals", "long-memory", "message-guard", "notebook", "reading-layout", "reply-archive", "research-browser", "skill-creator", "task-board", "workflow-studio", "world-tree", "writing-kit", "writing-studio"]);
function decoratePluginIcons(){
    for(const [index,card] of [...pluginList.children].entries()){
        const plugin=capabilityCatalog.plugins[index];
        if(plugin&&!card.querySelector('.color-icon'))card.prepend(libraryIcon(pluginIconNames.has(plugin.id) ? plugin.id : 'plugin'));
    }
}
new MutationObserver(decoratePluginIcons).observe(pluginList,{childList:true});
decoratePluginIcons();
const hubIconNames={goal:'goals',task:'task-board',tree:'world-tree',note:'notebook',decision:'decision-log',jobs:'agent-dispatch',browser:'research-browser'};
for(const button of hubTabs.children)button.prepend(libraryIcon(hubIconNames[button.dataset.hubTab]));
const iconPanel=settingPanel('icons','图标库','48 枚单色圆角 SVG，点击即可复制源码。');
const iconNav=elem('button');iconNav.type='button';iconNav.dataset.settingsTab='icons';iconNav.append(sidebarIcon('sun'),elem('span','','图标库'));settingsNav.insertBefore(iconNav,$('[data-settings-tab=instructions]'));iconNav.onclick=()=>selectSettingsTab('icons');
const iconGrid=elem('div','icon-library-grid');iconPanel.append(iconGrid);let loadedIconLibrary=false;
async function loadIconLibrary(){
    if(loadedIconLibrary)return;
    const names=await (await fetch('/assets/icons/library/catalog.json')).json();
    iconGrid.replaceChildren();
    for(const name of names){const button=elem('button','icon-library-item');button.type='button';button.append(libraryIcon(name),elem('span','',name));button.title='复制 '+name+' SVG';button.onclick=safely(async()=>{const svg=await (await fetch('/assets/icons/library/'+name+'.svg')).text();await navigator.clipboard.writeText(svg);toast('SVG 已复制');});iconGrid.append(button);}
    loadedIconLibrary=true;
}
const previousIconSettingsTab=selectSettingsTab;
selectSettingsTab=function(name){previousIconSettingsTab(name);$('#settings').scrollTop=0;$('#settings').scrollLeft=0;$('.settings-shell').scrollTop=0;$('.settings-shell').scrollLeft=0;if(name==='icons')loadIconLibrary().catch(error=>toast(error.message));};
// Search sessions in the sidebar without changing the project filter.
const sessionSearch=elem('input');sessionSearch.type='search';sessionSearch.placeholder='搜索会话';sessionSearch.setAttribute('aria-label','搜索会话');listFilters.prepend(sessionSearch);
const previousSearchRenderList=renderList;
renderList=function(){
    previousSearchRenderList(sessionSearch.value.trim().toLowerCase());
};
sessionSearch.oninput=renderList;
const previousBranchMessageMore=showMessageMore;
showMessageMore=function(message){
    previousBranchMessageMore(message);const sourceSession=state.session?.id;
    const branch=actionButton('从此消息创建分支',async()=>{messageMore.close();const session=await api('/api/sessions/'+sourceSession+'/branch','POST',{through_id:message.id});await openSession(session);await refreshList();},'secondary');
    moreActions.prepend(branch);

};
renderList();
