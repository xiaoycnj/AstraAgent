// A permanent application rail; the conversation pane has its own saved width state.
const appRail=elem('nav','app-rail glass-surface');appRail.setAttribute('aria-label','主导航');
const railTop=elem('div','rail-top'),railBottom=elem('div','rail-bottom');appRail.append(railTop,railBottom);$('#app').prepend(appRail);
const railButtons=new Map();let railActive='home';
$('#new-item').classList.remove('primary');
function railIcon(name){const span=elem('span','rail-glyph');for(const state of ['outline','active']){const img=elem('img','glyph-'+state);img.src='/assets/icons/navigation/'+name+'-'+state+'.svg';img.alt='';img.width=22;img.height=22;span.append(img)}return span}
function selectRail(name){railActive=name;for(const [id,b] of railButtons){b.classList.toggle('active',id===name);if(id===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}}
function makeRailButton(id,label,action,target=railTop){const b=actionButton('',async()=>{selectRail(id);await action()},'rail-button');b.id='nav-'+id;b.setAttribute('aria-label',label);b.title=label;b.append(railIcon(id),elem('span','rail-tooltip',label));target.append(b);railButtons.set(id,b);return b}
async function railHome(){if(!$('#settings').hidden&&!closeSettingsPage())return;if(state.mode!=='chat')await switchMode('chat');$('#chat-input').focus({preventScroll:true})}
makeRailButton('home','主页',railHome);
makeRailButton('images','生图',()=>openRailCollection('images'));
makeRailButton('schedule','定时任务',async()=>{hubView='task';hubDialog.showModal();await refreshHub();const notice=elem('p','hint','当前提供任务看板；定时触发执行尚未接入，不会在后台自动运行。');hubBody.prepend(notice)});
makeRailButton('library','资料库',()=>openRailCollection('library'));
makeRailButton('plugins','插件管理',()=>{showSettings();selectSettingsTab('capabilities')});
const railMore=makeRailButton('more','更多',()=>{railMenu.hidden=!railMenu.hidden;railMore.setAttribute('aria-expanded',String(!railMenu.hidden));if(!railMenu.hidden)railMenu.querySelector('button').focus()});railMore.setAttribute('aria-haspopup','menu');railMore.setAttribute('aria-expanded','false');
railTop.append(elem('div','rail-divider'));
makeRailButton('review','代码审阅',async()=>{await railHome();openWorkbench('files');reviewFile.focus({preventScroll:true})});
makeRailButton('settings','设置',()=>showSettings(),railBottom);
makeRailButton('profile','个人资料',()=>{showSettings();selectSettingsTab('profile');loadPersonal().catch(e=>toast(e.message))},railBottom);

const railMenu=elem('div','rail-menu');railMenu.hidden=true;railMenu.setAttribute('role','menu');
for(const [label,icon,action] of [['无限画布','canvas',()=>switchMode('canvas')],['Agent 工作台','plugins',()=>hubOpen.click()],['项目管理','library',showProjectManager],['搜索与筛选','search',()=>{setConversationPane(true);listFilters.classList.add('filters-expanded');sessionSearch.focus()}],['已归档的聊天','library',()=>{showSettings();selectSettingsTab('archives')}],['切换主题','theme',()=>$('#theme-toggle').click()]]){const b=actionButton('',async()=>{railMenu.hidden=true;railMore.setAttribute('aria-expanded','false');await action()},'rail-menu-item');b.setAttribute('role','menuitem');b.append(railIcon(icon),elem('span','',label));railMenu.append(b)}document.body.append(railMenu);
function closeRailMenu(){railMenu.hidden=true;railMore.setAttribute('aria-expanded','false')}
document.addEventListener('pointerdown',e=>{if(!railMenu.contains(e.target)&&!railMore.contains(e.target))closeRailMenu()});
railMenu.addEventListener('keydown',e=>{const items=[...railMenu.querySelectorAll('button')];const index=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus()}if(e.key==='Escape')railMore.focus()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeRailMenu();if(innerWidth<=760)setConversationPane(false)}if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==='KeyS'){e.preventDefault();setConversationPane(document.body.classList.contains('conversation-collapsed'))}});

const sidebarToggle=actionButton('',()=>setConversationPane(document.body.classList.contains('conversation-collapsed')),'sidebar-toggle');sidebarToggle.id='sidebar-toggle';sidebarToggle.title='显示/隐藏会话栏 · Ctrl+Shift+S';sidebarToggle.setAttribute('aria-label','显示/隐藏会话栏');sidebarToggle.setAttribute('aria-controls','conversation-sidebar');sidebarToggle.append(railIcon('panel'));appMenu.prepend(sidebarToggle);
$('.sidebar').id='conversation-sidebar';
function setConversationPane(open,save=true){if(!open&&$('.sidebar').contains(document.activeElement))sidebarToggle.focus({preventScroll:true});document.body.classList.toggle('conversation-collapsed',!open);$('.sidebar').classList.remove('open');$('.sidebar').inert=!open;sidebarToggle.setAttribute('aria-expanded',String(open));if(save)try{localStorage.setItem('astra-conversation-pane',String(open))}catch{}if(state.mode==='canvas')setTimeout(()=>{renderNodes()},220)}
let savedConversationPane;try{savedConversationPane=localStorage.getItem('astra-conversation-pane')}catch{}
setConversationPane(innerWidth>760&&savedConversationPane!=='false',false);
$('#open-side').onclick=()=>setConversationPane(true);$('#close-side').onclick=()=>setConversationPane(false);
matchMedia('(max-width:760px)').addEventListener('change',e=>{if(e.matches)setConversationPane(false,false);else setConversationPane(localStorage.getItem('astra-conversation-pane')!=='false',false)});
const sideSearch=actionButton('',()=>{listFilters.classList.toggle('filters-expanded');if(listFilters.classList.contains('filters-expanded'))sessionSearch.focus()},'side-search');sideSearch.title='搜索会话';sideSearch.setAttribute('aria-label','搜索会话');sideSearch.append(railIcon('search'));$('.brand').append(sideSearch);
const sideProjects=actionButton('',showProjectManager,'side-projects');sideProjects.append(railIcon('library'),elem('span','','项目'),railIcon('plus'));$('.tabs').before(sideProjects);
const paneBackdrop=elem('button','pane-backdrop');paneBackdrop.setAttribute('aria-label','收起会话栏');paneBackdrop.onclick=()=>setConversationPane(false);$('#app').append(paneBackdrop);
const previousNavigationSession=openSession;openSession=async function(s){await previousNavigationSession(s);selectRail('home');if(innerWidth<=760)setConversationPane(false,false)};
for(const dialog of [hubDialog,drawer]){if(dialog.tagName==='DIALOG')dialog.addEventListener('close',()=>selectRail('home'))}
selectRail('home');document.body.classList.add('has-navigation-rail');
const beforeNavigationSettingsClose=closeSettingsPage;closeSettingsPage=function(){const result=beforeNavigationSettingsClose();if($('#settings').hidden)selectRail('home');return result};

// Reuse authenticated session resources and the existing image tool conversation flow.
const railCollection=elem('dialog','rail-collection');const collectionHead=elem('header'),collectionTitle=elem('h2'),collectionBody=elem('div','collection-body');collectionHead.append(collectionTitle,actionButton('关闭',()=>railCollection.close(),'secondary'));railCollection.append(collectionHead,collectionBody);document.body.append(railCollection);railCollection.addEventListener('close',()=>selectRail('home'));
let collectionTicket=0;
async function openRailCollection(kind){const ticket=++collectionTicket;collectionTitle.textContent=kind==='images'?'生图':'资料库';collectionBody.replaceChildren(elem('p','hint','正在读取当前会话…'));if(!railCollection.open)railCollection.showModal();const sid=state.session?.id;
 try{const resources=sid?await api('/api/sessions/'+sid+'/resources'):{sources:[],outputs:[]};if(ticket!==collectionTicket||!railCollection.open)return;collectionBody.replaceChildren();
 const intro=elem('p','hint',kind==='images'?'当前会话的图片作品。可在对话中调用生图插件，结果自动保存在这里。':'当前会话的来源与输出。项目文件和长期笔记可从下方打开。');collectionBody.append(intro);
 const actions=elem('div','collection-actions');
 if(kind==='images'){actions.append(actionButton('开始创作',async()=>{railCollection.close();await railHome();$('#chat-input').value='请使用生图插件生成图片：';$('#chat-input').dispatchEvent(new Event('input',{bubbles:true}));$('#chat-input').focus()},'primary'),actionButton('配置生图服务商',()=>{railCollection.close();showSettings();selectSettingsTab('connection')},'secondary'))}
 else actions.append(actionButton('上传附件',()=>{railCollection.close();attachmentPicker.click()},'secondary'),actionButton('长期笔记',async()=>{railCollection.close();hubView='note';hubDialog.showModal();await refreshHub()},'secondary'),actionButton('项目文件',async()=>{railCollection.close();await railHome();openWorkbench('files')},'secondary'));
 collectionBody.append(actions);const rows=[...resources.outputs,...resources.sources].filter((item,index,all)=>all.findIndex(i=>i.id===item.id)===index).filter(item=>kind!=='images'||item.kind==='image');
 const grid=elem('div',kind==='images'?'collection-grid':'collection-files');for(const item of rows){if(kind==='images'){const card=actionButton('',()=>previewGeneratedImage(item),'collection-image');const image=elem('img');image.src='/api/attachments/'+item.id+'/content';image.alt=item.name;image.loading='lazy';card.append(image,elem('span','',item.name));grid.append(card)}else grid.append(resourceRow(item))}if(!rows.length)grid.append(elem('p','collection-empty',kind==='images'?'还没有图片，先从一个想法开始。':'当前会话暂无附件。'));collectionBody.append(grid);
 }catch(error){if(ticket===collectionTicket)collectionBody.replaceChildren(elem('p','hint',error.message),actionButton('重试',()=>openRailCollection(kind),'secondary'))}
}
