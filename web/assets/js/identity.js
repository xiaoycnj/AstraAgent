// Name-based model identity. Original wireframe cube is the fallback.
const modelLogoRules=[
 [/deepseek|深度求索/i,'deepseek-color','DeepSeek'],
 [/claude|anthropic|(?:^|[\/_ .-])(?:sonnet|opus|haiku)(?:[\/_ .-]|$)/i,'claude-color','Anthropic'],
 [/glm|zhipu|智谱|(?:^|[\/_ .-])z[.-]?ai(?:[\/_ .-]|$)/i,'zhipu-color','Zhipu / GLM'],
 [/mimo|xiaomi|小米/i,'xiaomimimo','Xiaomi MiMo'],
 [/hunyuan|混元|tencent/i,'hunyuan-color','Tencent Hunyuan'],
 [/minimax|mini[-_ ]max|abab|海螺/i,'minimax-color','MiniMax'],
 [/gemini|gemma|google|nano[-_ ]banana/i,'gemini-color','Google Gemini'],
 [/qwen|qwq|qvq|通义|千问|alibaba/i,'qwen-color','Qwen'],
 [/grok|xai|x-ai/i,'grok','xAI'],
 [/mistral|mixtral|codestral|devstral|ministral/i,'mistral-color','Mistral'],
 [/llama|meta/i,'meta-color','Meta'],
 [/kimi|moonshot|月之暗面/i,'moonshot','Moonshot'],
 [/doubao|豆包|seed[-_ ](?:1|2)/i,'doubao-color','Doubao'],
 [/baichuan|百川/i,'baichuan-color','Baichuan'],
 [/wenxin|ernie|文心/i,'wenxin-color','Wenxin'],
 [/stepfun|step[-_ ]?[123]|阶跃星辰/i,'stepfun-color','StepFun'],
 [/(?:^|[\/_ .-])yi(?:[\/_ .-]|$)|零一万物|01[.-]?ai/i,'yi-color','01.AI'],
 [/internlm|书生/i,'internlm-color','InternLM'],
 [/nemotron|nvidia/i,'nvidia-color','NVIDIA'],
 [/cohere|command[-_ ](?:r|a)/i,'cohere-color','Cohere'],
 [/longcat|龙猫/i,'longcat-color','LongCat'],
 [/(?:^|[\/_ .-])ling(?:[\/_ .-]|$)|百灵/i,'ling-color','Ling'],
 [/ollama/i,'ollama','Ollama'],
 [/gpt|chatgpt|openai|(?:^|[\/_-])o[134](?:[\/_-]|$)/i,'openai','OpenAI']
];
function modelVendor(name){return modelLogoRules.find(([rule])=>rule.test(name||''))||[null,null,'其他模型']}
function modelLogo(name){const [,file,vendor]=modelVendor(name);if(file){const img=elem('img','model-logo');img.src='/assets/icons/models/'+file+'.svg';img.alt=vendor;img.title=vendor;img.draggable=false;img.onerror=()=>img.replaceWith(modelLogo(''));if(file==='openai'||file==='grok'||file==='moonshot'||file==='ollama'||file==='xiaomimimo')img.classList.add('monochrome-logo');return img}const svg=svgIcon('canvas');svg.classList.add('model-logo','cube-model-logo');svg.querySelector('path').setAttribute('d','M12 2 22 7v10l-10 5L2 17V7l10-5ZM2 7l10 5 10-5M12 12v10M12 2v10M2 17l10-5 10 5');svg.setAttribute('aria-label','默认模型');return svg}
function ensureModelLogo(target,name){if(!target)return;const existing=target.querySelector(':scope>.model-logo');const key=modelVendor(name)[1]||'cube';if(existing?.dataset.vendorKey===key)return;existing?.remove();const logo=modelLogo(name);logo.dataset.vendorKey=key;target.prepend(logo)}
function decorateModelNames(){ensureModelLogo($('#model-pill'),chosenModel());ensureModelLogo(reasoningModel,chosenModel());for(const option of modelList.children){if(!option.classList.contains('model-choice'))continue;const text=option.dataset.modelId||option.querySelector('span')?.textContent||chosenModel();ensureModelLogo(option,text==='默认'?chosenModel():text)}for(const row of $$('.task-event,.execution-event')){const modelText=row.querySelector('small');if(modelText&&['开始执行','任务开始','start'].includes(row.querySelector('span')?.textContent))ensureModelLogo(modelText,modelText.textContent)}const modelInput=$('#model');if(modelInput){modelInput.parentElement.classList.add('model-config-row');ensureModelLogo(modelInput.parentElement,modelInput.value)}for(const id of ['runtime-model','tts-model']){const input=$('#'+id);if(input?.parentElement){input.parentElement.classList.add('model-field');ensureModelLogo(input.parentElement,input.value)}}}
const previousIdentitySync=syncComposerControls;syncComposerControls=function(){previousIdentitySync();decorateModelNames()};const previousIdentityChoices=renderModelChoices;renderModelChoices=function(){previousIdentityChoices();decorateModelNames()};for(const input of [$('#model'),$('#runtime-model'),$('#tts-model')])input?.addEventListener('input',decorateModelNames);setInterval(decorateModelNames,650);decorateModelNames();
// Uploads are staged until a message succeeds. Failed sends keep the attachments for retry.
let pendingAttachments=[],sendingAttachments=null,uploadBusy=false;const attachmentPicker=elem('input');attachmentPicker.type='file';attachmentPicker.id='attachment-picker';attachmentPicker.multiple=true;attachmentPicker.hidden=true;attachmentPicker.accept='.png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md,.csv,.json,.py,.js,.ts,.html,.css,.xml,.yaml,.yml,.sql,.log,.tex,.rs,.java,.go,.cpp,.c,.h,.sh,.ps1,.toml,.ini,.vue,.jsx,.tsx,.svg';document.body.append(attachmentPicker);const attachmentButton=actionButton('',()=>attachmentPicker.click(),'attachment-add');attachmentButton.id='attachment-add';attachmentButton.title='上传附件 · 每个 5 MB，每条最多 6 个';attachmentButton.setAttribute('aria-label','上传附件');const clip=svgIcon('link');clip.querySelector('path').setAttribute('d','m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9');attachmentButton.append(clip);$('.composer-tools').prepend(attachmentButton);const attachmentTray=elem('div','attachment-tray');attachmentTray.id='attachment-tray';attachmentTray.hidden=true;$('#chat-form').insertBefore(attachmentTray,$('#chat-input'));
function attachmentCard(item,removable){const card=elem('div','attachment-card');if(item.kind==='image'){const img=elem('img');img.src='/api/attachments/'+item.id+'/content';img.alt=item.name;card.append(img)}else card.append(svgIcon('note'));const title=elem('div');title.append(elem('strong','',item.name),elem('small','',item.kind.toUpperCase()+' · '+(item.size/1024).toFixed(1)+' KB'));card.append(title);if(removable){const remove=actionButton('',()=>{pendingAttachments=pendingAttachments.filter(a=>a.id!==item.id);renderAttachmentTray()},'attachment-remove');remove.setAttribute('aria-label','移除附件 '+item.name);remove.disabled=submitting;remove.append(svgIcon('close'));card.append(remove)}else{const download=elem('a','attachment-download','下载');download.href='/api/attachments/'+item.id+'/content';download.download=item.name;card.append(download)}return card}
function renderAttachmentTray(){attachmentTray.replaceChildren(...pendingAttachments.map(item=>attachmentCard(item,true)));attachmentTray.hidden=!pendingAttachments.length;attachmentButton.disabled=uploadBusy||submitting;$('#send').disabled=uploadBusy||!!(state.session&&state.pending.has(state.session.id))}
async function uploadFiles(files){if(submitting||uploadBusy){toast('请等待当前任务完成');return}uploadBusy=true;renderAttachmentTray();try{for(const file of files){if(pendingAttachments.length>=6){toast('每条消息最多 6 个附件');break}if(file.size>5*1024*1024){toast(file.name+' 超过 5 MB');continue}if(pendingAttachments.reduce((n,a)=>n+a.size,0)+file.size>10*1024*1024){toast('附件总计最多 10 MB');continue}const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});try{const item=await api('/api/attachments','POST',{name:file.name,data});pendingAttachments.push(item);renderAttachmentTray()}catch(e){toast(file.name+'：'+e.message)}}}finally{uploadBusy=false;attachmentPicker.value='';renderAttachmentTray()}}
attachmentPicker.onchange=()=>uploadFiles([...attachmentPicker.files]);$('#chat-input').addEventListener('paste',e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();uploadFiles(files)}});const dropTarget=$('#chat-form');dropTarget.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();dropTarget.classList.add('attachment-dragover')}});dropTarget.addEventListener('dragleave',e=>{if(!dropTarget.contains(e.relatedTarget))dropTarget.classList.remove('attachment-dragover')});dropTarget.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();dropTarget.classList.remove('attachment-dragover');uploadFiles([...e.dataTransfer.files])}});
function beginAttachmentSend(sid){sendingAttachments={sid,items:pendingAttachments.slice()};attachmentDrafts.set(sid,pendingAttachments.slice());const draft=state.messages.at(-1);if(draft?.role==='user')draft.attachments=JSON.stringify(pendingAttachments.map(a=>a.id));renderAttachmentTray()}
function attachmentOptions(sid){return {attachments:sendingAttachments?.sid===sid?sendingAttachments.items.map(a=>a.id):[]}}
function finishAttachmentSend(sid,succeeded){
    if(sendingAttachments?.sid===sid){
        if(succeeded){
            const ids=new Set(sendingAttachments.items.map(item=>item.id));
            const remaining=(attachmentDrafts.get(sid)||[]).filter(item=>!ids.has(item.id));
            attachmentDrafts.set(sid,remaining);
            if(state.session?.id===sid)pendingAttachments=pendingAttachments.filter(item=>!ids.has(item.id));
        }
        sendingAttachments=null;
    }
    setTimeout(renderAttachmentTray,0);
}
const attachmentMetaCache=new Map();async function fetchAttachmentMeta(id){if(!attachmentMetaCache.has(id))attachmentMetaCache.set(id,api('/api/attachments/'+id).catch(()=>null));return attachmentMetaCache.get(id)}
const previousIdentityRenderMessages=renderMessages;renderMessages=function(){previousIdentityRenderMessages();const articles=$$('#messages .message');state.messages.forEach((message,index)=>{const article=articles[index];if(!article)return;if(message.role==='assistant'){const header=article.querySelector('.message-header');const model=message.model;if(header&&model){const badge=elem('span','message-model-name',model);badge.prepend(modelLogo(model));header.append(badge)}}let ids=[];try{ids=Array.isArray(message.attachments)?message.attachments:JSON.parse(message.attachments||'[]')}catch(e){}if(!ids.length)return;const tray=elem('div','message-attachments');article.prepend(tray);for(const id of ids){const staged=pendingAttachments.find(a=>a.id===id);if(staged)tray.append(attachmentCard(staged,false));else fetchAttachmentMeta(id).then(item=>{if(item&&tray.isConnected)tray.append(attachmentCard(item,false))})}});decorateModelNames()};renderMessages();
const attachmentDrafts=new Map();
const previousAttachmentOpenSession=openSession;
openSession=async function(session){
    const previous=state.session?.id||'new';
    attachmentDrafts.set(previous,pendingAttachments.slice());
    const freshSession=!state.session&&!attachmentDrafts.has(session.id);
    pendingAttachments=freshSession?pendingAttachments.slice():(attachmentDrafts.get(session.id)||[]).slice();
    attachmentDrafts.set(session.id,pendingAttachments.slice());
    if(freshSession)attachmentDrafts.delete('new');
    await previousAttachmentOpenSession(session);
    renderAttachmentTray();
};
const previousIdentityProviderCards=renderProviderCards;renderProviderCards=function(){previousIdentityProviderCards();for(const card of providerGrid.querySelectorAll('.provider-card')){const name=card.querySelector('strong')?.textContent,row=providerRows.find(p=>p.name===name);if(row){card.querySelector(':scope>.ui-icon')?.remove();ensureModelLogo(card,row.model||row.name)}}};
