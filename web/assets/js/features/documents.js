const documentDialog=elem('dialog','resource-preview');
const documentTitle=elem('strong');const documentBody=elem('div','resource-preview-body');
const documentHeader=elem('header');documentHeader.append(documentTitle,actionButton('关闭',()=>documentDialog.close(),'secondary'));documentDialog.append(documentHeader,documentBody);document.body.append(documentDialog);
async function showDocumentText(item){
 documentTitle.textContent=item.name;documentBody.textContent='正在加载识别结果…';if(!documentDialog.open)documentDialog.showModal();
 const value=await api('/api/attachments/'+item.id+'/preview');documentBody.replaceChildren();
 if(!value.pages?.length){documentBody.append(elem('pre','',value.text||'尚无识别文本'));return}
 for(const page of value.pages){
  const section=elem('section');section.append(elem('h3','','第 '+page.number+' 页'),elem('pre','',page.lines.map(line=>line.text).join('\n')));
  const details=elem('details');details.append(elem('summary','','文字位置与置信度'));
  for(const line of page.lines)details.append(elem('p','hint',line.text+' · '+Math.round(line.confidence*100)+'% · '+JSON.stringify(line.box)));
  section.append(details);documentBody.append(section);
 }
}
function documentOCRButton(item){
 const button=actionButton(item.ocr_status==='complete'?'识别结果':'识别文字',async()=>{
  if(item.ocr_status==='complete'){await showDocumentText(item);return}
  const status=await api('/api/document/status');
  if(!status.available){showSettings();selectSettingsTab('about');dlcRelease.focus();toast('请先安装文档理解 DLC');return}
  // API state is attached to the source document, so later messages reuse the result.
  button.disabled=true;const label=button.textContent;button.textContent='正在识别…';
  try{const result=await api('/api/attachments/'+item.id+'/ocr','POST',{});Object.assign(item,result);await showDocumentText(item);button.textContent='识别结果';}
  finally{button.disabled=false;if(item.ocr_status!=='complete')button.textContent=label;}
 },'secondary document-ocr');
 return button;
}
const beforeDocumentCard=attachmentCard;attachmentCard=function(item,removable){const card=beforeDocumentCard(item,removable);if(['image','pdf'].includes(item.kind))card.append(documentOCRButton(item));return card};
const beforeDocumentGrid=renderAssetGrid;renderAssetGrid=function(){beforeDocumentGrid();for(const card of document.querySelectorAll('#asset-grid .asset-card')){const link=card.querySelector('.asset-download');const id=link?.href.split('/').at(-2);const item=libraryAssets.find(a=>a.id===id);if(item&&['image','pdf'].includes(item.kind))card.querySelector('.asset-caption').append(documentOCRButton(item))}};
renderAttachmentTray();
