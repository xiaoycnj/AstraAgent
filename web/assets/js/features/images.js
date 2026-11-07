// Provider type is persisted alongside existing encrypted credentials.
const imageProviderType=elem('select');imageProviderType.id='provider-type';imageProviderType.setAttribute('aria-label','服务商类型');
imageProviderType.append(new Option('聊天模型 · chat_api','chat_api'),new Option('图片生成 · image_api','image_api'));
const imageProviderField=elem('label','input-row');imageProviderField.append(elem('span','','服务商类型'),imageProviderType,elem('small','hint','图片接口使用 /images/generations，生成结果保存至当前会话。'));
$('#provider-name').closest('.input-row').after(imageProviderField);
const beforeImageConfig=configForm;configForm=function(){return {...beforeImageConfig(),type:providerMode==='default'?'chat_api':imageProviderType.value}};
const beforeImageExpand=expandProvider;expandProvider=function(id,source,mode){beforeImageExpand(id,source,mode);imageProviderType.value=providerRows.find(row=>row.id===id)?.type||'chat_api';imageProviderType._refresh?.();imageProviderField.hidden=providerMode==='default'};
const beforeImageProviderChange=$('#provider-edit').onchange;$('#provider-edit').onchange=function(...args){const result=beforeImageProviderChange?.apply(this,args);imageProviderType.value=providerRows.find(row=>row.id===this.value)?.type||'chat_api';return result};
imageProviderType.addEventListener('change',()=>{settingsDirty=true});
function previewGeneratedImage(item){
 const dialog=elem('dialog','generated-image-dialog');const image=elem('img');image.src='/api/attachments/'+item.id+'/content';image.alt=item.name||'生成的图片';
 const close=actionButton('关闭',async()=>dialog.close(),'secondary'),downloadLink=elem('a','secondary','下载图片');downloadLink.href=image.src;downloadLink.download=item.name||'generated.png';dialog.append(image,downloadLink,close);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
}
const beforeImageEvent=handleAgentEvent;handleAgentEvent=function(sid,event){beforeImageEvent(sid,event);if(event.type==='image_generated'){toast('图片已生成并保存到会话产物');if(sid===state.session?.id&&typeof refreshResources==='function')refreshResources()}};

buildSelect(imageProviderType);
