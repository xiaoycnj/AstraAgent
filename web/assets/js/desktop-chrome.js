// Compact desktop chrome and a two-level composer shelf.
const composerShelf=elem('div','composer-shelf');
const shelfProject=actionButton('选择项目',showProjectManager,'shelf-project');shelfProject.prepend(svgIcon('folder'));
const device=elem('span','composer-device');device.append(svgIcon('terminal'),elem('strong','','此计算机'));
composerShelf.append(shelfProject,device);$('#chat-form').before(composerShelf);
const oldShelfUpdate=updateProjectControls;updateProjectControls=function(){oldShelfUpdate();shelfProject.lastChild.textContent=currentProject()?.name||'选择项目'};
const appMenu=elem('nav','desktop-menubar');appMenu.setAttribute('aria-label','应用菜单');
for(const [name,items] of [['文件',[['新建会话',()=>$('#new-item').click()],['打开项目',showProjectManager],['设置',showSettings]]],['编辑',[['撤销',()=>document.execCommand('undo')],['重做',()=>document.execCommand('redo')],['全选',()=>{const input=$('#chat-input');input?.focus();input?.select()}]]],['视图',[['重新加载',()=>location.reload()],['切换主题',()=>$('#theme-toggle')?.click()]]],['帮助',[['检查更新',checkAppUpdate],['关于 AstraAgent',()=>{showSettings();selectSettingsTab('about')}]]]]){
 const menu=elem('details','app-menu'),title=elem('summary','',name),list=elem('div','app-menu-list');menu.append(title,list);
 for(const [label,action] of items)list.append(actionButton(label,async()=>{menu.open=false;await action()},'app-menu-item'));
 menu.ontoggle=()=>{if(menu.open)for(const other of appMenu.querySelectorAll('details'))if(other!==menu)other.open=false};appMenu.append(menu);
}
document.body.prepend(appMenu);document.body.classList.add('has-app-menu');
const updateButton=actionButton('检查应用更新',checkAppUpdate,'secondary');aboutPanel.append(updateButton);
async function checkAppUpdate(){
 const bridge=window.pywebview?.api;
 if(!bridge){toast('应用内安装需要使用桌面版。请在 GitHub Releases 下载发行包。');return}
 updateButton.disabled=true;
 try{const release=await bridge.check_update();if(!release.available){toast('当前已是最新版本');return}if(!release.can_install){toast('源码工作区请通过 Git 更新');return}if(await appConfirm('发现 '+release.version+'。更新将关闭所有应用窗口，完成后重新启动。请先保存编辑内容。是否继续？')){
 if(state.pending.size)throw new Error('请先停止运行中的任务');
 await bridge.install_update();
 }}catch(error){toast(error.message||String(error))}finally{updateButton.disabled=false}
}
