// Session-scoped sources and explicitly saved outputs.
const resourceButton=elem('button','resource-toggle');
resourceButton.id='session-resources';
resourceButton.type='button';
resourceButton.title='会话附件';
resourceButton.setAttribute('aria-label','会话附件');
resourceButton.setAttribute('aria-expanded','false');
resourceButton.setAttribute('aria-controls','resource-panel');
resourceButton.append(svgIcon('list'));
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
    button.onclick=safely(()=>{
        closeResources();
        previewResource(item,resourceButton);
    });
    row.append(button);
    if(!item.unavailable){
        const downloadLink=elem('a','resource-download');
        downloadLink.href='/api/attachments/'+item.id+'/content';
        downloadLink.download=item.name;
        downloadLink.setAttribute('aria-label',uiText('下载')+' '+item.name);
        const downloadIcon=svgIcon('download');
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
    if(event.key==='Escape'&&!resourcePanel.hidden){event.preventDefault();closeResources();resourceButton.focus();}
});

function attachmentDownloadId(href){
    let url;
    try{url=new URL(href,location.href);}catch{return;}
    return url.origin===location.origin&&!url.search&&!url.hash
        ? /^\/api\/attachments\/([a-f0-9]{32})\/content$/.exec(url.pathname)?.[1] : undefined;
}

let attachmentSavePending=false;
async function saveNativeAttachment(id,bridge,control){
    if(attachmentSavePending)return;
    attachmentSavePending=true;
    control?.setAttribute('aria-busy','true');
    try{
        if(await bridge.save_attachment(id))toast(uiText('附件已保存'));
    }catch(error){
        toast(error.message||uiText('无法保存附件'));
    }finally{
        attachmentSavePending=false;
        control?.removeAttribute('aria-busy');
    }
}

// Keep real links for the browser; the desktop host uses its native save dialog.
document.addEventListener('click',event=>{
    const link=event.target.closest('a[download][href]');
    const bridge=window.pywebview?.api;
    if(!link||typeof bridge?.save_attachment!=='function')return;
    const id=attachmentDownloadId(link.href);
    if(!id)return;
    event.preventDefault();
    saveNativeAttachment(id,bridge,link);
});

const attachmentWorkspace=$('#app>main');
const attachmentPane=elem('aside','attachment-side-preview');
attachmentPane.id='attachment-side-preview';
attachmentPane.hidden=true;
attachmentPane.setAttribute('aria-label','附件预览');
const attachmentPaneHeading=elem('header');
const attachmentPaneTitle=elem('h2');
attachmentPaneTitle.dataset.i18nIgnore='';
const attachmentPaneActions=elem('div','attachment-preview-actions');
const attachmentPaneBody=elem('div','attachment-preview-body');
attachmentPaneBody.tabIndex=0;
attachmentPaneBody.setAttribute('aria-label','附件内容');
const attachmentPaneClose=actionButton('',()=>closeAttachmentPreview(),'attachment-preview-control');
attachmentPaneClose.title='关闭附件预览';
attachmentPaneClose.setAttribute('aria-label','关闭附件预览');
attachmentPaneClose.append(svgIcon('close'));
attachmentPaneHeading.append(attachmentPaneTitle,attachmentPaneActions);
attachmentPane.append(attachmentPaneHeading,attachmentPaneBody);
attachmentWorkspace.append(attachmentPane);

let attachmentPreviewRequest=0,attachmentPreviewFocus=null,attachmentPreviewContext=null;
function closeAttachmentPreview(restoreFocus=true){
    if(attachmentPane.hidden)return;
    attachmentPreviewRequest++;
    attachmentPane.hidden=true;
    attachmentWorkspace.classList.remove('with-attachment-preview');
    attachmentPaneActions.replaceChildren();
    attachmentPaneBody.replaceChildren();
    if(restoreFocus){
        const target=attachmentPreviewFocus?.getClientRects().length?attachmentPreviewFocus:
            [resourceButton,$('#asset-search'),$('#chat-input')].find(control=>control?.getClientRects().length);
        target?.focus({preventScroll:true});
    }
    attachmentPreviewFocus=attachmentPreviewContext=null;
}

function attachmentViewKey(){
    return appPage==='home'?`${state.mode}:${state.session?.id||''}`:appPage;
}

function syncAttachmentPreview(){
    if(!attachmentPane.hidden&&(!$('#settings').hidden||attachmentPreviewContext!==attachmentViewKey()))closeAttachmentPreview(false);
}

document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||attachmentPane.hidden||
       !resourcePanel.hidden||document.querySelector('dialog[open]'))return;
    event.preventDefault();
    closeAttachmentPreview();
});

async function previewResource(item,source=document.activeElement){
    if(item.unavailable||!/^[a-f0-9]{32}$/.test(item.id))return;
    const ticket=++attachmentPreviewRequest;
    const active=()=>ticket===attachmentPreviewRequest&&!attachmentPane.hidden;
    const path='/api/attachments/'+item.id;
    let name=item.name||uiText('附件预览');
    if(!attachmentPane.contains(source)) attachmentPreviewFocus=source;
    attachmentPreviewContext=attachmentViewKey();
    attachmentPaneTitle.textContent=name;
    attachmentPaneTitle.title=name;
    const save=elem('a','attachment-preview-control');
    save.href=path+'/content';
    save.download=item.name||'';
    save.title='下载原文件';
    save.setAttribute('aria-label','下载原文件');
    save.append(svgIcon('download'));
    attachmentPaneActions.replaceChildren(save,attachmentPaneClose);
    const status=elem('p','attachment-preview-status',uiText('正在加载附件…'));
    status.setAttribute('role','status');
    attachmentPaneBody.replaceChildren(status);
    attachmentPaneBody.scrollTop=0;
    attachmentWorkspace.classList.add('with-attachment-preview');
    attachmentPane.hidden=false;
    attachmentPaneClose.focus({preventScroll:true});
    try{
        if(item.kind==='image'){
            const img=elem('img');
            img.src=save.href;
            img.alt=name;
            await img.decode();
            if(!active())return;
            const edit=actionButton('',()=>openImagePreview([{src:img.src,alt:name}],img.src,img),'attachment-preview-control');
            edit.title='在图像工作台打开';
            edit.setAttribute('aria-label','在图像工作台打开');
            edit.append(svgIcon('image'));
            attachmentPaneActions.prepend(edit);
            attachmentPaneBody.replaceChildren(img);
            return;
        }
        const result=await api(path+'/preview');
        if(!active())return;
        name=result.name||name;
        attachmentPaneTitle.textContent=attachmentPaneTitle.title=name;
        if(result.text?.trim()){
            const content=/\.md$/i.test(name)?markdown(result.text):elem('pre','',result.text);
            content.dataset.i18nIgnore='';
            attachmentPaneBody.replaceChildren(content);
        }else if(result.kind==='pdf'){
            status.textContent=uiText('此 PDF 没有可预览的文字。');
        }else status.textContent=uiText('附件没有可预览的内容。');
    }catch(error){
        if(active())status.textContent=uiText('无法预览附件。请重试，或下载原文件。');
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
updateHeader=function(){beforeResourceHeader();syncAttachmentPreview();scheduleSessionResources();};
const beforeResourceTray=renderAttachmentTray;
renderAttachmentTray=function(){beforeResourceTray();if(!resourcePanel.hidden)renderResources();};
syncSessionResources();
