let providerRows=[];
function runtimeOptions(){return {provider:$('#provider-select').value,model:$('#runtime-model').value.trim(),reasoning:$('#reasoning-select').value,skill:$('#skill-select').value||'general',tools:$$('.tool-picks input:checked').map(x=>x.value)}}
async function loadProviders(){providerRows=await api('/api/providers');for(const id of ['provider-select','provider-edit']){const select=$('#'+id),value=select.value;select.replaceChildren(new Option(id==='provider-select'?'默认接口':'新建配置',''),...providerRows.filter(p=>id!=='provider-select'||(p.capabilities||({image_api:[],video_api:[],multimodal_api:['chat']}[p.type]||['chat'])).includes('chat')).map(p=>new Option(p.name,p.id)));if(providerRows.some(p=>p.id===value))select.value=value}}
function selectProvider(){const c=providerRows.find(x=>x.id===$('#provider-select').value)||state.settings;$('#runtime-model').value=c.model||'';saveRuntime()}
function saveRuntime(){try{localStorage.setItem('astra-runtime',JSON.stringify(runtimeOptions()))}catch(e){}}
$('#provider-select').onchange=selectProvider;$('#runtime-model').onchange=saveRuntime;$('#reasoning-select').onchange=saveRuntime;
$('#capability-open').onclick=()=>{$('#capability-panel').hidden=!$('#capability-panel').hidden};$('#capability-close').onclick=()=>$('#capability-panel').hidden=true;
$('#provider-edit').onchange=()=>{const c=providerRows.find(x=>x.id===$('#provider-edit').value)||{};$('#provider-name').value=c.name||'';$('#base-url').value=c.base_url||'';$('#model').value=c.model||'';$('#api-key').value='';$('#clear-key').checked=false;$('#timeout').value=c.timeout||90;$('#system-prompt').value=c.system_prompt||'';$('#key-status').textContent=c.has_key?'已保存，留空则保留':'可留空用于本地服务';settingsDirty=false};
$('#provider-save').onclick=safely(async()=>{const b=$('#provider-save');busyButton(b,true,'保存中…');try{const result=await api('/api/providers','POST',{...configForm(),id:$('#provider-edit').value,name:$('#provider-name').value});await loadProviders();$('#provider-edit').value=result.id;$('#provider-select').value=result.id;selectProvider();$('#api-key').value='';$('#clear-key').checked=false;settingsDirty=false;$('#settings-feedback').textContent='API 配置已保存并选用于下一条消息。';toast('API 配置已保存')}finally{busyButton(b,false)}});
$('#provider-delete').onclick=safely(async()=>{const id=$('#provider-edit').value;if(!id)return;if(!await appConfirm('删除此 API 配置？'))return;await api('/api/providers/'+id,'DELETE');await loadProviders();$('#provider-edit').onchange();selectProvider();toast('API 配置已删除')});
$('#settings-open').addEventListener('click',()=>{$('#provider-edit').value='';$('#provider-name').value=''});$('#model-pill').addEventListener('click',()=>{$('#provider-edit').value='';$('#provider-name').value=''});
const initialCapabilities=api('/api/capabilities');
async function initializeStudio(){try{const [,capabilities]=await Promise.all([loadProviders(),initialCapabilities]);$('#skill-select').replaceChildren(...Object.entries(capabilities.skills).map(([id,v])=>new Option(v.name,id)));if(capabilities.skills.general)$('#skill-select').value='general';const describe=()=>{$('#skill-description').textContent=capabilities.skills[$('#skill-select').value]?.prompt||'';saveRuntime()};$('#skill-select').onchange=describe;$$('.tool-picks input').forEach(x=>x.onchange=saveRuntime);try{const saved=JSON.parse(localStorage.getItem('astra-runtime')||'{}');if(providerRows.some(p=>p.id===saved.provider))$('#provider-select').value=saved.provider;$('#runtime-model').value=saved.model||'';$('#reasoning-select').value=['none','minimal','low','medium','high','xhigh','max'].includes(saved.reasoning)?saved.reasoning:'default';if(capabilities.skills[saved.skill])$('#skill-select').value=saved.skill;$$('.tool-picks input').forEach(x=>x.checked=(saved.tools||[]).includes(x.value))}catch(e){}describe()}catch(e){toast(e.message)}}
const studioReady=initializeStudio();
const sidebarIconPaths={chat:'M5 5h14v10H9l-4 4V5Z',canvas:'m12 3 9 9-9 9-9-9 9-9Z',settings:'M4 7h16M4 17h16M8 4v6m8 4v6',sun:'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',plus:'M12 5v14M5 12h14',send:'m5 12 7-7 7 7M12 5v15',review:'M9 4h6l1 3h4v13H4V7h4l1-3Zm-1 9 3 3 5-6',tools:'m14 5 5 5M4 20l8-8m-6 0L3 9l6-6 3 3m0 12 3 3 6-6-3-3',close:'m6 6 12 12M6 18 18 6',note:'M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4',link:'m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6'};
const iconPaths = {
  chat: 'M7 4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-6l-5 3v-3a4 4 0 0 1-3-4V8a4 4 0 0 1 4-4Z',
  canvas: 'M10.6 3.6a2 2 0 0 1 2.8 0l7 7a2 2 0 0 1 0 2.8l-7 7a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1 0-2.8Z',
  settings: 'M4 7h4m4 0h8M4 17h8m4 0h4M8 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm4 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
  sun: 'M12 2.8v2m0 14.4v2M2.8 12h2m14.4 0h2M5.5 5.5l1.4 1.4m10.2 10.2 1.4 1.4m-13 0 1.4-1.4M17.1 6.9l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  send: 'M12 20V4m-6 6 6-6 6 6',
  stop: 'M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z',
  review: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M10 3h4a1 1 0 0 1 1 1v2H9V4a1 1 0 0 1 1-1Zm-1 10 2 2 4-4',
  tools: 'm4 20 9-9m-3-3a5 5 0 0 1 6-6l-2 3 2 2 3-2a5 5 0 0 1-6 6m-8 3-2 2a2 2 0 0 0 3 3l2-2',
  close: 'm6.5 6.5 11 11m0-11-11 11',
  chevron: 'm7 10 5 5 5-5',
  note: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5M9 12h6m-6 4h6',
  link: 'm9 15 6-6m-7 4-2 2a3.5 3.5 0 0 0 5 5l3-3m-4-10 3-3a3.5 3.5 0 0 1 5 5l-2 2',
  clip: 'm8.5 13 6-6a2.5 2.5 0 0 1 3.5 3.5l-7.5 7.5a4 4 0 0 1-5.7-5.7l8.3-8.3',
  code: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  terminal: 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm1 5 3 3-3 3m6 0h4',
  copy: 'M10 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2ZM4 16V5a2 2 0 0 1 2-2h9',
  like: 'M7 10H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2Zm0 0 4-6a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2l-1 6a2 2 0 0 1-2 2H7',
  speaker: 'M4 9h4l5-4v14l-5-4H4Zm12.5-1a6 6 0 0 1 0 8m2.5-10a9 9 0 0 1 0 12',
  share: 'M12 15V3m-4 4 4-4 4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M20 12H4m6-6-6 6 6 6',
  forward: 'M4 12h16m-6-6 6 6-6 6',
  panel: 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm3 0v16',
  'panel-right': 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm9 0v16',
  maximize: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  window: 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm-3 5h18',
  download: 'M12 3v12m-4-4 4 4 4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2',
  archive: 'M5 4h14a2 2 0 0 1 2 2v2H3V6a2 2 0 0 1 2-2Zm0 4v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8m-9 4h4',
  pin: 'm14 3 7 7-4 1-4 4v3l-7-7h3l4-4Zm-4 11-5 5',
  search: 'M16.5 16.5 21 21m-2.5-10.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  history: 'M4 11a8 8 0 1 1 2 7m-2-7V5m0 6h6m2-3v4l3 2',
  refresh: 'M20 10a8 8 0 0 0-14-4l-2 2m0-5v5h5m-5 6a8 8 0 0 0 14 4l2-2m0 5v-5h-5',
  image: 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm-3 12 5-5 4 4 3-3 6 6m-5-9h.01',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  mic: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0Zm-3 6a6 6 0 0 0 12 0m-6 6v3m-3 0h6',
  trash: 'M4 6h16m-13 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1m-5 4v6m4-6v6',
  plugin: 'M4 7a2 2 0 0 1 2-2h3a3 3 0 0 1 6 0h3a2 2 0 0 1 2 2v3a3 3 0 0 0 0 6v3a2 2 0 0 1-2 2h-3a3 3 0 0 0-6 0H6a2 2 0 0 1-2-2v-3a3 3 0 0 0 0-6Z',
  palette: 'M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 1-2.6 1.4 1.4 0 0 1 1-2.4H18a3 3 0 0 0 3-3 9 9 0 0 0-9-10ZM7.5 12H7.51M9 7.5h.01m5-.4h.01m3 3h.01',
  cube: 'm12 3 8 4.5v9L12 21l-8-4.5v-9Zm-8 4.5 8 4.5 8-4.5M12 12v9',
  edit: 'm5 16-1 4 4-1 11-11a2 2 0 0 0-3-3Zm9-9 3 3',
  home: 'm3 11 7.6-6.8a2 2 0 0 1 2.8 0L21 11m-16-1.5V18a2 2 0 0 0 2 2h3v-5h4v5h3a2 2 0 0 0 2-2V9.5',
  library: 'M6 5h2v14H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm5 0v14m3-14 3-.6 3 14-3 .6Z',
  profile: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 20a8 6 0 0 1 16 0',
  schedule: 'M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm-3 5h18M8 3v4m8-4v4m-7 9 2 2 4-4',
  target: 'M20 12a8 8 0 1 1-8-8m4 8a4 4 0 1 1-4-4m0 4 7-7m-1-2 1 2 2 1',
};
Object.assign(iconPaths, {
  document: iconPaths.note, images: iconPaths.image, theme: iconPaths.sun, plugins: iconPaths.plugin,
});
function makeGlyph(pathData, strokeWidth) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [attribute, value] of Object.entries({
    viewBox: '0 0 24 24', class: 'ui-icon', fill: 'none', stroke: 'currentColor',
    'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  })) svg.setAttribute(attribute, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}
function svgIcon(name) {
  return makeGlyph(Object.hasOwn(iconPaths, name) ? iconPaths[name] : iconPaths.note, name === 'more' ? '2.8' : '1.85');
}
function sidebarIcon(name) {
  return makeGlyph(sidebarIconPaths[name] || sidebarIconPaths.note, '1.6');
}
for(const [id,name] of Object.entries({'chat-tab':'chat','canvas-tab':'canvas','settings-open':'settings','theme-toggle':'sun','new-item':'plus','send':'send','review-toggle':'review','capability-open':'tools','connect':'link','close-side':'close','capability-close':'close'})){const b=$('#'+id);if(!b)continue;for(const n of [...b.childNodes])if(n.nodeType===3)n.textContent=n.textContent.replace(/[◷◇⚙◐＋↑✳⌁×]/g,'');b.prepend(b.closest('.sidebar') ? sidebarIcon(name) : svgIcon(name))}
$$('[data-add]').forEach(b=>{b.textContent=b.textContent.replace(/[＋✦]/g,'');b.prepend(svgIcon(b.dataset.add==='agent'?'review':'note'))});

$$('[data-settings-tab]').forEach(b=>{for(const n of [...b.childNodes])if(n.nodeType===3)n.textContent=n.textContent.replace(/[◈◐✦]/g,'');b.prepend(sidebarIcon(b.dataset.settingsTab==='appearance'?'sun':b.dataset.settingsTab==='about'?'review':'settings'))});
// Composer model menu and reasoning control.
const picker=elem('section','model-picker floating-control');picker.id='model-picker';picker.hidden=true;picker.setAttribute('aria-label','选择模型');
const pickerTitle=elem('div','picker-caption','选择模型');const providerLabel=elem('label','picker-provider','API 接入');providerLabel.append($('#provider-select'));picker.append(pickerTitle,providerLabel);
const search=elem('input','model-search');search.placeholder='搜索或输入模型 ID';search.setAttribute('aria-label','搜索或输入模型 ID');search.maxLength=200;picker.append(search);
const modelList=elem('div','picker-models');modelList.setAttribute('role','listbox');modelList.setAttribute('aria-label','模型');picker.append(modelList);
const modelFooter=elem('div','picker-footer');const fetchModels=elem('button','','刷新模型列表');fetchModels.type='button';const modelSettings=elem('button','','接口设置');modelSettings.type='button';modelFooter.append(fetchModels,modelSettings);picker.append(modelFooter);const modelStatus=elem('p','picker-status');modelStatus.setAttribute('role','status');picker.append(modelStatus);document.body.append(picker);
const reasoningButton=elem('button','reasoning-pill','默认');reasoningButton.type='button';reasoningButton.id='reasoning-pill';reasoningButton.setAttribute('aria-expanded','false');reasoningButton.setAttribute('aria-controls','reasoning-popover');$('#model-pill').after(reasoningButton);
const reasoningPopover=elem('section','reasoning-popover floating-control');reasoningPopover.id='reasoning-popover';reasoningPopover.hidden=true;reasoningPopover.setAttribute('aria-label','思考强度');
const reasoningTop=elem('div','reasoning-top');reasoningTop.append(svgIcon('tools'));const strengthLabel=elem('strong','','默认');const resetReasoning=elem('button','','↺');resetReasoning.type='button';resetReasoning.setAttribute('aria-label','重置思考强度');reasoningTop.append(strengthLabel,resetReasoning);
const reasoningModel=elem('button','reasoning-model');reasoningModel.type='button';const rail=elem('div','reasoning-rail');const fill=elem('div','reasoning-fill');const ticks=elem('div','reasoning-ticks');for(let i=0;i<8;i++)ticks.append(elem('i'));
const slider=elem('input','reasoning-slider');slider.type='range';slider.min='0';slider.max='7';slider.step='1';slider.setAttribute('aria-label','思考强度');rail.append(fill,ticks,slider);const labels=elem('div','reasoning-labels');labels.append(elem('span','','默认'),elem('span','','最高'));reasoningPopover.append(reasoningTop,reasoningModel,rail,labels);document.body.append(reasoningPopover);
const strengths=['default','none','minimal','low','medium','high','xhigh','max'],strengthNames=['默认','关闭','极低','低','中','高','超高','最高'];let availableModels=[],modelFetch=0;
function chosenModel(){return $('#runtime-model').value.trim()||(providerRows.find(p=>p.id===$('#provider-select').value)||state.settings).model||''}
function syncComposerControls(){const model=chosenModel();$('#model-pill').textContent=(model||'选择模型')+' ⌄';$('#model-pill').title=model||'选择模型';reasoningModel.textContent=(model||'尚未选择模型')+' ›';const index=Math.max(0,strengths.indexOf($('#reasoning-select').value));slider.value=index;slider.setAttribute('aria-valuetext',strengthNames[index]);strengthLabel.textContent=strengthNames[index];reasoningButton.textContent='思考 · '+strengthNames[index]+' ⌄';rail.style.setProperty('--progress',(index/7*100)+'%');rail.classList.toggle('maxed',index===7);reasoningPopover.classList.toggle('maxed',index===7);reasoningButton.classList.toggle('maxed',index===7)}
function placeControl(panel,anchor){
 const r=anchor.getBoundingClientRect();
 const dialog=panel.parentElement.matches('dialog[open]')?panel.parentElement:null;
 const bounds=dialog?.getBoundingClientRect();
 const left=bounds?bounds.left+dialog.clientLeft:0,top=bounds?bounds.top+dialog.clientTop:0;
 const width=dialog?.clientWidth??innerWidth,height=dialog?.clientHeight??innerHeight;
 panel.style.width=Math.min(panel===picker?310:294,width-24)+'px';
 panel.style.maxHeight=(dialog?Math.max(0,Math.min(420,r.top-top-22)):Math.max(180,Math.min(420,height-24)))+'px';
 panel.style.left=Math.max(12,Math.min(r.right-left-panel.offsetWidth,width-panel.offsetWidth-12))+'px';
 panel.style.top=Math.max(12,r.top-top-panel.offsetHeight-10)+'px';
}
let reasoningTrigger=null;
function closeComposerControls(focus=false){
 const trigger=reasoningTrigger||$('#model-pill');
 picker.hidden=true;
 reasoningPopover.hidden=true;
 reasoningTrigger?.setAttribute('aria-expanded','false');
 reasoningTrigger=null;
 if(reasoningPopover.parentElement!==document.body)document.body.append(reasoningPopover);
 $('#model-pill').setAttribute('aria-expanded','false');
 $('#model-pill').setAttribute('aria-controls',reasoningButton.hidden?'reasoning-popover':'model-picker');
 if(focus)trigger.focus({preventScroll:true});
}
function toggleReasoningControl(trigger){
 const wasOpen=reasoningTrigger===trigger&&!reasoningPopover.hidden;
 closeComposerControls();
 if(wasOpen)return;
 syncComposerControls();
 const host=trigger.closest('dialog[open]')||document.body;
 if(reasoningPopover.parentElement!==host)host.append(reasoningPopover);
 reasoningTrigger=trigger;
 trigger.setAttribute('aria-controls','reasoning-popover');
 trigger.setAttribute('aria-expanded','true');
 reasoningPopover.hidden=false;
 placeControl(reasoningPopover,trigger);
 (slider.disabled?resetReasoning:slider).focus({preventScroll:true});
}
function openModelPicker(){const wasOpen=!picker.hidden;closeComposerControls();if(wasOpen)return;picker.hidden=false;$('#model-pill').setAttribute('aria-controls','model-picker');$('#model-pill').setAttribute('aria-expanded','true');search.value='';renderModelChoices();placeControl(picker,$('#model-pill'));search.focus({preventScroll:true})}
function useModel(model){$('#runtime-model').value=model;saveRuntime();syncComposerControls();closeComposerControls();$('#model-pill').focus()}
function renderModelChoices(){modelList.replaceChildren();const current=chosenModel();const configured=(providerRows.find(p=>p.id===$('#provider-select').value)||state.settings).model;const models=[...new Set([configured,current,...availableModels,...$$('#models option').map(o=>o.value)].filter(Boolean))];const query=search.value.trim();const defaults=elem('button','model-choice');defaults.type='button';defaults.setAttribute('role','option');defaults.setAttribute('aria-selected',String(!$('#runtime-model').value));const d=elem('span','','默认');d.append(elem('small','',configured||'使用接口中配置的模型'));defaults.append(d,elem('span','checkmark',!$('#runtime-model').value?'✓':''));defaults.onclick=()=>useModel('');modelList.append(defaults);for(const model of models.filter(m=>m.toLowerCase().includes(query.toLowerCase()))){const b=elem('button','model-choice');b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(current===model));b.append(elem('span','',model),elem('span','checkmark',current===model?'✓':''));b.onclick=()=>useModel(model);modelList.append(b)}if(query&&!models.includes(query)){const custom=elem('button','model-choice custom-model','使用模型：'+query);custom.type='button';custom.onclick=()=>useModel(query);modelList.append(custom)}if(!models.length&&!query)modelList.append(elem('p','picker-status','先配置接口，或输入服务商提供的模型 ID。'))}
search.oninput=()=>{renderModelChoices();placeControl(picker,$('#model-pill'))};search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(search.value.trim())useModel(search.value.trim())}};
$('#model-pill').onclick=openModelPicker;$('#model-pill').setAttribute('aria-controls','model-picker');$('#model-pill').setAttribute('aria-expanded','false');
reasoningButton.onclick=()=>toggleReasoningControl(reasoningButton);
slider.oninput=()=>{$('#reasoning-select').value=strengths[Number(slider.value)];saveRuntime();syncComposerControls()};resetReasoning.onclick=()=>{$('#reasoning-select').value='default';saveRuntime();syncComposerControls()};reasoningModel.onclick=openModelPicker;
modelSettings.onclick=()=>{closeComposerControls();showSettings()};
fetchModels.onclick=safely(async()=>{const generation=++modelFetch,pid=$('#provider-select').value;busyButton(fetchModels,true,'读取中…');modelStatus.textContent='';try{const result=await api('/api/settings/models','POST',{provider:pid});if(generation!==modelFetch||pid!==$('#provider-select').value)return;availableModels=result.models;renderModelChoices();modelStatus.textContent='已读取 '+result.models.length+' 个模型';placeControl(picker,$('#model-pill'))}catch(e){modelStatus.textContent=e.message}finally{busyButton(fetchModels,false)}});
$('#provider-select').addEventListener('change',()=>{availableModels=[];search.value='';modelStatus.textContent='';renderModelChoices();syncComposerControls();placeControl(picker,$('#model-pill'))});
$('#runtime-model').addEventListener('change',syncComposerControls);$('#reasoning-select').addEventListener('change',syncComposerControls);
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.floating-control,#model-pill,#reasoning-pill,[data-reasoning-trigger]'))closeComposerControls()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(!picker.hidden||!reasoningPopover.hidden)){e.preventDefault();e.stopImmediatePropagation();closeComposerControls(true)}},true);window.addEventListener('resize',()=>closeComposerControls());document.addEventListener('scroll',e=>{if(!e.target.closest?.('.floating-control'))closeComposerControls()},true);
const composerObserver=new MutationObserver(()=>syncComposerControls());composerObserver.observe($('#models'),{childList:true});
// Existing settings/provider handlers keep their source values; update the compact label after changes.
const previousSaveRuntime=saveRuntime;saveRuntime=function(){previousSaveRuntime();syncComposerControls()};
const previousUpdateSettings=updateSettings;updateSettings=function(){previousUpdateSettings();syncComposerControls()};
syncComposerControls();
