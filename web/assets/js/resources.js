// Session-scoped sources and explicitly saved outputs.
const resourceButton=elem('button','resource-toggle');
resourceButton.id='session-resources';
resourceButton.type='button';
resourceButton.title='会话附件';
resourceButton.setAttribute('aria-label','会话附件');
resourceButton.setAttribute('aria-expanded','false');
resourceButton.setAttribute('aria-controls','resource-panel');
const resourceIcon=svgIcon('note');
resourceIcon.querySelector('path').setAttribute('d','M8 5h12M8 12h12M8 19h12M3 4h2v2H3zM3 11h2v2H3zM3 18h2v2H3z');
resourceButton.append(resourceIcon);
$('.header-actions').append(resourceButton);
const resourcePanel=elem('section','resource-panel');
resourcePanel.id='resource-panel';
resourcePanel.hidden=true;
resourcePanel.setAttribute('aria-label','会话附件');
$('.topbar').append(resourcePanel);
let resourceData={sources:[],outputs:[]};
let resourceSession=null,resourceRequest=0,resourceFrame=0,resourceSignature='';

function closeResources(){
    resourcePanel.hidden=true;
    resourceButton.setAttribute('aria-expanded','false');
}

async function refreshResources(){
    const sid=state.session?.id;
    if(!sid||state.mode!=='chat')return;
    const ticket=++resourceRequest;
    if(resourceSession!==sid){
        resourceSession=sid;
        resourceData={sources:[],outputs:[]};
        resourcePanel.replaceChildren(elem('p','hint','正在加载附件…'));
    }
    try{
        const data=await api('/api/sessions/'+sid+'/resources');
        if(ticket!==resourceRequest||state.session?.id!==sid)return;
        resourceData=data;
        renderResources();
    }catch(error){
        if(ticket===resourceRequest&&state.session?.id===sid)resourcePanel.replaceChildren(elem('p','hint',error.message));
    }
}

function resourceSources(){
    const saved=resourceSession===state.session?.id?resourceData.sources:[];
    const ids=new Set(saved.map(item=>item.id));
    const staged=sendingAttachments&&sendingAttachments.sid!==state.session?.id?[]:pendingAttachments;
    return [...saved,...staged.filter(item=>!ids.has(item.id)).map(item=>({...item,staged:true}))];
}

function resourceRow(item){
    const row=elem('div','resource-row');
    row.dataset.attachmentId=item.id;
    const button=elem('button','resource-file');
    button.type='button';
    button.disabled=!!item.unavailable;
    const icon=svgIcon(item.kind==='image'?'image':'note');
    icon.classList.add(item.kind==='image'?'resource-image-icon':'resource-document-icon');
    const label=elem('span','',item.name);
    label.dataset.i18nIgnore='';
    button.append(icon,label);
    button.title=item.name;
    if(item.staged)button.append(elem('small','','待发送'));
    button.onclick=safely(()=>previewResource(item));
    row.append(button);
    if(!item.unavailable){
        const downloadLink=elem('a','resource-download');
        downloadLink.href='/api/attachments/'+item.id+'/content';
        downloadLink.download=item.name;
        downloadLink.setAttribute('aria-label',uiText('下载')+' '+item.name);
        const downloadIcon=svgIcon('note');
        downloadIcon.querySelector('path').setAttribute('d','M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4');
        downloadLink.append(downloadIcon);
        row.append(downloadLink);
    }
    return row;
}

function renderResources(){
    if(resourceSession!==state.session?.id)return;
    resourcePanel.replaceChildren();
    for(const [title,items,add,empty] of [
        ['输出',resourceData.outputs,openOutputEditor,'创建输出内容'],
        ['来源',resourceSources(),()=>attachmentPicker.click(),'添加图片或文档'],
    ]){
        const section=elem('div','resource-section');
        const head=elem('div','resource-heading');
        const plus=actionButton('',add,'resource-plus');
        plus.type='button';
        plus.setAttribute('aria-label',uiText(title==='输出'?'新建输出':'添加来源'));
        plus.append(svgIcon('plus'));
        head.append(elem('span','',title),plus);
        section.append(head);
        if(items.length)section.append(...items.map(resourceRow));
        else{
            const create=actionButton(empty,add,'resource-empty');
            create.type='button';
            section.append(create);
        }
        resourcePanel.append(section);
    }
}

resourceButton.onclick=async()=>{
    if(!resourcePanel.hidden){closeResources();return;}
    resourcePanel.hidden=false;
    resourceButton.setAttribute('aria-expanded','true');
    await refreshResources();
};
document.addEventListener('click',event=>{
    if(event.target===attachmentPicker)return;
    if(!resourcePanel.contains(event.target)&&!resourceButton.contains(event.target))closeResources();
});
document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!resourcePanel.hidden){closeResources();resourceButton.focus();}
});

const resourcePreview=elem('dialog','resource-preview');
const resourcePreviewHead=elem('header');
const resourcePreviewTitle=elem('strong');
resourcePreviewTitle.dataset.i18nIgnore='';
const resourcePreviewBody=elem('div','resource-preview-body');
const resourcePreviewClose=actionButton('关闭',()=>resourcePreview.close(),'secondary');
resourcePreviewHead.append(resourcePreviewTitle,resourcePreviewClose);
resourcePreview.append(resourcePreviewHead,resourcePreviewBody);
document.body.append(resourcePreview);
let resourcePreviewRequest=0;
resourcePreview.addEventListener('close',()=>resourcePreviewRequest++);

async function previewResource(item){
    if(item.kind==='image'){
        imageGallery=[...resourceSources(),...resourceData.outputs].filter(row=>row.kind==='image').map(row=>({src:'/api/attachments/'+row.id+'/content',alt:row.name}));
        showGalleryImage(imageGallery.findIndex(row=>row.src.endsWith('/'+item.id+'/content')));
        imageViewer.showModal();
        return;
    }
    const ticket=++resourcePreviewRequest;
    resourcePreviewTitle.textContent=item.name;
    resourcePreviewBody.textContent=uiText('正在加载附件…');
    if(!resourcePreview.open)resourcePreview.showModal();
    try{
        const result=await api('/api/attachments/'+item.id+'/preview');
        if(ticket!==resourcePreviewRequest||!resourcePreview.open)return;
        const content=item.name.toLowerCase().endsWith('.md')?markdown(result.text):elem('pre','',result.text);
        content.dataset.i18nIgnore='';
        resourcePreviewBody.replaceChildren(content);
    }catch(error){
        if(ticket===resourcePreviewRequest)resourcePreviewBody.textContent=error.message;
    }
}

const outputEditor=elem('dialog','output-editor');
const outputForm=elem('form');
const outputName=elem('input');
outputName.placeholder='输出名称';
outputName.maxLength=190;
outputName.required=true;
outputName.setAttribute('aria-label','输出名称');
const outputContent=elem('textarea');
outputContent.placeholder='写下要保存的输出内容…';
outputContent.maxLength=60000;
outputContent.required=true;
outputContent.setAttribute('aria-label','输出正文');
const outputFooter=elem('footer');
const outputCancel=actionButton('取消',()=>outputEditor.close(),'secondary');
outputCancel.type='button';
const outputSave=elem('button','primary','保存输出');
outputSave.type='submit';
outputFooter.append(outputCancel,outputSave);
outputForm.append(elem('h3','','新建输出'),outputName,outputContent,outputFooter);
outputEditor.append(outputForm);
document.body.append(outputEditor);
let outputSession=null;
function openOutputEditor(){
    outputSession=state.session?.id;
    if(!outputSession)return;
    outputName.value='';
    outputContent.value='';
    outputEditor.showModal();
}
outputForm.onsubmit=safely(async event=>{
    event.preventDefault();
    outputSave.disabled=true;
    try{
        await api('/api/sessions/'+outputSession+'/resources','POST',{name:outputName.value,content:outputContent.value});
        outputEditor.close();
        toast('已保存到会话输出');
        await refreshResources();
    }finally{outputSave.disabled=false;}
});

function syncSessionResources(){
    resourceFrame=0;
    resourceButton.hidden=state.mode!=='chat'||!state.session||!$('#settings').hidden;
    if(resourceButton.hidden){closeResources();return;}
    const articles=conversationList.querySelectorAll(':scope>.message');
    for(const [index,message] of state.messages.entries()){
        if(message.role!=='assistant'||!message.id||message.streaming)continue;
        const bar=articles[index]?.querySelector('.message-actions');
        if(!bar||bar.querySelector('.save-output'))continue;
        const sid=state.session.id;
        const save=actionButton('',async()=>{
            await api('/api/sessions/'+sid+'/resources','POST',{message_id:message.id});
            toast('已保存到会话输出');
            await refreshResources();
        },'save-output');
        save.title='保存为输出';
        save.setAttribute('aria-label','保存为输出');
        save.append(svgIcon('note'));
        bar.append(save);
    }
    const signature=state.session.id+':'+state.messages.map(message=>message.id||'draft').join(',');
    if(!resourcePanel.hidden&&signature!==resourceSignature){
        resourceSignature=signature;
        refreshResources();
    }
}
function scheduleSessionResources(){
    if(!resourceFrame)resourceFrame=requestAnimationFrame(syncSessionResources);
}
new MutationObserver(scheduleSessionResources).observe(conversationList,{childList:true});
const beforeResourceHeader=updateHeader;
updateHeader=function(){beforeResourceHeader();scheduleSessionResources();};
const beforeResourceTray=renderAttachmentTray;
renderAttachmentTray=function(){beforeResourceTray();if(!resourcePanel.hidden)renderResources();};
syncSessionResources();
