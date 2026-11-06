// Press-to-talk input. Transcription always remains an editable draft.
const sttForm=elem('form','settings-group');
sttForm.id='stt-form';
sttForm.append(elem('h3','','语音输入 STT'),elem('p','hint','按住空白输入框的麦克风录音，松开后转写。音频将发送到配置的 STT 服务，最长 2 分钟、最多 5 MB。'));
const sttFields={};
for(const [key,label,type] of [['base_url','STT Base URL','url'],['api_key','STT API Key','password'],['model','STT 模型','text'],['language','语言代码（留空自动识别）','text']]){
    const item=field(label,'stt-'+key,type);
    sttFields[key]=item.input;
    if(type==='password')item.input.autocomplete='new-password';
    sttForm.append(item.label);
}
const sttClear=elem('input');
sttClear.type='checkbox';sttClear.id='stt-clear-key';sttClear.setAttribute('role','switch');
const sttClearLabel=elem('label','toggle-line');
sttClearLabel.append(sttClear,document.createTextNode('清除已保存的 STT 密钥'));
const sttHint=elem('p','hint');
const sttSave=elem('button','primary','保存 STT 配置');
sttSave.type='submit';
sttForm.append(sttClearLabel,sttHint,sttSave);
voicePanel.querySelector('.dialog-intro').textContent='配置语音输入与朗读服务。录音用于转写，朗读使用所选消息。';
voiceForm.prepend(elem('h3','','语音朗读 TTS'));
voicePanel.insertBefore(sttForm,voiceForm);
let sttSettings={};
function drawSTTSettings(){
    for(const key of ['base_url','model','language'])sttFields[key].value=sttSettings[key]||'';
    sttFields.api_key.value='';sttClear.checked=false;
    sttHint.textContent=uiText(sttSettings.has_key?'密钥已保存，留空保留':'本地服务可不填写密钥');
}
async function loadSTTSettings(){sttSettings=await api('/api/stt/settings');drawSTTSettings();}
sttForm.onsubmit=safely(async event=>{
    event.preventDefault();sttSave.disabled=true;
    try{
        const body=Object.fromEntries(Object.entries(sttFields).map(([key,input])=>[key,input.value.trim()]));
        sttSettings=await api('/api/stt/settings','PUT',{...body,clear_key:sttClear.checked});
        drawSTTSettings();toast('STT 配置已保存');
    }finally{sttSave.disabled=false;}
});
loadSTTSettings().catch(error=>{sttHint.textContent=error.message;});

const speechInput=$('#chat-input'),speechButton=$('#send');
const voiceStatus=elem('div','voice-input-status');
voiceStatus.id='voice-input-status';voiceStatus.hidden=true;voiceStatus.setAttribute('role','status');
const voiceLabel=elem('span');
const voiceInsert=actionButton('插入转写文本',()=>insertVoiceDraft(),'secondary');
voiceInsert.hidden=true;
voiceStatus.append(voiceLabel,voiceInsert);$('#chat-form').prepend(voiceStatus);
let voiceRun=null,voiceDraft=null,voiceStatusTimer=0,voiceIgnoreClick=false;
const voiceMicPath='M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1M12 18v4m-4 0h8';
const voiceSendPath='M12 20V4m-6 6 6-6 6 6';
function voiceSendable(){return !!speechInput.value.trim()||pendingAttachments.length>0;}
function voiceMessage(text){
    clearTimeout(voiceStatusTimer);voiceLabel.textContent=uiText(text);voiceStatus.hidden=!text;
}
function syncVoiceButton(){
    if(voiceRun&&(state.mode!=='chat'||!$('#settings').hidden))cancelVoice();
    const sendable=voiceSendable();
    const mode=voiceRun?'recording':sendable?'send':'mic';
    if(speechButton.dataset.voiceMode!==mode){
        speechButton.dataset.voiceMode=mode;
        const icon=svgIcon('note');
        icon.querySelector('path').setAttribute('d',mode==='send'?voiceSendPath:voiceMicPath);
        speechButton.replaceChildren(icon);
    }
    speechButton.type=sendable&&!voiceRun?'submit':'button';
    const label=voiceRun?voiceRun.phase==='recording'?'松开完成录音':'正在处理语音…':sendable?'发送':'按住说话';
    speechButton.setAttribute('aria-label',uiText(label));speechButton.title=uiText(label);
    speechButton.setAttribute('aria-pressed',String(voiceRun?.phase==='recording'));
    speechButton.classList.toggle('voice-recording',voiceRun?.phase==='recording');
    const disabled=uploadBusy||submitting||voiceRun?.phase==='transcribing';
    if(speechButton.disabled!==!!disabled)speechButton.disabled=!!disabled;
}
function stopVoiceTracks(run){
    clearTimeout(run.timer);
    run.stream?.getTracks().forEach(track=>track.stop());
}
function cancelVoice(){
    const run=voiceRun;
    voiceRun=null;voiceDraft=null;voiceInsert.hidden=true;voiceMessage('');
    if(run){
        voiceIgnoreClick=true;
        run.cancelled=true;run.controller?.abort();
        if(run.recorder?.state==='recording')run.recorder.stop();
        stopVoiceTracks(run);
    }
    syncVoiceButton();
}
async function beginVoice(pointerId=null){
    if(voiceRun||voiceSendable()||submitting||uploadBusy)return;
    if(!sttSettings.base_url||!sttSettings.model){showSettings();selectSettingsTab('voice');sttFields.base_url.focus();toast('请先配置 STT 接口');return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('当前环境不支持录音，请使用支持麦克风的浏览器或桌面运行时');return;}
    voiceDraft=null;voiceInsert.hidden=true;
    const run={session:state.session?.id||null,initial:speechInput.value,phase:'requesting',pointerId,chunks:[],bytes:0,cancelled:false};
    voiceRun=run;voiceIgnoreClick=true;voiceMessage('正在请求麦克风权限…');syncVoiceButton();
    try{
        run.stream=await navigator.mediaDevices.getUserMedia({audio:true});
        if(run.cancelled||voiceRun!==run){stopVoiceTracks(run);return;}
        const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(value=>MediaRecorder.isTypeSupported(value));
        if(!mime)throw Error(uiText('当前录音格式不受 STT 支持'));
        run.recorder=new MediaRecorder(run.stream,{mimeType:mime,audioBitsPerSecond:64000});
        run.recorder.ondataavailable=event=>{
            if(run.cancelled||!event.data.size)return;
            run.bytes+=event.data.size;
            if(run.bytes>5*1024*1024){cancelVoice();toast('录音超过 5 MB，请缩短后重试');return;}
            run.chunks.push(event.data);
        };
        run.recorder.onerror=()=>{if(voiceRun===run){cancelVoice();toast('录音失败，请检查麦克风');}};
        run.recorder.onstop=()=>{
            if(!run.cancelled&&voiceRun===run&&run.phase==='recording'){cancelVoice();toast('录音已中断，请重试');return;}
            transcribeVoice(run);
        };
        run.recorder.start(250);run.phase='recording';
        run.timer=setTimeout(releaseVoice,120000);
        voiceMessage('正在录音，松开转写 · Esc 取消');syncVoiceButton();
    }catch(error){
        stopVoiceTracks(run);
        if(voiceRun===run){voiceRun=null;voiceMessage('');syncVoiceButton();toast(error.name==='NotAllowedError'?'麦克风访问被拒绝，请检查浏览器与系统权限':error.message);}
    }
}
function releaseVoice(){
    const run=voiceRun;if(!run)return;
    // A touch browser may dispatch its compatibility click after transcription.
    // Consume that click, or reset at the next deliberate press.
    voiceIgnoreClick=true;
    if(run.phase==='requesting'){cancelVoice();return;}
    if(run.phase!=='recording')return;
    run.phase='stopping';clearTimeout(run.timer);run.recorder.stop();stopVoiceTracks(run);
    voiceMessage('正在转写…');syncVoiceButton();
}
async function transcribeVoice(run){
    stopVoiceTracks(run);
    if(run.cancelled||voiceRun!==run)return;
    if(!run.bytes){voiceRun=null;voiceMessage('');syncVoiceButton();toast('录音为空，请按住说话后再松开');return;}
    run.phase='transcribing';run.controller=new AbortController();syncVoiceButton();
    try{
        const blob=new Blob(run.chunks,{type:run.recorder.mimeType});
        const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
        if(run.cancelled||voiceRun!==run)return;
        const response=await fetch('/api/stt',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':state.token},body:JSON.stringify({data:encoded,mime:run.recorder.mimeType}),signal:run.controller.signal});
        const result=await response.json();
        if(!response.ok)throw Error(result.error||uiText('语音转写失败'));
        if(run.cancelled||voiceRun!==run||(state.session?.id||null)!==run.session)return;
        if(typeof result.text!=='string'||!result.text.trim()||result.text.length>32000)throw Error(uiText('语音转写未返回有效文字'));
        voiceRun=null;
        if(speechInput.value===run.initial){
            speechInput.value=result.text;speechInput.dispatchEvent(new Event('input',{bubbles:true}));speechInput.focus();
            voiceMessage('转写完成，可编辑后发送');voiceStatusTimer=setTimeout(()=>voiceMessage(''),4000);
        }else{
            voiceDraft={session:run.session,text:result.text};voiceInsert.hidden=false;
            voiceMessage('草稿已变化，点击插入转写文本');
        }
    }catch(error){
        if(!run.cancelled&&voiceRun===run){voiceRun=null;voiceMessage('');toast(error.message);}
    }finally{syncVoiceButton();}
}
function insertVoiceDraft(){
    if(!voiceDraft||voiceDraft.session!==(state.session?.id||null))return;
    const text=[speechInput.value.trimEnd(),voiceDraft.text].filter(Boolean).join('\n');
    if(text.length>32000){toast('合并后的输入超过 32000 字符');return;}
    speechInput.value=text;voiceDraft=null;voiceInsert.hidden=true;voiceMessage('');
    speechInput.dispatchEvent(new Event('input',{bubbles:true}));speechInput.focus();
}
speechButton.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    voiceIgnoreClick=false;
    if(voiceSendable()||speechButton.disabled)return;
    event.preventDefault();speechButton.setPointerCapture(event.pointerId);beginVoice(event.pointerId);
});
window.addEventListener('pointerup',event=>{if(voiceRun?.pointerId===event.pointerId)releaseVoice();});
speechButton.addEventListener('pointercancel',cancelVoice);
speechButton.addEventListener('lostpointercapture',()=>{if(['recording','requesting'].includes(voiceRun?.phase))cancelVoice();});
speechButton.addEventListener('click',event=>{
    if(voiceRun||voiceIgnoreClick||!voiceSendable()){voiceIgnoreClick=false;event.preventDefault();event.stopImmediatePropagation();}
},true);
speechButton.addEventListener('keydown',event=>{
    if(voiceSendable()&&!voiceRun)voiceIgnoreClick=false;
    if(![' ','Enter'].includes(event.key)||voiceSendable())return;
    event.preventDefault();if(!event.repeat)beginVoice();
});
window.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)&&voiceRun?.pointerId===null){event.preventDefault();releaseVoice();}});
$('#chat-form').addEventListener('submit',event=>{if(voiceRun){event.preventDefault();event.stopImmediatePropagation();}},true);
speechInput.addEventListener('input',syncVoiceButton);
document.addEventListener('click',()=>queueMicrotask(syncVoiceButton));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&voiceRun){event.preventDefault();cancelVoice();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelVoice();});
window.addEventListener('blur',()=>{if(['recording','requesting'].includes(voiceRun?.phase))cancelVoice();});
window.addEventListener('pagehide',cancelVoice);
const beforeVoiceOpenSession=openSession;
openSession=async function(session){cancelVoice();return beforeVoiceOpenSession(session);};
const beforeVoiceHeader=updateHeader;
updateHeader=function(){beforeVoiceHeader();syncVoiceButton();};
const beforeVoiceTray=renderAttachmentTray;
renderAttachmentTray=function(){beforeVoiceTray();syncVoiceButton();};
new MutationObserver(syncVoiceButton).observe(speechButton,{attributes:true,attributeFilter:['disabled','hidden']});
syncVoiceButton();
sttFields.model.addEventListener('input',decorateModelNames);
decorateModelNames();
