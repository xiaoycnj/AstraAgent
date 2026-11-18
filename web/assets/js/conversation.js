// Stable streaming updates and a bounded, keyboard-accessible conversation map.
const conversationList=$('#messages');conversationList.tabIndex=0;
const previousConversationRender=renderMessages;
function conversationTop(article){return article.getBoundingClientRect().top-conversationList.getBoundingClientRect().top+conversationList.scrollTop;}
let conversationObjects=[],conversationSession=null,conversationFrame=0,conversationFollowing=true;
const conversationStop=actionButton('停止生成',stopConversation,'conversation-stop');conversationStop.id='stop-generation';conversationStop.hidden=true;const stopGlyph=document.createElementNS('http://www.w3.org/2000/svg','svg');stopGlyph.setAttribute('viewBox','0 0 20 20');stopGlyph.setAttribute('aria-hidden','true');const stopSquare=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const [key,value] of Object.entries({x:5,y:5,width:10,height:10,rx:2,fill:'currentColor'}))stopSquare.setAttribute(key,value);stopGlyph.append(stopSquare);conversationStop.prepend(stopGlyph);
$('#send').before(conversationStop);
const conversationStopping=new Set();
async function stopConversation(){
 const sid=state.session?.id;if(!sid||conversationStopping.has(sid))return;
 conversationStopping.add(sid);syncConversationStop();
 try{
  for(let attempt=0;attempt<40;attempt++){
   if(!state.pending.has(sid))return;
   let key=streamKeys.get(sid);if(!key){const job=await api('/api/sessions/'+sid+'/stream');if(job?.status==='running')key=job.id;}
   if(key){try{const result=await api('/api/stream/'+key+'/cancel','POST',{});toast(result.accepted?'正在停止，保留已有输出':'任务已经结束');return;}catch(error){if(error.status!==404)throw error;}}
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw new Error('停止请求尚未确认，请重试');
 }catch(error){toast(error.message);}finally{conversationStopping.delete(sid);syncConversationStop();}
}
function syncConversationStop(){const sid=state.session?.id;conversationStop.hidden=!sid||!state.pending.has(sid)||state.reviewMode;conversationStop.disabled=conversationStopping.has(sid);const label=conversationStopping.has(sid)?'stopping':'ready';if(conversationStop.dataset.label!==label){conversationStop.dataset.label=label;conversationStop.lastChild.textContent=label==='stopping'?'正在停止…':'停止生成';}}
let conversationAnchor = null, conversationLastTop = 0, conversationScrollDirection = null;
function captureConversationAnchor() {
 if (!conversationList.clientHeight) return;
 const articles = conversationList.querySelectorAll(':scope > .message');
 let low = 0, high = articles.length - 1;
 while (low <= high) {
  const middle = Math.floor((low + high) / 2), article = articles[middle];
  if (conversationTop(article) + article.offsetHeight <= conversationList.scrollTop) low = middle + 1;
  else high = middle - 1;
 }
 const article = articles[low];
 const blocks = article?.querySelectorAll(':scope > .markdown > :not(.stream-block), :scope > .markdown > .stream-block > *') || [];
 const node = [...blocks].find(block => conversationTop(block) + block.offsetHeight > conversationList.scrollTop) || article;
 conversationAnchor = node ? {node, offset: conversationTop(node) - conversationList.scrollTop} : null;
}
function setConversationTop(top) {
 conversationList.scrollTop = top;
 conversationLastTop = conversationList.scrollTop;
}
function restoreConversationPosition() {
 if (!conversationList.clientHeight) return;
 if (conversationFollowing) setConversationTop(conversationList.scrollHeight);
 else if (conversationAnchor?.node.isConnected) setConversationTop(conversationTop(conversationAnchor.node) - conversationAnchor.offset);
}
conversationList.addEventListener('wheel', event => {
 conversationScrollDirection = event.deltaY < 0 ? 'up' : 'down';
 if (event.deltaY < 0) {conversationFollowing = false; captureConversationAnchor();}
}, {passive: true});
conversationList.addEventListener('keydown', event => {
 if (['ArrowUp','PageUp','Home','ArrowDown','PageDown','End',' '].includes(event.key) && !event.target.closest('input,textarea,select,button,summary,[contenteditable=true]')) {
  conversationScrollDirection = ['ArrowUp','PageUp','Home'].includes(event.key) || event.shiftKey ? 'up' : 'down';
  if (conversationScrollDirection === 'up') {conversationFollowing = false; captureConversationAnchor();}
 }
});
let conversationTouchY = 0;
conversationList.addEventListener('touchstart', event => {conversationTouchY = event.touches[0].clientY;}, {passive: true});
conversationList.addEventListener('touchmove', event => {
 const y = event.touches[0].clientY;
 conversationScrollDirection = y > conversationTouchY ? 'up' : 'down';
 conversationTouchY = y; conversationFollowing = false; captureConversationAnchor();
}, {passive: true});
conversationList.addEventListener('scroll', () => {
 if (!conversationList.clientHeight) return;
 const top = conversationList.scrollTop;
 if (Math.abs(top - conversationLastTop) > 1) {
  const movedDown = top > conversationLastTop;
  conversationFollowing = (movedDown || conversationScrollDirection === 'down') && conversationList.scrollHeight - conversationList.clientHeight - top < 2;
  conversationLastTop = top;
  conversationScrollDirection = null;
  captureConversationAnchor();
 }
 scheduleConversationMap();
}, {passive: true});
let conversationResizeFrame = 0;
const conversationObserved = new Set();
const conversationResize = new ResizeObserver(() => {
 if (!conversationResizeFrame) conversationResizeFrame = requestAnimationFrame(() => {
  conversationResizeFrame = 0; restoreConversationPosition(); scheduleConversationMap();
 });
});
conversationResize.observe(conversationList);
function observeConversationArticles() {
 for (const node of conversationObserved) if (!node.isConnected) {conversationResize.unobserve(node); conversationObserved.delete(node);}
 for (const node of conversationList.querySelectorAll(':scope > .message')) if (!conversationObserved.has(node)) {conversationResize.observe(node); conversationObserved.add(node);}
}
function paintConversation(){
 conversationFrame=0;const sid=state.session?.id;const changed=sid!==conversationSession;
 const follow=changed||conversationFollowing;
 if(changed){conversationFollowing=true;conversationAnchor=null;conversationScrollDirection=null;}
 else if(!follow&&!conversationAnchor?.node.isConnected)captureConversationAnchor();
 const articles=Array.from(conversationList.querySelectorAll(':scope>.message'));
 const same=!changed&&conversationObjects.length===state.messages.length&&state.messages.every((message,index)=>message===conversationObjects[index]);
 if(same&&state.messages.some(message=>message.streaming)&&articles.length===state.messages.length&&articles.every(article=>messageViews.get(article)?.renderer===markdown)){
  state.messages.forEach((message,index)=>{if(!message.streaming)return;const article=articles[index];let body=article.querySelector('.markdown');if(!body){body=elem('div','markdown');article.append(body);}if(body.dataset.streamText!==message.content){updateRichStream(body,message.content);const view=messageViews.get(article);if(view){view.content=message.content;view.renderer=markdown;}}});
 }else{
  previousConversationRender();
  conversationObjects=state.messages.slice();conversationSession=sid;
 }
 conversationFollowing=follow;
 restoreConversationPosition();
 conversationList.classList.toggle('has-streaming',state.messages.some(message=>message.streaming));
 observeConversationArticles();
 syncConversationStop();scheduleConversationMap();
}
renderMessages=function(){syncConversationStop();if(state.messages.some(message=>message.streaming)){if(!conversationFrame)conversationFrame=requestAnimationFrame(paintConversation);}else{if(conversationFrame)cancelAnimationFrame(conversationFrame);paintConversation();}};
const conversationRail=elem('nav','conversation-rail');conversationRail.id='conversation-rail';conversationRail.setAttribute('aria-label','对话快速导航');
const conversationTicks=elem('div','conversation-ticks');const conversationPreview=elem('div','conversation-preview');conversationPreview.hidden=true;conversationPreview.setAttribute('role','tooltip');conversationPreview.id='conversation-preview';conversationRail.append(conversationTicks,conversationPreview);$('#chat-view').append(conversationRail);
const conversationLatest=actionButton('回到最新',()=>{conversationFollowing=true;conversationScrollDirection=null;setConversationTop(conversationList.scrollHeight);scheduleConversationMap();},'conversation-latest');conversationLatest.hidden=true;$('#chat-view').append(conversationLatest);
let conversationMapFrame=0,conversationTargets=[],conversationHover=-1;
function scheduleConversationMap(){if(!conversationMapFrame)conversationMapFrame=requestAnimationFrame(updateConversationMap);}
function updateConversationMap(){
 conversationMapFrame=0;const bottom=Math.max(100,$('#chat-view').getBoundingClientRect().bottom-conversationList.getBoundingClientRect().bottom+12);conversationRail.style.bottom=bottom+'px';conversationLatest.style.bottom=bottom+'px';const articles=Array.from(conversationList.querySelectorAll(':scope>.message'));
 const capacity=Math.max(1,Math.min(120,Math.floor(conversationRail.clientHeight/10)));
 const targets=articles.length<=capacity?articles.map((_,i)=>i):Array.from({length:capacity},(_,i)=>Math.round(i*(articles.length-1)/Math.max(1,capacity-1)));
 if(targets.join(',')!==conversationTargets.join(',')||conversationTicks.children.length!==targets.length){conversationTicks.replaceChildren();conversationTargets=targets;for(const index of targets){const button=elem('button','conversation-tick');button.type='button';button.setAttribute('aria-label','跳转到第 '+(index+1)+' 条消息');button.setAttribute('aria-describedby','conversation-preview');button.onclick=()=>jumpConversation(index);button.onfocus=()=>previewConversation(index);button.onblur=()=>{conversationPreview.hidden=true;};conversationTicks.append(button);}}
 conversationRail.hidden=articles.length<2;let active=0;const point=conversationList.scrollTop+conversationList.clientHeight*.35;
 let low=0,high=articles.length-1;
 while(low<=high){const middle=Math.floor((low+high)/2);if(conversationTop(articles[middle])<=point){active=middle;low=middle+1;}else high=middle-1;}
 let nearest=0;targets.forEach((index,i)=>{if(Math.abs(index-active)<Math.abs(targets[nearest]-active))nearest=i;});
 Array.from(conversationTicks.children).forEach((button,i)=>{button.classList.toggle('active',i===nearest);button.setAttribute('aria-current',i===nearest?'true':'false');});
 conversationLatest.hidden=conversationFollowing || conversationList.scrollHeight-conversationList.clientHeight-conversationList.scrollTop<2;
}
function jumpConversation(index){const target=conversationList.querySelectorAll(':scope>.message')[index];if(!target)return;conversationFollowing=false;conversationScrollDirection='up';setConversationTop(conversationTop(target)-24);captureConversationAnchor();}
function previewConversation(index){const message=state.messages[index];if(!message)return;conversationPreview.replaceChildren(elem('strong','',message.role==='user'?'你':'AstraAgent'),elem('p','',message.content.slice(0,180)||'正在生成…'));conversationPreview.querySelector('p').dataset.i18nIgnore='';conversationPreview.hidden=false;}
conversationRail.addEventListener('pointermove',event=>{const rect=conversationTicks.getBoundingClientRect();if(!conversationTargets.length)return;const at=Math.max(0,Math.min(conversationTargets.length-1,Math.floor((event.clientY-rect.top)/Math.max(1,rect.height)*conversationTargets.length)));Array.from(conversationTicks.children).forEach((button,i)=>button.style.setProperty('--proximity',Math.max(0,1-Math.abs(at-i)/5)));if(at!==conversationHover){conversationHover=at;previewConversation(conversationTargets[at]);}conversationPreview.style.top=Math.min(conversationRail.clientHeight-90,Math.max(0,event.clientY-conversationRail.getBoundingClientRect().top-30))+'px';});
conversationRail.addEventListener('pointerleave',()=>{conversationHover=-1;conversationPreview.hidden=true;for(const button of conversationTicks.children)button.style.setProperty('--proximity',0);});
new ResizeObserver(scheduleConversationMap).observe(conversationList);new ResizeObserver(scheduleConversationMap).observe($('#chat-form'));
new MutationObserver(scheduleConversationMap).observe(conversationList,{childList:true,subtree:false});
setInterval(syncConversationStop,300);renderMessages();
