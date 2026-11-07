Object.assign(iconPaths,{code:'m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',document:iconPaths.note,folder:'M3 6h7l2 2h9v12H3V6Z',terminal:'M3 4h18v13H3V4Zm5 17h8m-4-4v4'});
$('.shelf-project svg path')?.setAttribute('d',iconPaths.folder);
$('.composer-device svg path')?.setAttribute('d',iconPaths.terminal);
// Reuse the actual controls and renderer so permissions and streaming keep one state owner.
const dialogueContext=elem('span','chat-context','本地工作空间');
$('.header-actions').before(dialogueContext);
const composerOptions=elem('details','composer-options'),composerOptionsTitle=elem('summary');
composerOptionsTitle.append(svgIcon('settings'),document.createTextNode('对话选项'));
const composerOptionsPanel=elem('div','composer-options-panel');
composerOptionsPanel.append(permissionLabel);
const reviewControl=$('#review-toggle');
if(reviewControl)composerOptionsPanel.append(reviewControl);
composerOptions.append(composerOptionsTitle,composerOptionsPanel);
$('.composer-tools .spacer').before(composerOptions);
document.addEventListener('pointerdown',event=>{if(composerOptions.open&&!composerOptions.contains(event.target))composerOptions.open=false});
composerOptions.addEventListener('keydown',event=>{if(event.key==='Escape'){composerOptions.open=false;composerOptionsTitle.focus()}});
const previousDialogueRender=renderMessages;
renderMessages=function(){
 previousDialogueRender();
 const busy=!!(state.session&&state.pending.has(state.session.id));
 dialogueContext.textContent=busy?'任务进行中':'本地工作空间';dialogueContext.dataset.busy=String(busy);
 const welcome=$('#messages .welcome');
 if(welcome&&!welcome.querySelector('.starter-grid')){
  welcome.querySelector('.suggestions')?.remove();
  const grid=elem('div','starter-grid');
  for(const [icon,title,description,prompt] of [
   ['code','一起写代码','从项目文件开始，定位问题与验证结果。','帮我梳理这个项目，找出一个值得改进的问题，先给出计划。'],
   ['document','把想法写清楚','组织材料，打磨一份可以交付的内容。','帮我整理一个想法，先问我目标、受众和现有材料。'],
   ['tools','拆解一个任务','明确步骤，按实际执行结果继续推进。','帮我把一个复杂任务拆成可执行步骤，先确认目标与约束。']]){
   const card=elem('button','starter-card');card.type='button';card.append(svgIcon(icon),elem('strong','',title),elem('small','',description));
   card.onclick=()=>{const input=$('#chat-input');input.value=prompt;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()};grid.append(card);
  }
  welcome.append(grid);
 }
};
renderMessages();

function syncDialoguePermissions(){
 composerOptionsTitle.title=(allowTools.checked?'工具已启用':'工具已关闭')+' · '+permissionSelect.selectedOptions[0].textContent;
}
allowTools.addEventListener('change',syncDialoguePermissions);
permissionSelect.addEventListener('change',syncDialoguePermissions);
syncDialoguePermissions();
