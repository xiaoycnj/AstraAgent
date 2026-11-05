function colorIcon(name){const img=elem('img','color-icon');img.src='/assets/icons/library/'+name+'.svg';img.alt='';img.width=32;img.height=32;return img;}
function decoratePluginIcons(){
    for(const [index,card] of [...pluginList.children].entries()){
        const plugin=capabilityCatalog.plugins[index];
        if(plugin&&!card.querySelector('.color-icon'))card.prepend(colorIcon(plugin.id));
    }
}
new MutationObserver(decoratePluginIcons).observe(pluginList,{childList:true});
decoratePluginIcons();
const hubIconNames={goal:'goals',task:'task-board',tree:'world-tree',note:'notebook',decision:'decision-log',jobs:'agent-dispatch',browser:'research-browser'};
for(const button of hubTabs.children)button.prepend(colorIcon(hubIconNames[button.dataset.hubTab]));
const iconPanel=settingPanel('icons','图标库','48 枚原创彩色 SVG，点击即可复制源码。');
const iconNav=elem('button');iconNav.type='button';iconNav.dataset.settingsTab='icons';iconNav.append(svgIcon('sun'),elem('span','','图标库'));settingsNav.insertBefore(iconNav,$('[data-settings-tab=instructions]'));iconNav.onclick=()=>selectSettingsTab('icons');
const iconGrid=elem('div','icon-library-grid');iconPanel.append(iconGrid);let loadedIconLibrary=false;
async function loadIconLibrary(){
    if(loadedIconLibrary)return;
    const names=await (await fetch('/assets/icons/library/catalog.json')).json();
    iconGrid.replaceChildren();
    for(const name of names){const button=elem('button','icon-library-item');button.type='button';button.append(colorIcon(name),elem('span','',name));button.title='复制 '+name+' SVG';button.onclick=safely(async()=>{const svg=await (await fetch('/assets/icons/library/'+name+'.svg')).text();await navigator.clipboard.writeText(svg);toast('SVG 已复制');});iconGrid.append(button);}
    loadedIconLibrary=true;
}
const previousIconSettingsTab=selectSettingsTab;
selectSettingsTab=function(name){previousIconSettingsTab(name);$('#settings').scrollTop=0;$('#settings').scrollLeft=0;$('.settings-shell').scrollTop=0;$('.settings-shell').scrollLeft=0;if(name==='icons')loadIconLibrary().catch(error=>toast(error.message));};
// Local image lightbox, shared by drafts and saved attachments.
const imageViewer=elem('dialog','image-viewer');
const imageToolbar=elem('div','image-viewer-toolbar');
const imageCaption=elem('span','image-viewer-caption');
const imageStage=elem('div','image-viewer-stage');
const fullImage=elem('img');fullImage.alt='图片预览';imageStage.append(fullImage);
let imageScale=1,imageRotation=0,imageIndex=0,imageGallery=[];
function updateImageTransform(){fullImage.style.transform=`scale(${imageScale}) rotate(${imageRotation}deg)`;}
function showGalleryImage(index){
    imageIndex=(index+imageGallery.length)%imageGallery.length;
    const item=imageGallery[imageIndex];fullImage.src=item.src;fullImage.alt=item.alt||'图片预览';imageCaption.textContent=`${imageIndex+1} / ${imageGallery.length} · ${fullImage.alt}`;imageScale=1;imageRotation=0;updateImageTransform();
}
for(const [label,icon,action] of [
    ['上一张','chevron',()=>showGalleryImage(imageIndex-1)],
    ['下一张','chevron',()=>showGalleryImage(imageIndex+1)],
    ['缩小','minus',()=>{imageScale=Math.max(.25,imageScale-.25);updateImageTransform();}],
    ['放大','plus',()=>{imageScale=Math.min(5,imageScale+.25);updateImageTransform();}],
    ['适应窗口','image',()=>{imageScale=1;imageRotation=0;updateImageTransform();}],
    ['旋转','refresh',()=>{imageRotation+=90;updateImageTransform();}],
    ['下载图片','download',()=>{const link=document.createElement('a');link.href=fullImage.src;link.download=fullImage.alt;link.click();}],
    ['关闭预览','close',()=>imageViewer.close()]
]){const button=actionButton(label,action,'secondary');button.setAttribute('aria-label',label);imageToolbar.append(button);}
imageViewer.append(imageToolbar,imageCaption,imageStage);document.body.append(imageViewer);
document.addEventListener('click',event=>{
    const image=event.target.closest('.attachment-card img,.markdown img,.file-preview img');
    if(!image)return;
    event.preventDefault();
    imageGallery=[...document.querySelectorAll('.attachment-card img,.markdown img,.file-preview img')].filter(item=>item.getClientRects().length).map(item=>({src:item.src,alt:item.alt}));
    const index=imageGallery.findIndex(item=>item.src===image.src);if(index<0)return;
    showGalleryImage(index);imageViewer.showModal();
});
imageViewer.addEventListener('keydown',event=>{if(event.key==='ArrowLeft')showGalleryImage(imageIndex-1);if(event.key==='ArrowRight')showGalleryImage(imageIndex+1);});
imageStage.addEventListener('wheel',event=>{event.preventDefault();imageScale=Math.max(.25,Math.min(5,imageScale+(event.deltaY<0?.15:-.15)));updateImageTransform();},{passive:false});
// Search sessions in the sidebar without changing the project filter.
const sessionSearch=elem('input');sessionSearch.type='search';sessionSearch.placeholder='搜索会话';sessionSearch.setAttribute('aria-label','搜索会话');listFilters.prepend(sessionSearch);
const previousSearchRenderList=renderList;
renderList=function(){
    previousSearchRenderList();const query=sessionSearch.value.trim().toLowerCase();
    if(!query||state.mode!=='chat')return;
    for(const row of $$('.session-list-row'))row.hidden=!row.querySelector('.list-item span')?.textContent.toLowerCase().includes(query);
    for(const title of $$('.session-group-title')){let row=title.nextElementSibling,visible=false;while(row&&!row.classList.contains('session-group-title')){if(row.classList.contains('session-list-row')&&!row.hidden)visible=true;row=row.nextElementSibling;}title.hidden=!visible;}
};
sessionSearch.oninput=renderList;
const previousBranchMessageMore=showMessageMore;
showMessageMore=function(message){
    previousBranchMessageMore(message);const sourceSession=state.session?.id;
    const branch=actionButton('从此消息创建分支',async()=>{messageMore.close();const session=await api('/api/sessions/'+sourceSession+'/branch','POST',{through_id:message.id});await openSession(session);await refreshList();},'secondary');
    moreActions.prepend(branch);
    if(message.role==='assistant'){
        const index=state.messages.findIndex(item=>item.id===message.id);
        const prompt=state.messages.slice(0,index).reverse().find(item=>item.role==='user'&&item.id);
        if(prompt)moreActions.prepend(actionButton('重新生成（新分支）',async()=>{
            messageMore.close();const session=await api('/api/sessions/'+sourceSession+'/branch','POST',{before_id:prompt.id});await openSession(session);await refreshList();
            let ids=[];try{ids=JSON.parse(prompt.attachments||'[]');}catch(error){}
            pendingAttachments=(await Promise.all(ids.map(fetchAttachmentMeta))).filter(Boolean);renderAttachmentTray();
            $('#chat-input').value=prompt.content;if(state.reviewMode)$('#review-toggle').click();$('#chat-form').requestSubmit();
        },'secondary'));
    }
};
renderList();
