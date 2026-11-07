// One capability workspace, reusing the existing editors and live settings.
capabilitiesTab.replaceChildren(svgIcon('tools'), elem('span', '', '插件与技能'));
capabilitiesPanel.querySelector('h2').textContent='插件与技能';
const integrationBar=elem('div','integration-toolbar');
const integrationTabs=elem('div','integration-tabs');integrationTabs.setAttribute('role','tablist');
const integrationSearch=elem('input');integrationSearch.type='search';integrationSearch.placeholder='搜索插件、技能和服务';integrationSearch.setAttribute('aria-label','搜索能力');
integrationBar.append(integrationTabs,integrationSearch,actionButton('重新扫描',async()=>{await reloadCapabilities();await loadMcp();renderIntegrationSkills();},'secondary'));
capabilitiesPanel.children[1].after(integrationBar);
const integrationPanes={},integrationButtons={};let integrationCurrent='plugins';
for(const [id,label] of [['plugins','插件'],['skills','Skills'],['mcp','MCP'],['tools','Tools']]){
 const button=actionButton(label,()=>selectIntegration(id),'secondary');button.setAttribute('role','tab');button.id='integration-tab-'+id;
 const pane=elem('section','integration-pane');pane.id='integration-'+id;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',button.id);button.setAttribute('aria-controls',pane.id);
 integrationPanes[id]=pane;integrationButtons[id]=button;integrationTabs.append(button);capabilitiesPanel.append(pane);
}
integrationPanes.plugins.append(pluginSection);
const integrationSkills=elem('div','integration-skill-list');integrationPanes.skills.append(integrationSkills,skillEditor,skillFeedback);
integrationPanes.mcp.append(...Array.from(mcpPanel.children));mcpPanel.remove();$('[data-settings-tab=mcp]')?.remove();
integrationPanes.tools.append(legacyCapabilities,toolCatalogSection);
const integrationNotice=elem('p','hint');capabilitiesPanel.append(integrationNotice);
function selectIntegration(id){
 integrationCurrent=id;for(const key of Object.keys(integrationPanes)){integrationPanes[key].hidden=key!==id;integrationButtons[key].setAttribute('aria-selected',String(key===id));integrationButtons[key].classList.toggle('active',key===id);}
 filterIntegrations();
}
function filterIntegrations(){
 const query=integrationSearch.value.trim().toLocaleLowerCase();
 for(const node of integrationPanes[integrationCurrent].querySelectorAll('.plugin-card,.integration-skill-row,.mcp-card,.tool-catalog-card'))node.hidden=!!query&&!node.textContent.toLocaleLowerCase().includes(query);
}
integrationSearch.oninput=filterIntegrations;
function renderIntegrationSkills(){
 integrationSkills.replaceChildren();
 for(const [id,skill] of Object.entries(capabilityCatalog.all_skills||capabilityCatalog.skills)){
  const row=elem('article','integration-skill-row');const info=elem('div');info.dataset.i18nIgnore='';info.append(elem('strong','',skill.name),elem('p','hint',(skill.prompt||'').slice(0,150)),elem('small','',skill.source));
  const edit=actionButton(skill.editable?'编辑':'查看',()=>{const option=$('#skill-select');if(!Array.from(option.options).some(x=>x.value===id))option.append(new Option(skill.name,id));option.value=id;option._refresh?.();
   skillId.value=id;skillName.value=skill.name;skillPrompt.value=skill.prompt;for(const input of [skillId,skillName,skillPrompt])input.disabled=!skill.editable;saveSkill.disabled=!skill.editable;skillEditor.scrollIntoView({block:'nearest',behavior:'smooth'});},'secondary');
  row.append(colorIcon(skill.editable?'library':'plugin'),info,edit);
  if(skill.editable){const label=elem('label','switch-pill');const input=elem('input');input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('aria-label','启用 '+skill.name);input.checked=skill.enabled!==false;input.disabled=id==='general';
   input.onchange=safely(async()=>{input.disabled=true;try{await api('/api/skill-state/'+encodeURIComponent(id),'PUT',{enabled:input.checked});await reloadCapabilities();}finally{input.disabled=id==='general';}});label.append(input);row.append(label);}
  integrationSkills.append(row);
 }
 integrationButtons.plugins.textContent='插件 '+capabilityCatalog.plugins.length;integrationButtons.skills.textContent='Skills '+Object.keys(capabilityCatalog.all_skills||capabilityCatalog.skills).length;
 integrationNotice.textContent=(capabilityCatalog.errors||[]).join(' · ');filterIntegrations();
}
const previousIntegrationReload=reloadCapabilities;reloadCapabilities=async function(){await previousIntegrationReload();renderIntegrationSkills();};
const previousIntegrationMcp=loadMcp;loadMcp=async function(){await previousIntegrationMcp();integrationButtons.mcp.textContent='MCP '+mcpCards.querySelectorAll('.mcp-card').length;filterIntegrations();};
const previousIntegrationSelect=selectSettingsTab;selectSettingsTab=function(name){previousIntegrationSelect(name==='mcp'?'capabilities':name);if(name==='mcp')selectIntegration('mcp');if(name==='capabilities'||name==='mcp'){reloadCapabilities().catch(e=>toast(e.message));loadMcp().catch(e=>toast(e.message));}};
selectIntegration('plugins');studioReady.then(()=>reloadCapabilities()).catch(e=>toast(e.message));

// Copyright originals stay in a single accessible modal, outside the About scroll.
const licenseDialog=elem('dialog','license-dialog');licenseDialog.id='license-dialog';licenseDialog.setAttribute('aria-label','开源版权声明');
const licenseHead=elem('div','license-dialog-head');licenseHead.append(elem('h2','','开源版权声明'),actionButton('关闭',()=>licenseDialog.close(),'secondary'));
licenseDialog.append(licenseHead,noticesGroup);document.body.append(licenseDialog);
const aboutPanel=$('[data-panel=about]');aboutPanel.append(actionButton('点击查看开源声明',()=>licenseDialog.showModal(),'secondary'));
licenseDialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
licenseDialog.addEventListener('click',event=>{if(event.target===licenseDialog){const rect=licenseDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)licenseDialog.close();}});
const acknowledgements=elem('section','settings-group acknowledgements');acknowledgements.append(elem('h3','','鸣谢'),elem('p','','作者：cnxiaoy'),elem('p','','贡献者：Codex（OpenAI-GPT-6.1 Sol及GPT-6 Astra）'));aboutPanel.append(acknowledgements);

// OAuth starts only after a user click. The loopback callback owns all token exchange.
const oauthGroup=elem('section','settings-group oauth-group');oauthGroup.id='openai-oauth';oauthGroup.append(elem('h3','','OpenAI · ChatGPT OAuth'),elem('p','hint','填写为 AstraAgent 注册的 client ID 和回调地址。登录后在对话中选择 OpenAI · ChatGPT OAuth，并获取或填写账户可用模型。'));
const oauthClient=field('OAuth Client ID','oauth-client'),oauthRedirect=field('回调地址','oauth-redirect');oauthRedirect.input.value='http://127.0.0.1:1455/auth/callback';
try{oauthClient.input.value=localStorage.getItem('astra-oauth-client')||'';}catch(e){}
const oauthStatus=elem('p','hint');oauthStatus.setAttribute('role','status');
const oauthLogin=actionButton('Continue with ChatGPT',async()=>{oauthLogin.disabled=true;try{const result=await api('/api/openai-oauth/begin','POST',{client_id:oauthClient.input.value,redirect_uri:oauthRedirect.input.value});localStorage.setItem('astra-oauth-client',oauthClient.input.value);oauthLink.href=result.authorization_url;oauthLink.hidden=false;oauthLink.focus();window.open(result.authorization_url,'_blank','noopener,noreferrer');await refreshOAuthStatus();}finally{oauthLogin.disabled=false;}},'secondary');
const oauthLink=elem('a','','打开 OpenAI 授权页面');oauthLink.hidden=true;oauthLink.target='_blank';oauthLink.rel='noopener noreferrer';
const oauthCancel=actionButton('取消登录',async()=>{await api('/api/openai-oauth/cancel','POST',{});oauthLink.hidden=true;await refreshOAuthStatus();},'secondary');
const oauthLogout=actionButton('断开本机登录',async()=>{if(!confirm('清除本机的 OpenAI OAuth 凭证？'))return;await api('/api/openai-oauth/logout','POST',{});await refreshOAuthStatus();},'secondary');
const oauthActions=elem('div','integration-toolbar');oauthActions.append(oauthLogin,oauthCancel,oauthLogout,oauthLink);oauthGroup.append(oauthClient.label,oauthRedirect.label,oauthStatus,oauthActions);
$('[data-panel=connection]').append(oauthGroup);let oauthConnected=false;
async function refreshOAuthStatus(){const value=await api('/api/openai-oauth/status');oauthStatus.textContent=value.error||(value.pending?'等待浏览器授权':value.connected?'已连接 · '+(value.email||'ChatGPT'):'尚未登录');oauthCancel.hidden=!value.pending;oauthLogout.hidden=!value.connected;if(value.connected&&!oauthConnected){oauthLink.hidden=true;await loadProviders();}oauthConnected=value.connected;}
setInterval(()=>{if(!$('#settings').hidden&&!$('[data-panel=connection]').hidden)refreshOAuthStatus().catch(e=>oauthStatus.textContent=e.message);},2500);
refreshOAuthStatus().catch(e=>oauthStatus.textContent=e.message);

acknowledgements.append(elem('h4','','群友'),elem('p','','星环引力执政官 · notBot · 猪骨社区 · 与兼 · 晨曦Aurora · 何意豬'));
