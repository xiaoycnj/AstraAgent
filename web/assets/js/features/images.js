// Provider type is persisted alongside existing encrypted credentials.
const imageProviderType=elem('select');imageProviderType.id='provider-type';imageProviderType.setAttribute('aria-label','服务商类型');
imageProviderType.append(new Option('聊天模型 · chat_api','chat_api'),new Option('图片生成 · image_api','image_api'));
const imageProviderField=elem('label','input-row');imageProviderField.append(elem('span','','服务商类型'),imageProviderType,elem('small','hint','图片接口使用 /images/generations，生成结果保存至当前会话。'));
$('#provider-name').closest('.input-row').after(imageProviderField);
const beforeImageConfig=configForm;configForm=function(){return {...beforeImageConfig(),type:providerMode==='default'?'chat_api':imageProviderType.value}};
const beforeImageExpand=expandProvider;expandProvider=function(id,source,mode){beforeImageExpand(id,source,mode);imageProviderType.value=providerRows.find(row=>row.id===id)?.type||'chat_api';imageProviderType._refresh?.();imageProviderField.hidden=providerMode==='default'};
const beforeImageProviderChange=$('#provider-edit').onchange;$('#provider-edit').onchange=function(...args){const result=beforeImageProviderChange?.apply(this,args);imageProviderType.value=providerRows.find(row=>row.id===this.value)?.type||'chat_api';return result};
imageProviderType.addEventListener('change',()=>{settingsDirty=true});
function previewGeneratedImage(item,source){
 const collection=typeof libraryAssets!=='undefined'&&['library','images'].includes(appPage)?libraryAssets:[item];
 const active=imagePreviewAsset(item);
 openImagePreview([active,...collection.filter(row=>row.kind==='image').map(imagePreviewAsset)],active.src,source);
}
const beforeImageEvent=handleAgentEvent;handleAgentEvent=function(sid,event){beforeImageEvent(sid,event);if(['image_generated','file_generated'].includes(event.type)){toast(event.type==='image_generated'?'图片已生成并保存到会话产物':'文件已保存到会话产物');if(sid===state.session?.id&&typeof refreshResources==='function')refreshResources()}};

buildSelect(imageProviderType);

const inlineImageTools=new Set(['generate_image','image_gen']);
const inlineImageId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const inlineImageSrc=id=>`/api/attachments/${id}/content`;
function updateInlineImageRun(draft,event){
 const pending=draft.imagePending;
 if(['done','error','cancelled'].includes(event.type)){
  const ids=Array.isArray(event.generated_attachment_ids)?event.generated_attachment_ids.filter(inlineImageId):[];
  if(ids.length)draft.generated_attachment_ids=[...new Set(ids)];
  if(pending?.size)pending.clear();
  return Boolean(pending)||ids.length>0;
 }
 if(!inlineImageTools.has(event.name))return false;
 const key=JSON.stringify([event.run_id??null,event.tool_call_id??event.name]);
 if(event.type==='tool_start'){
  (draft.imagePending??=new Set()).add(key);return true;
 }
 if(!['tool','step_reused'].includes(event.type))return false;
 pending?.delete(key);
 const result=event.result;
 const ids=Array.isArray(event.generated_attachment_ids)?event.generated_attachment_ids:
  result?.ok&&result.attachment?.kind==='image'?[result.attachment.id]:[];
 draft.generated_attachment_ids=[...new Set([...(draft.generated_attachment_ids||[]),...ids.filter(inlineImageId)])];
 return true;
}

const inlineImageViews=new WeakMap();
function buildInlineImagePlaceholder(){
 const node=elem('div','image-generation-placeholder');
 const particles=elem('div','image-generation-particles');particles.setAttribute('aria-hidden','true');
 for(let i=0;i<81;i++){
  const particle=elem('i');particle.style.setProperty('--phase',`${-((i%9)*.105+Math.floor(i/9)*.155)}s`);
  particle.style.setProperty('--drift',`${((i%9)-4)*.8}px`);particles.append(particle);
 }
 const badge=elem('span','image-generation-label','正在生成图片');badge.setAttribute('role','status');
 node.append(particles,badge);return node;
}
function buildInlineImageGallery(ids,selected){
 const gallery=elem('section','image-candidates');gallery.setAttribute('aria-label',ids.length>1?'生成图片候选':'生成图片');
 const preview=elem('button','image-candidate-preview');preview.type='button';
 const image=elem('img');image.decoding='async';preview.append(image);
 const rail=elem('div','image-candidate-rail');rail.setAttribute('role','group');rail.setAttribute('aria-label','按生成顺序浏览候选图');
 const footer=elem('div','image-candidate-footer');
 const count=elem('span');const download=elem('a','','下载图片');download.download='';footer.append(count,download);
 const assets=ids.map((id,i)=>({src:inlineImageSrc(id),alt:`生成图片 ${i+1}`}));
 let current=Math.max(0,ids.indexOf(selected));
 const thumbs=assets.map((asset,i)=>{
  const thumb=elem('button','image-candidate-thumb');thumb.type='button';
  thumb.setAttribute('aria-label',`第 ${i+1} 张候选图，共 ${ids.length} 张`);
  const thumbnail=elem('img');thumbnail.src=asset.src;thumbnail.alt='';thumbnail.loading='lazy';thumbnail.decoding='async';
  thumb.append(thumbnail,elem('span','image-candidate-number',String(i+1)));
  thumb.onclick=()=>select(i);
  thumb.onkeydown=event=>{
   const offset={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];
   if(!offset&&event.key!=='Home'&&event.key!=='End')return;
   event.preventDefault();const next=offset?(i+offset+ids.length)%ids.length:event.key==='Home'?0:ids.length-1;
   select(next);thumbs[next].focus();
  };
  rail.append(thumb);return thumb;
 });
 function select(index){
  current=index;const asset=assets[index];gallery.dataset.selected=ids[index];
  image.src=asset.src;image.alt=asset.alt;download.href=asset.src;
  preview.setAttribute('aria-label',`在图像工作台查看第 ${index+1} 张生成图`);
  count.textContent=ids.length>1?`候选 ${index+1} / ${ids.length}`:'生成图片';
  thumbs.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
 }
 preview.onclick=()=>openImagePreview(assets,assets[current].src,image);
 gallery.append(preview);if(ids.length>1)gallery.append(rail);gallery.append(footer);
 select(current);return gallery;
}
function renderInlineImages(article,message){
 const ids=message.role==='assistant'&&Array.isArray(message.generated_attachment_ids)?[...new Set(message.generated_attachment_ids.filter(inlineImageId))]:[];
 const pending=message.role==='assistant'&&message.streaming?message.imagePending?.size||0:0;
 const signature=ids.join(',');
 let view=inlineImageViews.get(article);
 if(!view){if(!ids.length&&!pending)return;view={};inlineImageViews.set(article,view);}
 if(view.signature!==signature){
  const selected=view.gallery?.dataset.selected;view.gallery?.remove();
  view.gallery=ids.length?buildInlineImageGallery(ids,selected):null;
  if(view.gallery)article.append(view.gallery);view.signature=signature;
 }
 if(pending&&!view.placeholder){view.placeholder=buildInlineImagePlaceholder();article.append(view.placeholder);}
 if(pending){const label=view.placeholder.querySelector('.image-generation-label');const text=pending>1?`正在生成 ${pending} 张图片`:'正在生成图片';if(label.textContent!==text)label.textContent=text;}
 else if(view.placeholder){view.placeholder.remove();view.placeholder=null;}
 if(ids.length||view.body){
  const body=article.querySelector(':scope > .markdown');view.body=body;
  for(const image of body?.querySelectorAll('img')||[]){
   const parent=image.parentElement;
   const duplicate=ids.some(id=>image.getAttribute('src')===inlineImageSrc(id));
   const standalone=parent.tagName==='P'&&parent.children.length===1&&!parent.textContent.trim();
   (standalone?parent:image).classList.toggle('image-candidate-duplicate',duplicate);
  }
 }
}
