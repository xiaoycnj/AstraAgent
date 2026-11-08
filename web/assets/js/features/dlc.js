// Optional packs share the official release source, but never close the main UI.
const dlcPanel=elem('section','settings-group dlc-panel');dlcPanel.id='dlc-manager';
dlcPanel.append(elem('h3','','可选 DLC'),elem('p','hint','选择官方发行版本中的 DLC，按需下载。下载不关闭主面板；安装期间请勿退出应用。'));
const dlcRelease=elem('input');dlcRelease.value='latest';dlcRelease.placeholder='latest / v3.4.1';dlcRelease.setAttribute('aria-label','DLC 发行版本');dlcRelease.maxLength=32;
const dlcLoad=actionButton('获取 DLC',loadDLC,'secondary');dlcLoad.id='dlc-refresh';
const dlcToolbar=elem('div','dlc-toolbar');dlcToolbar.append(dlcRelease,dlcLoad);dlcPanel.append(dlcToolbar);
const dlcInstalled=elem('div','dlc-installed'),dlcCards=elem('div','dlc-cards');
const dlcState=elem('div','dlc-state');dlcState.hidden=true;
const dlcMessage=elem('p','hint');dlcMessage.setAttribute('role','status');
const dlcProgress=elem('progress');dlcProgress.max=1;dlcProgress.setAttribute('aria-label','DLC 下载进度');
const dlcCancel=actionButton('取消下载',async()=>{await api('/api/dlc/cancel','POST',{});await refreshDLCStatus()},'secondary');
dlcState.append(dlcMessage,dlcProgress,dlcCancel);dlcPanel.append(dlcInstalled,dlcState,dlcCards);aboutPanel.append(dlcPanel);
let dlcPoll=null,dlcBusy=false,dlcCatalog=null,dlcNoticeJob=null;
const dlcActive=new Set(['resolving','downloading','verifying','installing']);
function dlcSize(n){return (Number(n)/1048576).toFixed(1)+' MB'}
function drawDLCInstalled(rows){dlcInstalled.replaceChildren();if(!rows?.length){dlcInstalled.append(elem('p','hint','尚未安装 DLC'));return}for(const row of rows){const line=elem('p','dlc-installed-row');line.append(svgIcon('folder'),elem('span','',row.id+' · '+row.version));dlcInstalled.append(line)}}
async function loadDLC(){
 dlcLoad.disabled=true;dlcCards.replaceChildren(elem('p','hint','正在读取官方 DLC 目录…'));
 try{dlcCatalog=await api('/api/dlc?release='+encodeURIComponent(dlcRelease.value.trim()||'latest'));dlcCards.replaceChildren();drawDLCInstalled(dlcCatalog.installed);
 if(!dlcCatalog.assets.length)dlcCards.append(elem('p','hint','此发行版本没有 DLC，请尝试其他版本。'));
 for(const asset of dlcCatalog.assets){
  const card=elem('article','dlc-card');const info=elem('div','dlc-card-info');
  info.append(elem('h4','',asset.name),elem('p','hint',dlcCatalog.release+' · '+dlcSize(asset.size)),elem('p','hint',asset.available?'安装前校验 SHA-256 · 独立安装':asset.reason));
  const installButton=actionButton('下载并安装',async()=>{
   const release=dlcCatalog.release;
   if(!await appConfirm(uiText('下载并安装所选 DLC？旧版本将保留备份，安装后不会自动运行。')+'\n'+asset.name+' · '+dlcSize(asset.size)))return;
   await api('/api/dlc/install','POST',{release,asset_id:asset.asset_id});await refreshDLCStatus();
  },'secondary');installButton.dataset.dlcInstall='';installButton.disabled=!asset.available||dlcBusy;installButton.dataset.available=String(asset.available);
  card.append(svgIcon('folder'),info,installButton);dlcCards.append(card);
 }
 }catch(error){dlcCards.replaceChildren(elem('p','error',error.message));}finally{dlcLoad.disabled=false}
}
async function refreshDLCStatus(){
 clearTimeout(dlcPoll);dlcPoll=null;
 try{
  const status=await api('/api/dlc/status');dlcBusy=dlcActive.has(status.phase);drawDLCInstalled(status.installed);
  dlcState.hidden=status.phase==='idle';dlcMessage.textContent=uiText(status.message||'');dlcState.dataset.phase=status.phase;
  dlcProgress.hidden=!dlcBusy;dlcCancel.hidden=!dlcBusy;dlcCancel.disabled=status.phase==='installing';
  if(status.phase==='downloading'&&status.total){dlcProgress.value=status.received/status.total;dlcMessage.textContent+=' · '+dlcSize(status.received)+' / '+dlcSize(status.total);}else dlcProgress.removeAttribute('value');
  for(const b of dlcCards.querySelectorAll('[data-dlc-install]'))b.disabled=dlcBusy||b.dataset.available!=='true';
  if(status.phase==='complete'&&dlcNoticeJob!==status.id){dlcNoticeJob=status.id;loadNotices().catch(()=>{});}
  if(status.phase==='complete'&&status.result?.backup)dlcMessage.textContent+=' · '+uiText('旧版备份：')+status.result.backup;
  if(status.phase==='complete'&&status.result?.id==='astra-local-stt-base')dlcMessage.textContent+=' · '+uiText('本地语音 DLC 已就绪。运行 CLI stt 启动服务，在语音设置中填入本地预设。');
 }catch(error){dlcMessage.textContent=error.message;dlcState.hidden=false;}
 if(dlcBusy||(!$('#settings').hidden&&!aboutPanel.hidden))dlcPoll=setTimeout(refreshDLCStatus,1500);
}
const beforeDLCSettings=selectSettingsTab;selectSettingsTab=function(name){const value=beforeDLCSettings(name);if(name==='about')refreshDLCStatus();return value};
const openDLC=actionButton('下载本地语音 DLC',()=>{selectSettingsTab('about');dlcPanel.scrollIntoView({block:'start',behavior:'smooth'});dlcRelease.focus()},'secondary');sttForm.append(openDLC);
