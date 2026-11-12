// Application hooks share the persisted plugin switches and the existing message lifecycle.
let applicationHooks=[];
const applicationPanels=elem('div','plugin-application-panels');pluginSection.append(applicationPanels);
async function refreshApplicationPlugins(){
 applicationHooks=[];applicationPanels.replaceChildren();document.body.classList.remove('plugin-reading-compact','plugin-reading-comfortable');
 for(const plugin of capabilityCatalog.plugins.filter(p=>p.enabled)){
  for(const hook of plugin.hooks||[]){applicationHooks.push({...hook,plugin:plugin.id});if(hook.event==='startup'&&hook.action==='reading_layout')document.body.classList.add('plugin-reading-'+hook.value);}
  for(const panel of plugin.panels||[]){applicationPanels.append(actionButton(panel.title,()=>{const dialog=elem('dialog','app-dialog');dialog.append(elem('h2','',panel.title),elem('p','',panel.text),actionButton('关闭',()=>dialog.close(),'secondary'));dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();},'secondary'));}
 }
}
const beforeApplicationReload=reloadCapabilities;reloadCapabilities=async function(){await beforeApplicationReload();await refreshApplicationPlugins()};
const beforePluginSend=sendMessage;
sendMessage=async function(event){
 const input=$('#chat-input');if(submitting||!input.value.trim()&&!pendingAttachments.length)return beforePluginSend(event);
 for(const hook of applicationHooks.filter(h=>h.event==='before_send')){
  if(hook.action==='limit_length'&&input.value.length>hook.value){event.preventDefault();toast('插件限制消息长度：'+hook.value);return;}
 }
 for(const hook of applicationHooks.filter(h=>h.event==='before_send'&&h.action==='prefix'))if(!input.value.startsWith(hook.value))input.value=hook.value+input.value;
 const previous=state.messages.at(-1)?.id;
 await beforePluginSend(event);
 const answer=state.messages.at(-1),sid=state.session?.id;
 if(!sid||answer?.role!=='assistant'||!answer.id||answer.id===previous)return;
 for(const hook of applicationHooks.filter(h=>h.event==='after_response')){
  try{
   if(hook.action==='notify')toast(hook.value||'回复已完成');
  }catch(error){toast('插件 '+hook.plugin+'：'+error.message);}
 }
};
$('#chat-form').onsubmit=sendMessage;
const pluginMaker=elem('dialog','plugin-maker');pluginMaker.setAttribute('aria-label','插件制作器');
const makerForm=elem('form');const makerId=field('插件 ID','maker-id'),makerName=field('插件名称','maker-name'),makerDescription=field('插件说明','maker-description');
const makerAction=elem('select');makerAction.setAttribute('aria-label','应用行为');
for(const [value,label] of [['save_output','回复完成后自动归档'],['limit_length','发送前检查消息长度'],['prefix','发送前添加文字'],['reading_layout','切换阅读布局'],['notify','回复完成后提醒']])makerAction.append(new Option(label,value));
const makerValue=field('动作参数','maker-value');makerValue.input.placeholder='消息长度填数字；阅读布局填 compact 或 comfortable';
const makerPage=field('插件页面标题','maker-page'),makerText=field('插件页面内容','maker-text','text',4);
const makerPreview=elem('pre','plugin-manifest-preview');makerPreview.setAttribute('aria-label','插件清单预览');
function makerManifest(){const action=makerAction.value;return {schema_version:2,id:makerId.input.value.trim(),name:makerName.input.value.trim(),version:'1.0.0',description:makerDescription.input.value.trim(),hooks:[{event:action==='reading_layout'?'startup':['save_output','notify'].includes(action)?'after_response':'before_send',action,value:action==='limit_length'?Number(makerValue.input.value):makerValue.input.value}],panels:makerPage.input.value?[{title:makerPage.input.value,text:makerText.input.value}]:[]};}
function previewMaker(){makerPreview.textContent=JSON.stringify(makerManifest(),null,2)}
makerForm.append(elem('h2','','插件制作器'),makerId.label,makerName.label,makerDescription.label,makerAction,makerValue.label,makerPage.label,makerText.label,makerPreview);
const makerInstall=elem('button','primary','安装插件');makerInstall.type='submit';
makerForm.append(actionButton('导出清单',()=>download((makerId.input.value||'plugin')+'.json',JSON.stringify(makerManifest(),null,2),'application/json'),'secondary'),makerInstall,actionButton('关闭',()=>pluginMaker.close(),'secondary'));
makerForm.oninput=previewMaker;makerForm.onsubmit=safely(async event=>{event.preventDefault();if(!await appConfirm('安装这个应用插件？安装后可在插件列表启用。'))return;await api('/api/plugins/install','POST',makerManifest());await reloadCapabilities();pluginMaker.close();toast('插件已安装');});pluginMaker.append(makerForm);document.body.append(pluginMaker);buildSelect(makerAction);
const importPlugin=elem('input');importPlugin.type='file';importPlugin.accept='.json';importPlugin.hidden=true;document.body.append(importPlugin);
importPlugin.onchange=safely(async()=>{const file=importPlugin.files[0];if(!file)return;try{if(file.size>100000)throw new Error('插件清单超过 100 KB');const value=JSON.parse(await file.text());if(!await appConfirm('导入插件 '+String(value.name||'')+'？请核对来源及行为声明。'))return;await api('/api/plugins/install','POST',value);await reloadCapabilities();toast('插件已安装');}finally{importPlugin.value='';}});
integrationBar.append(actionButton('创建应用插件',()=>{previewMaker();pluginMaker.showModal()},'secondary'),actionButton('导入应用插件',()=>importPlugin.click(),'secondary'));
reloadCapabilities().catch(error=>toast(error.message));
