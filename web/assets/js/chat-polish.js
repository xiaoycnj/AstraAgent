// Original conversation treatment inspired by the supplied visual references.
const polishSend=$('#send');
function syncPolishSend(){const stopped=!conversationStop.hidden;polishSend.hidden=stopped;conversationStop.setAttribute('aria-label',conversationStopping.has(state.session?.id)?'正在停止…':'停止生成');conversationStop.title='停止生成';}
new MutationObserver(syncPolishSend).observe(conversationStop,{attributes:true,attributeFilter:['hidden','disabled']});syncPolishSend();
let thinkingFrame=0;
function scheduleThinking(){if(!thinkingFrame)thinkingFrame=requestAnimationFrame(drawThinking);}
function drawThinking(){
 thinkingFrame=0;const index=state.messages.findIndex(message=>message.streaming);const articles=conversationList.querySelectorAll(':scope>.message');
 if(index<0){conversationList.querySelectorAll('.thinking-process').forEach(node=>node.remove());return;}
 const article=articles[index];if(!article)return;
 let detail=article.querySelector('.thinking-process');
 if(!detail){detail=elem('details','thinking-process');const summary=elem('summary');const mark=elem('span','thinking-orbit');mark.setAttribute('aria-hidden','true');summary.append(mark,elem('span','thinking-label',''),svgIcon('chevron'));summary.querySelector('svg path').setAttribute('d','m6 9 6 6 6-6');detail.append(summary,elem('div','thinking-content'));article.insertBefore(detail,article.querySelector('.markdown'));}
 const events=activeRunSession===state.session?.id?currentTaskEvents:[];
 const latest=events.filter(event=>event.type!=='delta').at(-1);
 const label=latest?.type==='tool_start'?'正在使用工具':state.messages[index].content?'正在生成':'正在思考';
 const text=detail.querySelector('.thinking-label');if(text.dataset.source!==label){text.dataset.source=label;text.textContent=label;}
 const summaries=events.filter(event=>event.type==='reasoning_summary').map(event=>event.text||'').join('').slice(-12000);
 const content=detail.querySelector('.thinking-content');if(summaries)content.dataset.i18nIgnore='';else delete content.dataset.i18nIgnore;const value=summaries||uiText('等待模型提供可显示的思考摘要。');if(content.textContent!==value)content.textContent=value;
}
const previousThinkingEvent=handleAgentEvent;handleAgentEvent=function(sid,event){previousThinkingEvent(sid,event);if(sid===state.session?.id)scheduleThinking();};
new MutationObserver(scheduleThinking).observe(conversationList,{childList:true});

// Usage is collected only from reported API counts; missing counts stay explicit.
const usageSection=elem('section','token-activity settings-group');usageSection.id='token-activity';
const usageHead=elem('div','token-activity-head');usageHead.append(elem('h3','','Token 活动'));
const usageModes=elem('div','token-modes');usageModes.setAttribute('role','tablist');usageHead.append(usageModes);
const usageTotals=elem('div','token-totals');const usageScroll=elem('div','token-scroll');const usageGrid=elem('div','token-grid');usageGrid.setAttribute('aria-label','Token 活动热力图');usageGrid.setAttribute('role','group');
const usageMonths=elem('div','token-months');usageScroll.append(usageGrid,usageMonths);const usageHint=elem('p','hint');usageHint.setAttribute('role','status');
const usageTooltip=elem('div','token-tooltip');usageTooltip.hidden=true;usageTooltip.setAttribute('role','tooltip');usageTooltip.id='token-tooltip';usageSection.append(usageHead,usageTotals,usageScroll,usageHint,usageTooltip);$('[data-panel=profile]').append(usageSection);
let usageData=null,usageMode='daily',usageLoading=false;
for(const [id,label] of [['daily','每天'],['weekly','每周'],['cumulative','累计总量']]){const button=actionButton(label,()=>{usageMode=id;drawUsage();},'token-mode');button.dataset.mode=id;button.setAttribute('role','tab');usageModes.append(button);}
function localDateKey(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
async function loadUsage(){if(usageLoading)return;usageLoading=true;try{const now=new Date();usageData=await api('/api/usage?end='+localDateKey(now)+'&offset='+(-now.getTimezoneOffset()));drawUsage();}catch(error){usageHint.textContent=error.message;}finally{usageLoading=false;}}
function showUsageTooltip(event,label){usageTooltip.textContent=label;usageTooltip.hidden=false;const rect=event.currentTarget.getBoundingClientRect(),parent=usageSection.getBoundingClientRect();usageTooltip.style.left=Math.max(0,Math.min(parent.width-260,rect.left-parent.left-90))+'px';usageTooltip.style.top=(rect.top-parent.top-44)+'px';}
function drawUsage(){
 if(!usageData)return;usageGrid.replaceChildren();usageMonths.replaceChildren();usageTotals.replaceChildren();usageTooltip.hidden=true;
 for(const [label,key,reported] of [['累计 Token','total',usageData.totals.calls-usageData.totals.unreported],['输入','input',usageData.totals.input_reported],['输出','output',usageData.totals.output_reported],['缓存命中','cached',usageData.totals.cached_reported]]){const box=elem('div');const value=usageData.totals.calls&&!reported?'—':Number(usageData.totals[key]).toLocaleString();box.append(elem('strong','',value),elem('span','',label));usageTotals.append(box);}
 for(const button of usageModes.children){const active=button.dataset.mode===usageMode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));}
 const days=usageData.days;const leading=new Date(days[0].day+'T00:00:00Z').getUTCDay();let cells=[],running=usageData.before_total||0;
 if(usageMode==='weekly'){
  for(let index=0;index<days.length;index++){
   const week=Math.floor((index+leading)/7);if(!cells[week])cells[week]={day:days[index].day,end:days[index].day,total:0,calls:0,unreported:0};
   const item=cells[week];item.end=days[index].day;item.total+=days[index].total;item.calls+=days[index].calls;item.unreported+=days[index].unreported;
  }
 }else{
  cells=Array(leading).fill(null);for(const day of days){running+=day.total;cells.push({...day,total:usageMode==='cumulative'?running:day.total});}
 }
 usageGrid.classList.toggle('weekly',usageMode==='weekly');const maximum=Math.max(1,...cells.filter(Boolean).map(cell=>cell.total));let previousMonth='';
 cells.forEach((cell,index)=>{
  if(!cell){usageGrid.append(elem('span','token-cell empty'));return;}
  const level=cell.total===0?0:Math.max(1,Math.min(4,Math.ceil(Math.sqrt(cell.total/maximum)*4)));
  const button=elem('button','token-cell');button.type='button';button.dataset.level=level;button.dataset.tokens=cell.total;
  const label=cell.day+(cell.end?' – '+cell.end:'')+' · '+(cell.calls&&cell.unreported===cell.calls&&cell.total===0?'未上报':cell.total.toLocaleString()+' Token')+' · '+cell.calls+' 次调用'+(cell.unreported?' · '+cell.unreported+' 次未返回用量':'');
  button.setAttribute('aria-label',label);button.setAttribute('aria-describedby','token-tooltip');button.onmouseenter=event=>showUsageTooltip(event,label);button.onfocus=event=>showUsageTooltip(event,label);button.onmouseleave=()=>usageTooltip.hidden=true;button.onblur=()=>usageTooltip.hidden=true;button.onclick=()=>usageHint.textContent=label;usageGrid.append(button);
  const month=cell.day.slice(0,7);if(month!==previousMonth){previousMonth=month;const mark=elem('span','',Number(cell.day.slice(5,7))+uiText('月'));mark.style.gridColumn=String(usageMode==='weekly'?index+1:Math.floor(index/7)+1);usageMonths.append(mark);}
 });
 const since=new Date(usageData.since*1000).toLocaleDateString(document.documentElement.lang||undefined);usageHint.replaceChildren(elem('span','',uiText('仅统计服务商已上报用量。')),elem('span','',uiText('统计开始于')+' '+since+' · '),elem('span','',uiText('包含对话、工具循环、压缩和记忆的模型调用。')),elem('span','',usageData.totals.unreported?' '+uiText(usageData.totals.unreported+' 次调用未返回 Token 用量。'):''));
}
const previousUsageSettingsTab=selectSettingsTab;selectSettingsTab=function(name){previousUsageSettingsTab(name);if(name==='profile')loadUsage();};
setInterval(()=>{if(!$('#settings').hidden&&!$('[data-panel=profile]').hidden)loadUsage();},15000);
const usageRequestLabel=elem('label','switch-pill');const usageRequest=elem('input');usageRequest.type='checkbox';usageRequest.setAttribute('role','switch');usageRequest.id='request-stream-usage';usageRequestLabel.append(elem('span','','请求流式 Token 用量'),usageRequest);$('[data-panel=connection]').append(usageRequestLabel,elem('p','hint','接口支持 stream_options.include_usage 时可开启。不返回用量的调用会单独计数。'));
const previousUsageConfigForm=configForm;configForm=function(){return {...previousUsageConfigForm(),request_usage:usageRequest.checked};};
const previousUsageProviderEdit=$('#provider-edit').onchange;$('#provider-edit').onchange=function(...args){const value=previousUsageProviderEdit?.apply(this,args);usageRequest.checked=!!providerRows.find(row=>row.id===this.value)?.request_usage;return value;};
const previousUsageUpdateSettings=updateSettings;updateSettings=function(){previousUsageUpdateSettings();usageRequest.checked=!!state.settings.request_usage;};
