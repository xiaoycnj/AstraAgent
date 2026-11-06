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
conversationList.addEventListener('wheel',event=>{if(event.deltaY<0)conversationFollowing=false;},{passive:true});
conversationList.addEventListener('keydown',event=>{if(['ArrowUp','PageUp','Home'].includes(event.key))conversationFollowing=false;});
conversationList.addEventListener('touchmove',()=>conversationFollowing=false,{passive:true});
conversationList.addEventListener('scroll',()=>{if(conversationList.scrollHeight-conversationList.clientHeight-conversationList.scrollTop<40)conversationFollowing=true;scheduleConversationMap();},{passive:true});
function paintConversation(){
 conversationFrame=0;const sid=state.session?.id;const changed=sid!==conversationSession;
 const follow=changed||conversationFollowing&&conversationList.scrollHeight-conversationList.clientHeight-conversationList.scrollTop<100;
 const top=conversationList.scrollTop;const articles=Array.from(conversationList.querySelectorAll(':scope>.message'));
 const same=!changed&&conversationObjects.length===state.messages.length&&state.messages.every((message,index)=>message===conversationObjects[index]);
 if(same&&state.messages.some(message=>message.streaming)&&articles.length===state.messages.length){
  state.messages.forEach((message,index)=>{if(!message.streaming)return;const article=articles[index];let body=article.querySelector('.markdown');if(!body){body=elem('div','markdown');article.append(body);}if(body.dataset.streamText!==message.content){body.classList.add('streaming-text');body.textContent=message.content;body.dataset.streamText=message.content;}});
 }else{
  const visible=articles.findIndex(article=>conversationTop(article)+article.offsetHeight>top);
  const offset=visible<0?0:conversationTop(articles[visible])-top;
  const expanded=articles.map(article=>Array.from(article.querySelectorAll('details')).map(detail=>detail.open));
  previousConversationRender();
  const next=Array.from(conversationList.querySelectorAll(':scope>.message'));
  if(!changed){next.forEach((article,index)=>article.querySelectorAll('details').forEach((detail,i)=>{detail.open=expanded[index]?.[i]||false;}));if(!follow&&next[visible])conversationList.scrollTop=conversationTop(next[visible])-offset;else if(!follow)conversationList.scrollTop=top;}
  conversationObjects=state.messages.slice();conversationSession=sid;
 }
 if(follow){conversationFollowing=true;conversationList.scrollTop=conversationList.scrollHeight;}
 else if(same)conversationList.scrollTop=top;
 syncConversationStop();scheduleConversationMap();
}
renderMessages=function(){syncConversationStop();if(state.messages.some(message=>message.streaming)){if(!conversationFrame)conversationFrame=requestAnimationFrame(paintConversation);}else{if(conversationFrame)cancelAnimationFrame(conversationFrame);paintConversation();}};
const conversationRail=elem('nav','conversation-rail');conversationRail.id='conversation-rail';conversationRail.setAttribute('aria-label','对话快速导航');
const conversationTicks=elem('div','conversation-ticks');const conversationPreview=elem('div','conversation-preview');conversationPreview.hidden=true;conversationPreview.setAttribute('role','tooltip');conversationPreview.id='conversation-preview';conversationRail.append(conversationTicks,conversationPreview);$('#chat-view').append(conversationRail);
const conversationLatest=actionButton('回到最新',()=>{conversationFollowing=true;conversationList.scrollTop=conversationList.scrollHeight;scheduleConversationMap();},'conversation-latest');conversationLatest.hidden=true;$('#chat-view').append(conversationLatest);
let conversationMapFrame=0,conversationTargets=[],conversationHover=-1;
function scheduleConversationMap(){if(!conversationMapFrame)conversationMapFrame=requestAnimationFrame(updateConversationMap);}
function updateConversationMap(){
 conversationMapFrame=0;const bottom=Math.max(100,$('#chat-view').getBoundingClientRect().bottom-conversationList.getBoundingClientRect().bottom+12);conversationRail.style.bottom=bottom+'px';conversationLatest.style.bottom=bottom+'px';const articles=Array.from(conversationList.querySelectorAll(':scope>.message'));
 const capacity=Math.max(1,Math.min(120,Math.floor(conversationRail.clientHeight/10)));
 const targets=articles.length<=capacity?articles.map((_,i)=>i):Array.from({length:capacity},(_,i)=>Math.round(i*(articles.length-1)/Math.max(1,capacity-1)));
 if(targets.join(',')!==conversationTargets.join(',')||conversationTicks.children.length!==targets.length){conversationTicks.replaceChildren();conversationTargets=targets;for(const index of targets){const button=elem('button','conversation-tick');button.type='button';button.setAttribute('aria-label','跳转到第 '+(index+1)+' 条消息');button.setAttribute('aria-describedby','conversation-preview');button.onclick=()=>jumpConversation(index);button.onfocus=()=>previewConversation(index);button.onblur=()=>{conversationPreview.hidden=true;};conversationTicks.append(button);}}
 conversationRail.hidden=articles.length<2;let active=0;const point=conversationList.scrollTop+conversationList.clientHeight*.35;
 articles.forEach((article,index)=>{if(conversationTop(article)<=point)active=index;});
 let nearest=0;targets.forEach((index,i)=>{if(Math.abs(index-active)<Math.abs(targets[nearest]-active))nearest=i;});
 Array.from(conversationTicks.children).forEach((button,i)=>{button.classList.toggle('active',i===nearest);button.setAttribute('aria-current',i===nearest?'true':'false');});
 conversationLatest.hidden=conversationList.scrollHeight-conversationList.clientHeight-conversationList.scrollTop<100;
}
function jumpConversation(index){const target=conversationList.querySelectorAll(':scope>.message')[index];if(!target)return;conversationFollowing=false;conversationList.scrollTo({top:conversationTop(target)-24,behavior:'instant'});}
function previewConversation(index){const message=state.messages[index];if(!message)return;conversationPreview.replaceChildren(elem('strong','',message.role==='user'?'你':'AstraAgent'),elem('p','',message.content.slice(0,180)||'正在生成…'));conversationPreview.hidden=false;}
conversationRail.addEventListener('pointermove',event=>{const rect=conversationTicks.getBoundingClientRect();if(!conversationTargets.length)return;const at=Math.max(0,Math.min(conversationTargets.length-1,Math.floor((event.clientY-rect.top)/Math.max(1,rect.height)*conversationTargets.length)));Array.from(conversationTicks.children).forEach((button,i)=>button.style.setProperty('--proximity',Math.max(0,1-Math.abs(at-i)/5)));if(at!==conversationHover){conversationHover=at;previewConversation(conversationTargets[at]);}conversationPreview.style.top=Math.min(conversationRail.clientHeight-90,Math.max(0,event.clientY-conversationRail.getBoundingClientRect().top-30))+'px';});
conversationRail.addEventListener('pointerleave',()=>{conversationHover=-1;conversationPreview.hidden=true;for(const button of conversationTicks.children)button.style.setProperty('--proximity',0);});
new ResizeObserver(scheduleConversationMap).observe(conversationList);new ResizeObserver(scheduleConversationMap).observe($('#chat-form'));
new MutationObserver(scheduleConversationMap).observe(conversationList,{childList:true,subtree:false});
setInterval(syncConversationStop,300);renderMessages();
