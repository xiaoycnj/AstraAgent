'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = {token:'', settings:{}, onboarding:{}, mode:'chat', sessions:[], canvases:[], session:null, messages:[], pending:new Set(), reviewMode:false, board:null, selected:null, dirty:0, saved:0, savePromise:null, history:[], redo:[], scale:1, x:0, y:0, connecting:false, source:null, running:new Set()};
let listRequest=0, messageRequest=0, saveTimer, toastTimer, drag=null, submitting=false;
const clone = o => structuredClone(o);
const uid = () => crypto.randomUUID();
const types={note:'便签',document:'文档',agent:'智能体'};
const symbols={note:'▧',document:'▤',agent:'✦'};

function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3400)}
async function api(path,method='GET',data){
  let response;
  try{response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-App-Token':state.token},body:data===undefined?undefined:JSON.stringify(data)});}catch(e){throw new Error('无法连接本地服务，请确认启动窗口仍在运行。')}
  let result;try{result=await response.json()}catch(e){throw new Error('服务响应无效，请重启应用。')}
  if(!response.ok){const error=new Error(result.error||`请求失败 ${response.status}`);error.status=response.status;throw error}return result;
}
function safely(fn){return async e=>{try{await fn(e)}catch(error){toast(error.message)}}}
function download(name,text,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function elem(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;if(typeof enhanceUiElement==='function')enhanceUiElement(el);return el}
function busyButton(button,busy,label){if(busy){button.dataset.label=button.textContent;button.textContent=label||'处理中…'}else button.textContent=button.dataset.label;button.disabled=busy}
function updateSettings(){const c=state.settings;$('#config-dot').textContent=c.base_url&&c.model?'●':'○';$('#model-pill').textContent=c.model?`✦ ${c.model}`:'○ 配置你的模型'}
function showSettings(){if(!$('#settings').hidden)return;const c=state.settings;$('#base-url').value=c.base_url||'';$('#model').value=c.model||'';$('#api-key').value='';$('#clear-key').checked=false;$('#system-prompt').value=c.system_prompt||'';$('#timeout').value=c.timeout||90;$('#key-status').textContent=c.has_key?'已保存，留空则保留':'可留空用于本地服务';$('#api-key').placeholder=c.has_key?'已保存 · 输入新密钥可替换':'输入你的密钥';$('#settings-feedback').textContent='';openSettingsPage()}
function configForm(){return {provider:$('#provider-edit')?.value||'',base_url:$('#base-url').value.trim(),model:$('#model').value.trim(),api_key:$('#api-key').value,clear_key:$('#clear-key').checked,system_prompt:$('#system-prompt').value,timeout:Number($('#timeout').value)}}
async function configAction(kind,button){busyButton(button,true);$('#settings-feedback').classList.remove('error');$('#settings-feedback').textContent='正在连接…';try{const data=configForm();if(kind==='save'){state.settings=await api('/api/settings','PUT',data);updateSettings();$('#api-key').value='';$('#clear-key').checked=false;$('#key-status').textContent=state.settings.has_key?'已保存，留空则保留':'未保存密钥';settingsDirty=false;$('#settings-feedback').textContent='设置已保存，新的对话请求将使用此配置。';toast('接口设置已保存在本机')}else if(kind==='models'){const r=await api('/api/settings/models','POST',data);$('#models').replaceChildren(...r.models.map(m=>{const o=document.createElement('option');o.value=m;return o}));$('#settings-feedback').textContent=`已读取 ${r.models.length} 个模型，可在模型输入框选择。`;if(!$('#model').value&&r.models[0])$('#model').value=r.models[0]}else{const r=await api('/api/settings/test','POST',data);$('#settings-feedback').textContent=`连接成功 · 模型回复正常 · ${r.latency_ms} ms。记得保存设置。`}}catch(e){$('#settings-feedback').classList.add('error');$('#settings-feedback').textContent=e.message}finally{busyButton(button,false)}}
let firstRunStep=1,firstRunActive=false,firstRunPreview=false;
let firstRunPreviewSnapshot=null,firstRunBackground=null,firstRunRenderedStep=0,firstRunSaving=false;
const firstRunAnimations=new Set();
const firstRunMotionQuery=matchMedia('(prefers-reduced-motion: reduce)');
const firstRunPreviewExit=elem('button','secondary','退出预览');firstRunPreviewExit.type='button';firstRunPreviewExit.hidden=true;firstRunPreviewExit.id='first-run-preview-exit';$('#first-run .first-run-brand').append(firstRunPreviewExit);
const firstRunScenes=[
  ['A SPACE FOR YOUR IDEAS','灵感，从这里展开。','属于你的空间。由你定义的可能。','隐私说明'],
  ['CONFIDENCE BY DESIGN','每一个选择，都由你。','了解边界，安心探索。','使用条款'],
  ['MAKE IT YOURS','为独一无二的你。','从你的名字，到你的下一次创造。','个人资料'],
  ['CONNECT YOUR POSSIBILITIES','让想法，连接可能。','选择你的模型，开启新的旅程。','连接模型'],
  ['YOUR NEXT CHAPTER','现在，轮到你的灵感。','从这里出发，创造下一种可能。','设置完成']
];
function firstRunReduced(){return firstRunMotionQuery.matches||document.documentElement.dataset.motion==='reduced'||$('#first-run').dataset.reducedMotion==='true'}
function cancelFirstRunAnimations(){for(const a of firstRunAnimations)a.cancel();firstRunAnimations.clear()}
function animateFirstRun(node,frames,options){if(firstRunReduced())return;const a=node.animate(frames,options);firstRunAnimations.add(a);const clean=()=>firstRunAnimations.delete(a);a.onfinish=clean;a.oncancel=clean;}
function updateFirstRunMotion(){const reduced=firstRunReduced();$('#first-run-motion').setAttribute('aria-pressed',String(reduced));$('#first-run-motion').textContent=reduced?'动态效果已减少':'减少动态效果';if(reduced)cancelFirstRunAnimations()}
$('#first-run-motion').onclick=()=>{$('#first-run').dataset.reducedMotion=String($('#first-run').dataset.reducedMotion!=='true');updateFirstRunMotion()};
firstRunMotionQuery.addEventListener('change',updateFirstRunMotion);
new MutationObserver(updateFirstRunMotion).observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
function isolateFirstRun(){if(firstRunBackground)return;firstRunBackground=[...document.body.children].filter(n=>n.id!=='workspace-loading'&&!n.contains($('#first-run'))).map(node=>({node,inert:node.inert}));for(const {node} of firstRunBackground)node.inert=true;}
function releaseFirstRun(){if(!firstRunBackground)return;for(const {node,inert} of firstRunBackground)node.inert=inert;firstRunBackground=null;}
function previewFirstRun(returnFocus=document.activeElement){
  if(firstRunActive)return;
  firstRunPreviewSnapshot={focus:returnFocus,step:firstRunStep,finish:$('#first-run-finish').textContent,fields:[...$('#first-run-form').elements].filter(x=>x.matches('input,textarea,select')).map(x=>({node:x,value:x.value,checked:x.checked}))};
  $('#first-run-form').reset();firstRunPreview=true;firstRunActive=true;firstRunStep=1;firstRunRenderedStep=0;$('#first-run-error').hidden=true;$('#first-provider-key').value='';$('#first-run-finish').textContent='预览完成体验';firstRunPreviewExit.hidden=false;$('#first-run-preview-label').hidden=false;renderFirstRunStep();
  for(const dialog of document.querySelectorAll('.command-palette:not([open])'))for(const animation of dialog.getAnimations({subtree:true}))animation.cancel();
}
function closeFirstRunPreview(){
  if(!firstRunPreview)return;
  const snapshot=firstRunPreviewSnapshot;firstRunPreview=false;firstRunActive=false;firstRunStep=snapshot.step;$('#first-run-finish').textContent=snapshot.finish;
  for(const field of snapshot.fields){field.node.value=field.value;field.node.checked=field.checked;}
  $('#first-provider-key').value='';firstRunPreviewExit.hidden=true;$('#first-run-preview-label').hidden=true;firstRunPreviewSnapshot=null;renderFirstRunStep();
  (snapshot.focus?.isConnected&&!snapshot.focus.closest('dialog:not([open])')?snapshot.focus:$('#chat-input'))?.focus({preventScroll:true});
}
firstRunPreviewExit.onclick=closeFirstRunPreview;
window.addEventListener('keydown',event=>{if(firstRunActive&&(event.ctrlKey||event.metaKey)&&['s','k','p',','].includes(event.key.toLowerCase())){event.preventDefault();event.stopImmediatePropagation();}},true);
$('#first-run').addEventListener('keydown',event=>{
  if(!firstRunActive)return;
  if(event.key==='Escape'&&firstRunPreview){event.preventDefault();event.stopPropagation();closeFirstRunPreview();return;}
  if(event.key==='Tab'){
    const controls=[...$('#first-run').querySelectorAll('input,button,select,textarea,a[href],[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
function renderFirstRunStep(){
  cancelFirstRunAnimations();const host=$('#first-run'),previous=firstRunRenderedStep;
  host.hidden=!firstRunActive;document.body.classList.toggle('first-run-open',firstRunActive);
  if(!firstRunActive){releaseFirstRun();firstRunRenderedStep=0;return}
  isolateFirstRun();updateFirstRunMotion();host.dataset.step=String(firstRunStep);
  $$('[data-first-step]').forEach(x=>x.hidden=Number(x.dataset.firstStep)!==firstRunStep);
  $$('[data-step-dot]').forEach(x=>{const step=Number(x.dataset.stepDot);x.classList.toggle('active',step===firstRunStep);x.classList.toggle('complete',step<firstRunStep);if(step===firstRunStep)x.setAttribute('aria-current','step');else x.removeAttribute('aria-current');x.setAttribute('aria-label',step+' · '+firstRunScenes[step-1][3]);});
  const [kicker,title,detail,label]=firstRunScenes[firstRunStep-1];$('#oobe-art-kicker').textContent=kicker;$('#oobe-art-title').textContent=title;$('#oobe-art-detail').textContent=detail;$('#oobe-art-number').textContent=String(Math.min(firstRunStep,4)).padStart(2,'0');$('#first-run-step-count').textContent=firstRunStep===5?'准备就绪':String(firstRunStep).padStart(2,'0')+' / 04';
  $('#first-run-announcement').textContent=firstRunStep===5?'设置完成':`第 ${firstRunStep} 步，共 4 步：${label}`;
  const section=host.querySelector(`[data-first-step="${firstRunStep}"]`),heading=section.querySelector('h1');heading.tabIndex=-1;heading.focus({preventScroll:true});
  if(previous!==firstRunStep){const direction=previous>firstRunStep?-1:1;host.scrollTo({top:0,behavior:'instant'});const ease='cubic-bezier(.16,1,.3,1)';animateFirstRun(section,[{opacity:0,transform:`translateX(${direction*36}px) translateY(10px)`},{opacity:1,transform:'none'}],{duration:620,easing:ease});[...section.children].filter(n=>!n.hidden).forEach((n,i)=>animateFirstRun(n,[{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'none'}],{duration:520,delay:Math.min(i*45,225),easing:ease,fill:'backwards'}));animateFirstRun($('.oobe-art-caption'),[{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'none'}],{duration:700,easing:ease});if(!previous)animateFirstRun($('.oobe-sculpture'),[{opacity:0,scale:'.7',rotate:'-18deg'},{opacity:1,scale:'1',rotate:'0deg'}],{duration:1200,easing:ease});}
  if(previous && previous!==firstRunStep && !firstRunReduced()){
    const from=host.querySelector(`[data-step-dot="${previous}"]`),to=host.querySelector(`[data-step-dot="${firstRunStep}"]`);
    if(from && to){
      const dx=from.getBoundingClientRect().left-to.getBoundingClientRect().left;
      animateFirstRun(to,[
        {transform:`translateX(${dx}px) scale(.94,1.04)`},
        {offset:.37,transform:`translateX(${dx*.32}px) scale(1.32,.84)`},
        {offset:.68,transform:`translateX(${-dx*.05}px) scale(.93,1.08)`},
        {transform:'none'}
      ],{duration:470,easing:'cubic-bezier(.25,.72,.32,1)'});
    }
  }
  firstRunRenderedStep=firstRunStep;
}
function firstRunMove(delta){if(firstRunSaving)return;const required=firstRunStep===1?$('#first-run-privacy'):firstRunStep===2?$('#first-run-terms'):null;if(delta>0&&required&&!required.checked){const section=$('[data-first-step="'+firstRunStep+'"]');let message=section.querySelector('.first-run-validation');if(!message){message=elem('p','inline-error first-run-validation');message.setAttribute('role','alert');message.id='first-run-validation-'+firstRunStep;section.append(message);required.setAttribute('aria-describedby',message.id)}message.textContent=firstRunStep===1?'请先阅读并确认隐私说明。':'请先阅读并接受使用条款。';required.focus();return}firstRunStep=Math.max(1,Math.min(4,firstRunStep+delta));renderFirstRunStep();}
$('#first-run-privacy').addEventListener('change',()=>{const message=$('[data-first-step="1"] .first-run-validation');if(message)message.remove();$('#first-run-privacy').removeAttribute('aria-describedby')});$('#first-run-terms').addEventListener('change',()=>{const message=$('[data-first-step="2"] .first-run-validation');if(message)message.remove();$('#first-run-terms').removeAttribute('aria-describedby')});$$('[data-first-next]').forEach(b=>b.onclick=()=>firstRunMove(1));$$('[data-first-back]').forEach(b=>b.onclick=()=>firstRunMove(-1));
function showFirstRunComplete(){firstRunStep=5;$('#first-provider-key').value='';$('#first-run-complete-copy').textContent=firstRunPreview?'预览中的资料和连接信息不会保存。':hasModelConnection()?'可以开始对话，或在画布中把策划、执行和审核串起来。':'可以先在画布整理想法，等需要运行智能体时再连接模型。';$('#first-run-enter').textContent=firstRunPreview?'结束预览 →':'进入工作空间 →';$('#first-run-canvas').hidden=firstRunPreview;renderFirstRunStep();}
function leaveFirstRun(){firstRunActive=false;renderFirstRunStep();}
$('#first-run-enter').onclick=()=>{if(firstRunPreview){closeFirstRunPreview();return}leaveFirstRun();$('#chat-input')?.focus();};
$('#first-run-canvas').onclick=safely(async()=>{leaveFirstRun();await switchMode('canvas');$('#viewport').focus({preventScroll:true});});
async function finishFirstRun(event, skipProvider=false){
  event?.preventDefault();if(firstRunStep!==4||firstRunSaving)return;
  const error=$('#first-run-error'),button=$('#first-run-finish');error.hidden=true;
  if(!$('#first-run-privacy').checked||!$('#first-run-terms').checked){firstRunStep=!$('#first-run-privacy').checked?1:2;renderFirstRunStep();return}
  if(firstRunPreview){showFirstRunComplete();return}
  const name=$('#first-profile-name').value.trim(),role=$('#first-profile-role').value.trim(),url=$('#first-provider-url').value.trim(),model=$('#first-provider-model').value.trim(),key=$('#first-provider-key').value;
  if(!skipProvider&&(!url||!model)){error.textContent='请填写接口地址和模型 ID，或选择稍后连接。';error.hidden=false;error.setAttribute('role','alert');$(url?'#first-provider-model':'#first-provider-url').focus();return}
  firstRunSaving=true;busyButton(button,true,'正在准备你的空间…');$$('#first-run [data-first-back],#first-run-skip').forEach(b=>b.disabled=true);
  try{
    if(!skipProvider){state.settings=await api('/api/settings','PUT',{base_url:url,model,api_key:key,timeout:90});updateSettings();}
    await api('/api/profile','PUT',{...(name||role?{display_name:name||'本地用户',role}:{}),inject_profile:$('#first-profile-inject').checked,use_memory:$('#first-profile-memory').checked});
    const acceptance=await api('/api/onboarding/accept','POST',{accepted:true,version:1,auto_review_delivered:$('#first-run-review').checked});
    state.onboarding=acceptance.onboarding;
    showFirstRunComplete();
  }catch(e){error.textContent=e.message;error.hidden=false;error.setAttribute('role','alert');error.scrollIntoView({block:'nearest'});}
  finally{firstRunSaving=false;busyButton(button,false);$$('#first-run [data-first-back],#first-run-skip').forEach(b=>b.disabled=false);}
}
$('#first-run-form').addEventListener('submit',finishFirstRun);$('#first-run-skip').onclick=()=>finishFirstRun(null,true);


async function refreshList(){const request=++listRequest,mode=state.mode;const rows=await api(mode==='chat'?'/api/sessions':'/api/canvases');if(request!==listRequest||mode!==state.mode)return;state[mode==='chat'?'sessions':'canvases']=rows;renderList()}
function renderList(){const rows=state.mode==='chat'?state.sessions:state.canvases;$('#item-count').textContent=rows.length;$('#item-list').replaceChildren();for(const item of rows){const selected=state.mode==='chat'?state.session?.id===item.id:state.board?.id===item.id;const b=elem('button','list-item'+(selected?' active':''));b.append(elem('i','',state.mode==='chat'?'◷':'◇'),elem('span','',item.title));if(state.mode==='chat')b.append(elem('small','',String(item.message_count||0)));b.onclick=safely(()=>state.mode==='chat'?openSession(item):openBoard(item.id));$('#item-list').append(b)}if(!rows.length)$('#item-list').append(elem('p','hint','还没有内容，点击上方按钮开始。'))}
function updateHeader(){if(!$('#settings').hidden){$('#current-title').textContent='设置与偏好';$('#section-title').textContent='AstraAgent / 设置';return}const item=state.mode==='chat'?state.session:state.board;$('#current-title').textContent=item?.title||(state.mode==='chat'?'新的开始':'无限画布');$('#section-title').textContent=state.mode==='chat'?'AstraAgent / 对话':'AstraAgent / 画布';$('#new-item').textContent=state.mode==='chat'?'＋ 新建会话':'＋ 新建画布';$('#list-title').textContent=state.mode==='chat'?'最近会话':'我的画布';for(const name of ['rename','delete','export'])$('#'+name).disabled=!item;$('#save-status').textContent=state.mode==='chat'?'会话保存在本机':state.dirty===state.saved?'已保存到本机':'等待保存…'}
async function switchMode(mode){if(!$('#settings').hidden&&!await closeSettingsPage())return;if(state.mode===mode)return;if(state.running.size){toast('请等待画布任务完成后再切换。');return;}if(!await flushBoard())return;state.mode=mode;$('#chat-view').hidden=mode!=='chat';$('#canvas-view').hidden=mode!=='canvas';$('#chat-tab').classList.toggle('active',mode==='chat');$('#canvas-tab').classList.toggle('active',mode==='canvas');updateHeader();await refreshList();if(mode==='canvas'){if(!state.board){if(state.canvases[0])await openBoard(state.canvases[0].id);else {renderNodes();fit()}}else requestAnimationFrame(()=>{renderNodes();fit()})}$('#sidebar-placeholder')?.remove();$('#app .sidebar').classList.remove('open')}
async function newSession(){const s=await api('/api/sessions','POST',{title:typeof uiText==='function'?uiText('新会话'):'新会话',conversation_mode:typeof getConversationMode==='function'?getConversationMode():'agent'});await openSession(s);await refreshList();return s}
const composerDrafts = new Map();
async function openSession(session) {
  if (!$('#settings').hidden && !await closeSettingsPage()) return;
  const input = $('#chat-input'), previous = state.session?.id ?? null;
  state.session = session;
  if (previous !== session.id) {
    if (input.value) composerDrafts.set(previous, {text: input.value, start: input.selectionStart, end: input.selectionEnd});
    else composerDrafts.delete(previous);
    const draft = composerDrafts.get(session.id);
    input.value = draft?.text ?? '';
    if (draft) input.setSelectionRange(draft.start, draft.end);
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }
  state.messages = [];
  $('#chat-error').hidden = true;
  updateHeader();
  renderList();
  $('#app .sidebar').classList.remove('open');
  const request = ++messageRequest;
  const messages = await api(`/api/sessions/${session.id}/messages`);
  if (request !== messageRequest || state.session?.id !== session.id) return;
  state.messages = messages;
  renderMessages();
}
function markdown(text){const block=elem('div','markdown');const parts=text.split(/```/);parts.forEach((part,i)=>{if(i%2){const code=part.replace(/^[\w+-]*\n/,'');const pre=elem('pre');pre.append(elem('code','',code));block.append(pre)}else{for(const chunk of part.split(/\n\n+/)){if(!chunk.trim())continue;if(/^#{1,6}\s/.test(chunk))block.append(elem('h3','',chunk.replace(/^#{1,6}\s+/,'')));else block.append(elem('p','',chunk))}}});return block}
// Keep message DOM, focus, media and native card state across stream updates.
const messageViews = new WeakMap();
let messageViewSession;
function renderMessages() {
  const list = $('#messages');
  const session = state.session?.id;
  if (messageViewSession !== session) {
    list.replaceChildren();
    messageViewSession = session;
  }
  list.classList.toggle('has-streaming', state.messages.some(message => message.streaming));
  if (!state.messages.length) {
    if (!list.querySelector('.welcome')) {
      list.replaceChildren();
      const welcome = elem('div', 'welcome');
      welcome.append(elem('h1', '', '今天想做什么？'), elem('p', '', '输入 / 选择技能，输入 @ 加载插件。'));
      const suggestions = elem('div', 'suggestions');
      for (const text of ['帮我梳理一个创意', '写一段有趣的故事', '解释一个复杂概念']) {
        const button = elem('button', '', text + ' ↗');
        button.onclick = () => { $('#chat-input').value = text; $('#chat-input').focus(); };
        suggestions.append(button);
      }
      welcome.append(suggestions);
      list.append(welcome);
    }
  } else {
    list.querySelector('.welcome')?.remove();
    const articles = [...list.querySelectorAll(':scope > .message')];
    const keyed = new Map(articles.map(article => [messageViews.get(article)?.message.id, article]));
    const retained = new Set();
    state.messages.forEach((message, index) => {
      let article = message.id == null ? null : keyed.get(message.id);
      const candidate = articles[index], previous = candidate && messageViews.get(candidate);
      if (!article && previous && previous.message.role === message.role &&
          (previous.message === message || previous.message.id == null)) article = candidate;
      if (!article || retained.has(article)) {
        article = elem('article', 'message ' + message.role);
        messageViews.set(article, {message, content: null});
        if (message.role !== 'user') {
          const label = {architect: '⌘ 架构师', critic: '◇ 挑错者', product: '◎ 用户视角', security: '⬡ 安全审查', synthesis: '✳ 综合结论'}[message.persona];
          article.append(elem('div', 'message-header', label || 'AstraAgent'));
        }
      }
      const view = messageViews.get(article);
      view.message = message;
      article.classList.toggle('synthesis-message', message.persona === 'synthesis');
      if (view.content !== message.content || view.renderer !== markdown) {
        const body = article.querySelector(':scope > .markdown');
        const next = markdown(message.content);
        if (message.role === 'user' && typeof decoratePromptTags === 'function') decoratePromptTags(next);
        if (body) body.replaceWith(next); else article.append(next);
        view.content = message.content;
        view.renderer = markdown;
      }
      const at = list.children[index];
      if (at !== article) list.insertBefore(article, at || null);
      retained.add(article);
    });
    for (const article of articles) if (!retained.has(article)) article.remove();
  }
  const busy = !!(state.session && state.pending.has(state.session.id));
  let pending = list.querySelector(':scope > .pending');
  if (busy && !state.messages.some(message => message.streaming)) {
    if (!pending) { pending = elem('div', 'pending'); list.append(pending); }
    pending.textContent = '✦ ' + (state.reviewMode ? '多人格并行审查与汇总中…' : '模型正在思考，请稍候…');
  } else pending?.remove();
  $('#send').disabled = busy;
}
async function refreshSessionMessages(sid) {
  if (state.session?.id !== sid) return false;
  const request = messageRequest;
  const messages = await api(`/api/sessions/${sid}/messages`);
  if (state.session?.id !== sid || request !== messageRequest) return false;
  state.messages = messages;
  return true;
}
async function sendMessage(e, submittedContent, submittedAttachments) {
  e.preventDefault();
  if (submitting || (typeof uploadBusy !== 'undefined' && uploadBusy)) return;
  const direct = typeof submittedContent === 'string';
  const content = (direct ? submittedContent.trim() : $('#chat-input').value.trim()) ||
    (typeof pendingAttachments !== 'undefined' && pendingAttachments.length ? '请分析附件内容。' : '');
  if (!content) return;
  if (!hasModelConnection()) { showSettings(); return; }
  $('#chat-error').hidden = true;
  let sid, sendSucceeded = false;
  submitting = true;
  try {
    if (!state.session) {
      const input = $('#chat-input');
      const preservedDraft = submittedAttachments ? input.value : '';
      await newSession();
      composerDrafts.delete(null);
      if (preservedDraft && !input.value) {
        input.value = preservedDraft;
        input.dispatchEvent(new Event('input', {bubbles: true}));
      }
    }
    sid = state.session.id;
    if (state.pending.has(sid)) return;
    state.pending.add(sid);
    const first = state.messages.length === 0;
    state.messages.push({role: 'user', content});
    if (!direct) $('#chat-input').value = '';
    if ((!direct || submittedAttachments) && typeof beginAttachmentSend === 'function') beginAttachmentSend(sid, submittedAttachments);
    renderMessages();
    if (first && state.session.title === '新会话') {
      state.session.title = content.slice(0, 28);
      await api(`/api/sessions/${sid}`, 'PATCH', {title: state.session.title});
      updateHeader();
      await refreshList();
    }
    if (state.reviewMode && !direct) {
      const selected = $$('.persona-picks input:checked').map(i => i.value);
      if (selected.length < 2) throw new Error('多人格审查至少选择两个视角。');
      await api(`/api/sessions/${sid}/review`, 'POST', {
        content, personas: selected, ...runtimeOptions(),
        ...(typeof attachmentOptions === 'function' ? attachmentOptions(sid) : {})
      });
    } else await streamChat(sid, content);
    sendSucceeded = true;
    await refreshSessionMessages(sid);
    await refreshList();
  } catch (error) {
    if (state.session?.id !== sid) { toast(error.message); return; }
    const request = messageRequest;
    const recoverable = (await api(`/api/sessions/${sid}/executions`).catch(() => []))
      .some(item => item.resumable);
    if (state.session?.id !== sid || request !== messageRequest) return;
    if (recoverable) {
      if (!await refreshSessionMessages(sid)) return;
      $('#chat-error').textContent = error.message + ' 任务已保存，可使用继续任务恢复。';
    } else {
      state.messages = state.messages.filter(m => !(m.role === 'user' && m.content === content && m.id === undefined));
      if (!direct && !$('#chat-input').value) $('#chat-input').value = content;
      $('#chat-error').textContent = error.message + ' 可查看任务记录。';
    }
    $('#chat-error').hidden = false;
  } finally {
    if ((!direct || submittedAttachments) && typeof finishAttachmentSend === 'function') finishAttachmentSend(sid, sendSucceeded);
    submitting = false;
    if (sid) state.pending.delete(sid);
    renderMessages();
  }
  return sendSucceeded;
}

async function createBoard(example=false, imported=null) {
  if (state.running.size || state.creatingBoard) return false;
  state.creatingBoard = true;
  try {
    if (!await flushBoard()) return false;
    const title = imported?.title || await appPrompt('画布名称', '新的灵感画布');
    if (!title?.trim()) return false;
    const board = {id:uid(), title:title.trim().slice(0,200), data:imported?.data || {nodes:[],edges:[]}, revision:0};
    const result = await api('/api/canvases/' + board.id, 'PUT', board);
    board.revision = result.revision;
    state.board = board;
    resetBoardState();
    renderNodes();
    updateHeader();
    requestAnimationFrame(fit);
    await refreshList();
    return true;
  } finally { state.creatingBoard = false; }
}
function resetBoardState(){clearCanvasSelection();state.selected=null;state.dirty=state.saved=0;state.history=[];state.redo=[];state.connecting=false;state.source=null;$('#connect').classList.remove('active');renderInspector()}
async function openBoard(id){if(!$('#settings').hidden&&!await closeSettingsPage())return;if(state.running.size){toast('请等待画布任务完成。');return;}if(!await flushBoard())return;state.board=await api('/api/canvases/'+id);resetBoardState();renderNodes();renderList();updateHeader();requestAnimationFrame(fit);$('#app .sidebar').classList.remove('open')}
function record(){state.history.push(clone(state.board.data));if(state.history.length>40)state.history.shift();state.redo=[];updateUndo()}
function updateUndo(){$('#undo').disabled=!state.history.length;$('#redo').disabled=!state.redo.length}
function changed(){state.dirty++;updateHeader();clearTimeout(saveTimer);saveTimer=setTimeout(()=>flushBoard(),550)}
async function flushBoard(){clearTimeout(saveTimer);if(state.savePromise)return state.savePromise;if(!state.board||state.dirty===state.saved)return true;const board=state.board;state.savePromise=(async()=>{try{while(state.board===board&&state.dirty!==state.saved){const generation=state.dirty;const payload={title:board.title,data:clone(board.data),revision:board.revision};$('#save-status').textContent='保存中…';const r=await api('/api/canvases/'+board.id,'PUT',payload);board.revision=r.revision;state.saved=generation}updateHeader();return true}catch(e){$('#save-status').textContent='保存失败 · Ctrl+S 重试';toast(e.message);return false}finally{state.savePromise=null}})();return state.savePromise}
function viewTransform(){$('#world').style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;$('#zoom-value').textContent=Math.round(state.scale*100)+'%';$('#viewport').style.backgroundSize=(22*state.scale)+'px '+(22*state.scale)+'px';$('#viewport').style.backgroundPosition=state.x+'px '+state.y+'px'}
function fit(){const v=$('#viewport'),nodes=state.board?.data.nodes||[];if(!v.clientWidth)return;const minX=nodes.length?Math.min(...nodes.map(n=>n.x)):0,minY=nodes.length?Math.min(...nodes.map(n=>n.y)):0,maxX=nodes.length?Math.max(...nodes.map(n=>n.x+260)):600,maxY=nodes.length?Math.max(...nodes.map(n=>n.y+198)):300;state.scale=Math.max(.25,Math.min(1,(v.clientWidth-100)/(maxX-minX),(v.clientHeight-180)/(maxY-minY)));state.x=(v.clientWidth-(maxX-minX)*state.scale)/2-minX*state.scale;state.y=(v.clientHeight-(maxY-minY)*state.scale)/2-minY*state.scale;viewTransform()}
function zoom(factor,cx,cy){const v=$('#viewport');cx=cx??v.clientWidth/2;cy=cy??v.clientHeight/2;const next=Math.min(2,Math.max(.25,state.scale*factor)),ratio=next/state.scale;state.x=cx-(cx-state.x)*ratio;state.y=cy-(cy-state.y)*ratio;state.scale=next;viewTransform()}
function renderNodes(){const container=$('#nodes');container.replaceChildren();for(const n of state.board?.data.nodes||[]){const card=elem('article',`node ${n.type}${state.selected===n.id?' selected':''}`);card.dataset.id=n.id;card.style.left=n.x+'px';card.style.top=n.y+'px';const head=elem('div','node-head');head.append(elem('span','',`${symbols[n.type]} ${types[n.type]}`),elem('span','',state.running.has(n.id)?'执行中…':'···'));card.append(head,elem('div','node-title',n.title||'未命名'),elem('div','node-content',n.content||'点击编辑内容'),elem('span','node-dot',n.type==='agent'?'AI TASK':'LOCAL'));container.append(card)}renderEdges();renderInspector();updateUndo()}
function renderEdges(){const svg=$('#edges');svg.replaceChildren();const data=state.board?.data;if(!data)return;for(const edge of data.edges){const a=data.nodes.find(n=>n.id===edge.from),b=data.nodes.find(n=>n.id===edge.to);if(!a||!b)continue;const x=a.x+260,y=a.y+99,tx=b.x,ty=b.y+99;const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.classList.add('edge');p.setAttribute('d',`M${x},${y} C${x+90},${y} ${tx-90},${ty} ${tx},${ty}`);svg.append(p);const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',tx);dot.setAttribute('cy',ty);dot.setAttribute('r',4);dot.setAttribute('fill','#779be4');svg.append(dot)}}
function selectedNode(){return state.board?.data.nodes.find(n=>n.id===state.selected)}
function pick(id){state.selected=id;$$('.node').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));renderInspector()}
function renderInspector(){const n=selectedNode();$('#inspector').classList.toggle('has-selection',!!n);$('#inspector-empty').hidden=!!n;$('#node-editor').hidden=!n;$('#node-type').textContent=n?types[n.type]:'未选择';if(!n)return;$('#node-title').value=n.title;$('#node-content').value=n.content;$('#run-node').hidden=n.type!=='agent';$('#run-hint').hidden=n.type!=='agent';$('#run-node').disabled=state.running.has(n.id);$('#run-node').textContent=state.running.has(n.id)?'模型正在执行…':'✦ 执行任务';$('#edge-list').replaceChildren();for(const e of state.board.data.edges.filter(e=>e.from===n.id||e.to===n.id)){const other=state.board.data.nodes.find(x=>x.id===(e.from===n.id?e.to:e.from));const row=elem('div','edge-item');row.append(elem('span','',(e.from===n.id?'→ ':'← ')+(other?.title||'未命名')));const b=elem('button','','×');b.title='删除连线';b.onclick=()=>{record();state.board.data.edges=state.board.data.edges.filter(x=>x!==e);changed();renderEdges();renderInspector()};row.append(b);$('#edge-list').append(row)}}
function vacant(x,y){for(let i=0;i<300;i++){if(!state.board.data.nodes.some(n=>Math.abs(n.x-x)<285&&Math.abs(n.y-y)<220))return {x,y};y+=230;}return {x,y};}
function addNode(type){if(!state.board||!hasCanvasCapacity(1))return;record();const v=$('#viewport');const n={id:uid(),type,title:'新'+types[type],content:'',x:Math.round((v.clientWidth/2-state.x)/state.scale-130),y:Math.round((v.clientHeight/2-state.y)/state.scale-99)};Object.assign(n,vacant(n.x,n.y));state.board.data.nodes.push(n);state.selected=n.id;changed();renderNodes();fit();$('#node-title').focus()}
async function removeNode(){const n=selectedNode();if(!n)return;if(state.running.has(n.id)){toast('此节点正在执行，请等待完成。');return}if(!await appConfirm('删除此节点及关联连线？'))return;record();state.board.data.nodes=state.board.data.nodes.filter(x=>x.id!==n.id);state.board.data.edges=state.board.data.edges.filter(x=>x.from!==n.id&&x.to!==n.id);state.selected=null;changed();renderNodes()}
for(const [id,field] of [['node-title','title'],['node-content','content']]){let editing=false;$('#'+id).addEventListener('focus',()=>{editing=false});$('#'+id).addEventListener('input',e=>{const n=selectedNode();if(!n)return;if(!editing){record();editing=true}n[field]=e.target.value;changed();const card=$$('.node').find(el=>el.dataset.id===n.id);if(card)card.querySelector(field==='title'?'.node-title':'.node-content').textContent=n[field]})}
$('#connect').onclick=()=>{state.connecting=!state.connecting;state.source=null;$('#connect').classList.toggle('active',state.connecting);if(state.connecting)toast('依次点击来源节点和目标节点')};
$('#undo').onclick=()=>{if(!state.history.length)return;state.redo.push(clone(state.board.data));state.board.data=state.history.pop();state.selected=null;changed();renderNodes()};$('#redo').onclick=()=>{if(!state.redo.length)return;state.history.push(clone(state.board.data));state.board.data=state.redo.pop();state.selected=null;changed();renderNodes()};
$$('[data-add]').forEach(b=>b.onclick=()=>addNode(b.dataset.add));$('#remove-node').onclick=removeNode;$('#duplicate-node').onclick=()=>{const n=selectedNode();if(!n||!hasCanvasCapacity(1))return;record();const {outputFor, sessionId, ...data}=clone(n);const copy={...data,id:uid(),...vacant(n.x+40,n.y+40)};state.board.data.nodes.push(copy);state.selected=copy.id;changed();renderNodes()};$('#run-node').onclick=safely(()=>runNode());
$('#zoom-in').onclick=()=>zoom(1.2);$('#zoom-out').onclick=()=>zoom(1/1.2);$('#fit').onclick=fit;
$('#chat-form').onsubmit = sendMessage;
$('#chat-input').onkeydown = event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  const send = $('#send');
  if (!send.disabled && !send.hidden) $('#chat-form').requestSubmit();
};
$('#review-toggle').onclick=()=>{state.reviewMode=!state.reviewMode;$('#review-toggle').classList.toggle('active',state.reviewMode);$('#review-toggle').setAttribute('aria-pressed',String(state.reviewMode));$('#review-panel').hidden=!state.reviewMode;$('#chat-input').placeholder=state.reviewMode?'写下要评审的方案、代码或想法…':'写下你的问题…';$('#send').setAttribute('aria-label',state.reviewMode?'开始多人格审查':'发送消息')};
let themePreference='light', settingsDirty=false;
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme){themePreference=['light','dark','system'].includes(theme)?theme:'light';const dark=themePreference==='dark'||(themePreference==='system'&&systemTheme.matches);document.documentElement.dataset.theme=dark?'dark':'light';$('#theme-label').textContent=themePreference==='system'?'自动':dark?'深色':'浅色';$('#theme-toggle').querySelector('span:first-of-type').textContent=dark?'切换浅色模式':'切换暗色模式';$$('[data-theme-choice]').forEach(b=>{b.classList.toggle('active',b.dataset.themeChoice===themePreference);b.setAttribute('aria-pressed',String(b.dataset.themeChoice===themePreference))});try{localStorage.setItem('astra-theme',themePreference)}catch(e){}}
systemTheme.addEventListener('change',()=>{if(themePreference==='system')applyTheme('system')});
$('#theme-toggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
$$('[data-theme-choice]').forEach(b=>b.onclick=()=>applyTheme(b.dataset.themeChoice));
function applyPreferences(){const reduced=$('#reduce-motion').checked,size=$('#message-size').value;document.documentElement.dataset.motion=reduced?'reduced':'full';document.documentElement.style.setProperty('--message-size',size+'px');try{localStorage.setItem('astra-motion',reduced?'reduced':'full');localStorage.setItem('astra-message-size',size)}catch(e){}}
$('#reduce-motion').onchange=applyPreferences;$('#message-size').onchange=applyPreferences;
try{$('#reduce-motion').checked=localStorage.getItem('astra-motion')==='reduced';const size=localStorage.getItem('astra-message-size');$('#message-size').value=['13','15','17'].includes(size)?size:'13'}catch(e){}applyPreferences();
function selectSettingsTab(name){$$('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==name);$$('[data-settings-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.settingsTab===name);b.setAttribute('aria-current',b.dataset.settingsTab===name?'page':'false')})}
$$('[data-settings-tab]').forEach(b=>b.onclick=()=>selectSettingsTab(b.dataset.settingsTab));
function openSettingsPage(){settingsDirty=false;$('#settings').hidden=false;$('#chat-view').hidden=true;$('#canvas-view').hidden=true;document.body.classList.add('in-settings');$('#app .sidebar').classList.remove('open');$('#settings-open').classList.add('active');selectSettingsTab('connection');updateHeader();$('#settings').scrollTop=0;$('#settings-close').focus({preventScroll:true})}
async function closeSettingsPage(){if(settingsDirty&&!await appConfirm('接口设置尚未保存，放弃这些修改？'))return false;settingsDirty=false;$('#api-key').value='';$('#settings').hidden=true;document.body.classList.remove('in-settings');$('#settings-open').classList.remove('active');$('#chat-view').hidden=state.mode!=='chat';$('#canvas-view').hidden=state.mode!=='canvas';updateHeader();if(state.mode==='canvas')requestAnimationFrame(fit);$('#settings-open').focus();return true}
$('#settings-form').addEventListener('input',()=>{settingsDirty=true});
$('#chat-tab').onclick=safely(()=>switchMode('chat'));$('#canvas-tab').onclick=safely(()=>switchMode('canvas'));$('#new-item').onclick=safely(async()=>{if(!$('#settings').hidden&&!await closeSettingsPage())return;return state.mode==='chat'?newSession():createBoard()});
$('#settings-open').onclick=showSettings;$('#model-pill').onclick=showSettings;$('#settings-close').onclick=closeSettingsPage;$('#settings-form').onsubmit=e=>{e.preventDefault();configAction('save',$('#save-settings'))};$('#test-api').onclick=()=>configAction('test',$('#test-api'));$('#get-models').onclick=()=>configAction('models',$('#get-models'));
$('#rename').onclick=safely(async()=>{const item=state.mode==='chat'?state.session:state.board;if(!item)return;const title=await appPrompt('新的名称',item.title);if(!title?.trim())return;if(state.mode==='chat'){await api('/api/sessions/'+item.id,'PATCH',{title:title.trim().slice(0,200)});item.title=title.trim().slice(0,200)}else{item.title=title.trim().slice(0,200);changed();if(!await flushBoard())return}updateHeader();await refreshList()});
$('#delete').onclick=safely(async()=>{if(state.running.size){toast('请等待画布任务执行完成。');return}const item=state.mode==='chat'?state.session:state.board;if(!item||!await appConfirm(`删除「${item.title}」？此操作无法撤销。`))return;if(state.mode==='chat'){await api('/api/sessions/'+item.id,'DELETE');state.session=null;state.messages=[];messageRequest++;renderMessages()}else{if(!await flushBoard())return;await api('/api/canvases/'+item.id,'DELETE');state.board=null;resetBoardState();renderNodes()}await refreshList();updateHeader();if(state.mode==='canvas'){if(state.canvases[0])await openBoard(state.canvases[0].id);else {renderNodes();fit()}}});
$('#export').onclick=safely(async()=>{if(state.mode==='chat'){if(!state.session)return;const messages=await api('/api/sessions/'+state.session.id+'/messages');download('会话.md','# '+state.session.title+'\n\n'+messages.map(m=>'## '+(m.role==='user'?'我':'AI')+'\n\n'+m.content).join('\n\n'),'text/markdown;charset=utf-8')}else if(state.board)download('画布.json',JSON.stringify({title:state.board.title,data:state.board.data},null,2))});
$('#import').onclick=()=>$('#import-file').click();$('#import-file').onchange=safely(async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>2_000_000)throw new Error('文件不能超过 2 MB。');const value=JSON.parse(await f.text());if(!value||typeof value.title!=='string'||!value.data)throw new Error('请选择由本应用导出的画布 JSON。');if(await createBoard(false,value))toast('画布已导入')}finally{e.target.value=''}});
$('#open-side').onclick=()=>$('#app .sidebar').classList.add('open');$('#close-side').onclick=()=>$('#app .sidebar').classList.remove('open');
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#settings').hidden){closeSettingsPage();return}state.connecting=false;state.source=null;$('#connect').classList.remove('active');$('#app .sidebar').classList.remove('open')}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!$('#settings').hidden){$('#settings-form').requestSubmit();return}flushBoard()}if(state.mode!=='canvas'||$('#canvas-view').hidden||!$('#settings').hidden||document.querySelector('dialog[open]')||document.activeElement.closest('input,textarea,select,[contenteditable]'))return;if(e.key==='Delete')void removeCanvasSelection();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();(e.shiftKey?$('#redo'):$('#undo')).click()}});
function hasReloadGuard(){return settingsDirty||state.dirty!==state.saved||state.pending.size||state.running.size;}
function reloadWorkspace(){window.workspaceLoading.reload({cover:!hasReloadGuard()});}
window.addEventListener('beforeunload',e=>{if(hasReloadGuard()){e.preventDefault();e.returnValue=''}});
async function boot(){try{const access=new URLSearchParams(location.hash.slice(1)).get('access');if(access){state.token=access;history.replaceState(null,'',location.pathname+location.search)}let theme='light';try{theme=localStorage.getItem('astra-theme')||'light'}catch(e){}applyTheme(theme);const b=await api('/api/bootstrap');state.token=b.token;state.settings=b.settings;state.onboarding=b.onboarding||{};updateSettings();await refreshList();updateHeader();renderMessages();if(b.onboarding?.required){firstRunActive=true;firstRunStep=1;renderFirstRunStep();return}if(state.sessions[0])await openSession(state.sessions[0])}catch(e){$('#chat-error').textContent=e.message;$('#chat-error').hidden=false;toast(e.message)}}
const workspaceBoot=boot();
window.workspaceLoading?.track(workspaceBoot);
