// Destinations own the main viewport. Chat DOM stays mounted to retain drafts and streams.
let appPage='home',pageTicket=0,libraryAssets=[],libraryFilter='all';
const destination=elem('section','destination-page');destination.hidden=true;destination.id='destination-page';destination.setAttribute('aria-label','工作空间页面');$('#app>main').append(destination);
const destinationHead=elem('header','destination-head'),destinationTitle=elem('h1'),destinationActions=elem('div','destination-actions');destinationHead.append(destinationTitle,destinationActions);
const destinationTabs=elem('nav','destination-tabs');destinationTabs.setAttribute('aria-label','资料类型');
const destinationBody=elem('div','destination-body');destination.append(destinationHead,destinationTabs,destinationBody);
const assetSearch=elem('input');assetSearch.type='search';assetSearch.placeholder='搜索资料库';assetSearch.setAttribute('aria-label','搜索资料库');assetSearch.oninput=renderAssetGrid;
const pageCounts=elem('span','page-counts');
function routeUrl(page){const url=new URL(location.href);if(page==='home')url.searchParams.delete('view');else url.searchParams.set('view',page);return url.pathname+url.search}
function rememberPage(page,replace=false){const method=replace?'replaceState':'pushState';if(location.pathname+location.search!==routeUrl(page)||!history.state?.astraPage)history[method]({astraPage:page},'',routeUrl(page));syncHistoryButtons()}
async function navigatePage(page,{historyMode='push'}={}){
 if(!['home','images','library','schedule'].includes(page))page='home';
 if(!$('#settings').hidden&&!closeSettingsPage())return false;
 if(state.mode==='canvas'&&!await flushBoard())return false;
 const ticket=++pageTicket;appPage=page;document.body.dataset.appPage=page;document.body.classList.toggle('in-destination',page!=='home');
 destination.hidden=page==='home';$('.studio-body').hidden=page!=='home';$('.topbar').hidden=page!=='home';
 if(hubBody.parentElement!==hubDialog)hubDialog.append(hubBody);
 if(historyMode!=='none')rememberPage(page,historyMode==='replace');selectRail(page==='home'?'home':page);
 if(page==='home'){scheduleConversationMap();return true}
 destinationTitle.textContent={images:'生图',library:'资料库',schedule:'定时任务'}[page];destinationActions.replaceChildren();destinationTabs.replaceChildren();destinationBody.replaceChildren();destination.scrollTop=0;
 if(page==='schedule'){
  destinationBody.append(elem('p','page-description','管理任务与执行进度。当前尚未接入定时触发，不会在后台自动执行。'));
  hubView='task';hubBody.replaceChildren(elem('p','hint','正在加载任务…'));destinationBody.append(hubBody);
  try{await refreshHub()}catch(error){if(ticket===pageTicket)hubBody.replaceChildren(elem('p','hint',error.message),actionButton('重试',()=>navigatePage('schedule',{historyMode:'none'}),'secondary'))}return true;
 }
 destinationActions.append(assetSearch,actionButton('刷新',()=>loadAssetPage(page,pageTicket),'secondary'));
 if(page==='library')destinationActions.append(actionButton('添加资料',()=>attachmentPicker.click(),'primary'));
 else destinationActions.append(actionButton('模型服务商',()=>{showSettings();selectSettingsTab('connection')},'secondary'));
 libraryFilter=page==='images'?'image':'all';assetSearch.value='';
 for(const [id,label] of (page==='images'?[['image','全部图片'],['outputs','生成作品']]:[['all','全部'],['image','图像'],['document','文档'],['outputs','输出']])){const button=actionButton(label,()=>{libraryFilter=id;for(const child of destinationTabs.children)child.classList.toggle('active',child===button);renderAssetGrid()},'');button.classList.toggle('active',id===libraryFilter);destinationTabs.append(button)}
 destinationTabs.append(pageCounts);
 if(page==='images'){
  const intro=elem('div','image-page-intro');intro.append(elem('h2','','让想法，有一个画面。'),elem('p','','通过对话调用生图插件，生成的作品会自动收录到资料库。'),actionButton('开始创作',async()=>{await railHome();$('#chat-input').value='请使用生图插件生成图片：';$('#chat-input').dispatchEvent(new Event('input',{bubbles:true}));$('#chat-input').focus()},'primary'));destinationBody.append(intro);
 }
 const grid=elem('div','asset-grid');grid.id='asset-grid';destinationBody.append(grid);await loadAssetPage(page,ticket);return true;
}
async function loadAssetPage(page,ticket){const grid=$('#asset-grid');if(!grid)return;grid.replaceChildren(elem('p','collection-empty','正在加载资料…'));
 try{const result=await api('/api/library');if(ticket!==pageTicket||appPage!==page)return;libraryAssets=result.items;renderAssetGrid()}
 catch(error){if(ticket===pageTicket)grid.replaceChildren(elem('p','collection-empty',error.message),actionButton('重试',()=>loadAssetPage(page,ticket),'secondary'))}
}
function renderAssetGrid(){const grid=$('#asset-grid');if(!grid)return;grid.replaceChildren();const query=assetSearch.value.trim().toLowerCase();
 const rows=libraryAssets.filter(item=>(appPage!=='images'||item.kind==='image')&&(!query||item.name.toLowerCase().includes(query))&&(libraryFilter==='all'||libraryFilter==='outputs'&&item.output||libraryFilter==='document'&&item.kind!=='image'||item.kind===libraryFilter));pageCounts.textContent=rows.length+' 项';
 for(const item of rows){const card=elem('article','asset-card');const preview=actionButton('',()=>item.kind==='image'?previewGeneratedImage(item):previewResource(item),'asset-preview');preview.setAttribute('aria-label','预览 '+item.name);
  if(item.kind==='image'){const image=elem('img');image.src='/api/attachments/'+item.id+'/content';image.alt=item.name;image.loading='lazy';preview.append(image)}else preview.append(railIcon('review'),elem('span','asset-filetype',item.name.split('.').pop().toUpperCase()));
  const footer=elem('div','asset-caption');footer.append(elem('strong','',item.name),elem('small','',(item.output?'输出作品 · ':'')+Math.max(1,Math.round(item.size/1024))+' KB'));
  const download=elem('a','asset-download','下载');download.href='/api/attachments/'+item.id+'/content';download.download=item.name;footer.append(download);card.append(preview,footer);grid.append(card);
 }
 if(!rows.length)grid.append(elem('div','page-empty',query?'没有匹配的资料。':'这里还没有内容。上传附件或生成作品后，会显示在这里。'));
}
function openRailCollection(page){return navigatePage(page)}
const originalRailHome=railHome;railHome=async function(){if(!await navigatePage('home'))return;await originalRailHome()};
const beforePageSession=openSession;openSession=async function(session){await beforePageSession(session);selectRail(appPage==='home'?'home':appPage)};
const beforePageNewSession=newSession;newSession=async function(...args){if(appPage!=='home')await navigatePage('home');return beforePageNewSession(...args)};
const beforePageSwitch=switchMode;switchMode=async function(mode){if(appPage!=='home'&&!await navigatePage('home'))return;return beforePageSwitch(mode)};
const beforePageShowSettings=showSettings;showSettings=function(){beforePageShowSettings();closeRailMenu()};
const beforePageCloseSettings=closeSettingsPage;closeSettingsPage=function(){const result=beforePageCloseSettings();if($('#settings').hidden){$('.studio-body').hidden=appPage!=='home';$('.topbar').hidden=appPage!=='home';destination.hidden=appPage==='home';selectRail(appPage==='home'?'home':appPage)}return result};
const beforePageHubOpen=hubOpen.onclick;hubOpen.onclick=function(...args){hubDialog.append(hubBody);return beforePageHubOpen.apply(this,args)};
attachmentPicker.addEventListener('change',()=>{if(appPage!=='library')return;let attempts=0;const refresh=()=>{if(appPage!=='library')return;if(uploadBusy&&attempts++<100){setTimeout(refresh,200);return}loadAssetPage(appPage,pageTicket)};setTimeout(refresh,200)});
const beforePageImageEvent=handleAgentEvent;handleAgentEvent=function(sid,event){beforePageImageEvent(sid,event);if(['images','library'].includes(appPage)&&event.type==='image_generated')loadAssetPage(appPage,pageTicket)};
window.addEventListener('popstate',()=>navigatePage(new URLSearchParams(location.search).get('view')||'home',{historyMode:'none'}));
const initialPage=new URLSearchParams(location.search).get('view')||'home';
Promise.resolve(studioReady).then(()=>navigatePage(initialPage,{historyMode:'replace'})).catch(error=>toast(error.message));
