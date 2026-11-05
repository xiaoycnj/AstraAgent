// Unified execution policy and execution/storage control surfaces.
let executionSettings={access_policy:'trusted',trusted_commands:[],context_chars:60000,tool_rounds:32,tool_calls:120,auto_compact:true,skill_learning:true};
const policyNames={deny:'全部拒绝',ask:'每次询问',trusted:'自动批准信任命令',full:'完全访问'};
permissionsGroup.replaceChildren(elem('h3','','权限控制器'));
const policyGrid=elem('div','policy-grid');
const policyDescriptions={deny:'关闭智能体工具调用',ask:'每项调用都申请批准',trusted:'读取与完整匹配的信任命令自动通过',full:'自动允许命令、文件、MCP 与调度调用'};
for(const [id,name] of Object.entries(policyNames)){
    const button=elem('button','policy-option');button.type='button';button.dataset.policy=id;button.append(colorIcon(id==='full'?'lightning':'shield'),elem('strong','',name),elem('small','',policyDescriptions[id]));button.onclick=safely(async()=>{const next=await api('/api/runtime','PUT',{access_policy:id});executionSettings=next;if(id!=='deny'){allowTools.checked=true;localStorage.setItem('astra-allow-tools','true');saveRuntime()}renderExecutionSettings();});policyGrid.append(button);
}
permissionsGroup.append(policyGrid,elem('p','hint','信任命令按完整 argv 数组匹配。完全访问会直接执行本机命令。'));
executionGroup.hidden=true;permissionLabel.style.display='none';
const unifiedPolicyButton=actionButton('权限',()=>{showSettings();selectSettingsTab('general')},'unified-policy-pill');permissionLabel.after(unifiedPolicyButton);
const engineGroup=elem('section','settings-group');engineGroup.append(elem('h3','','执行与上下文'));
const executionFields={};
for(const [key,label,type] of [['tool_rounds','每轮任务的工具轮数','number'],['tool_calls','工具调用预算','number'],['context_chars','自动压缩阈值（字符估算）','number']]){const item=field(label,'engine-'+key,type);executionFields[key]=item.input;engineGroup.append(item.label);}
const autoCompactLabel=elem('label','switch-pill');const autoCompactInput=elem('input');autoCompactInput.type='checkbox';autoCompactInput.setAttribute('role','switch');autoCompactInput.setAttribute('aria-label','自动压缩上下文');autoCompactLabel.append(elem('span','','自动压缩上下文'),autoCompactInput);
const learnLabel=elem('label','switch-pill');const learnInput=elem('input');learnInput.type='checkbox';learnInput.setAttribute('role','switch');learnInput.setAttribute('aria-label','允许版本化 Skill 学习');learnLabel.append(elem('span','','允许版本化 Skill 学习'),learnInput);
const trustedField=field('信任命令，每行一个完整 JSON argv 数组','trusted-commands','text',5);trustedField.input.placeholder='["git","status","--short"]';
engineGroup.append(autoCompactLabel,learnLabel,trustedField.label,actionButton('保存执行设置',async()=>{const trusted=trustedField.input.value.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>JSON.parse(line));executionSettings=await api('/api/runtime','PUT',{trusted_commands:trusted,tool_rounds:Number(executionFields.tool_rounds.value),tool_calls:Number(executionFields.tool_calls.value),context_chars:Number(executionFields.context_chars.value),auto_compact:autoCompactInput.checked,skill_learning:learnInput.checked});renderExecutionSettings();toast('执行设置已保存');}));generalPanel.append(engineGroup);
function renderExecutionSettings(){for(const button of policyGrid.children){const active=button.dataset.policy===executionSettings.access_policy;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}unifiedPolicyButton.textContent=policyNames[executionSettings.access_policy];for(const [key,input] of Object.entries(executionFields))input.value=executionSettings[key];trustedField.input.value=executionSettings.trusted_commands.map(command=>JSON.stringify(command)).join('\n');autoCompactInput.checked=executionSettings.auto_compact;learnInput.checked=executionSettings.skill_learning;}
const executionSettingsReady=api('/api/runtime').then(value=>{executionSettings=value;renderExecutionSettings()}).catch(error=>toast(error.message));
const previousUnifiedRuntimeOptions=runtimeOptions;runtimeOptions=function(){return {...previousUnifiedRuntimeOptions(),access_policy:executionSettings.access_policy};};
const compactButton=actionButton('压缩上下文',async()=>{if(!state.session){toast('请先打开一个会话');return}compactButton.disabled=true;try{const result=await api('/api/sessions/'+state.session.id+'/compact','POST',runtimeOptions());toast(result.compacted?'已压缩 '+result.messages+' 条历史消息':result.reason||'当前无需压缩');}finally{compactButton.disabled=false;}},'secondary compact-context');$('.composer-wrap').prepend(compactButton);
function addExecutionNav(id,label,icon){const button=elem('button');button.type='button';button.dataset.settingsTab=id;button.append(svgIcon(icon),elem('span','',label));settingsNav.insertBefore(button,$('[data-settings-tab=about]'));button.onclick=()=>selectSettingsTab(id);}
const storagePanel=settingPanel('storage','存储空间','管理此设备上的会话、附件、长期记忆与工作文件。');addExecutionNav('storage','存储','note');
const storageDisplay=elem('div');storagePanel.append(storageDisplay);
function formatBytes(bytes){if(bytes<1024)return bytes+' B';if(bytes<1048576)return (bytes/1024).toFixed(1)+' KB';return (bytes/1048576).toFixed(1)+' MB';}
async function loadStorage(){
    const value=await api('/api/storage');storageDisplay.replaceChildren();const overview=elem('section','settings-group');overview.append(elem('h3','','AstraAgent 已占用 '+formatBytes(value.total)));const chart=elem('div','storage-chart');const legend=elem('div','storage-legend');const colors=['#e7ae55','#73a7ef','#86b99c','#a18bd1','#ce91b4','#73b9c3','#9aa0ad','#657d9a'];value.categories.forEach((category,index)=>{const segment=elem('span');segment.style.width=(value.total?category.bytes/value.total*100:0)+'%';segment.style.background=colors[index%colors.length];chart.append(segment);const item=elem('span','',category.name+' '+formatBytes(category.bytes));item.style.setProperty('--category-color',colors[index%colors.length]);legend.append(item);});overview.append(chart,legend,elem('p','hint',value.path),elem('p','hint',value.sessions+' 个会话 · '+value.archived+' 个已归档 · '+value.messages+' 条消息'));storageDisplay.append(overview);
    for(const [title,description,label,action] of [
        ['续读缓存','已完成任务的事件正文 '+formatBytes(value.completed_stream_bytes),'清理',async()=>{if(confirm('清理已完成的续读缓存？已保存的会话消息和任务总结仍可查看。')){await api('/api/storage/cleanup','POST',{action:'completed_streams'});await loadStorage();}}],
        ['已归档的聊天','恢复或删除单个归档会话','管理',async()=>selectSettingsTab('archives')],
        ['工作文件','查看工作目录中的文件和代码','查看',async()=>{closeSettingsPage();openWorkbench('files');}]
    ]){const row=elem('div','storage-manage-row');const text=elem('div');text.append(elem('strong','',title),elem('p','hint',description));row.append(text,actionButton(label,action,'secondary'));storageDisplay.append(row);}
}
const mcpPanel=settingPanel('mcp','MCP 服务','通过标准 stdio JSON-RPC 接入本机 MCP 服务，工具会加入模型可调用目录。');addExecutionNav('mcp','MCP 服务','tools');const mcpCards=elem('div','mcp-cards');mcpPanel.append(mcpCards);
const mcpForm=elem('form','settings-group');const mcpId=field('服务 ID','mcp-id'),mcpName=field('名称','mcp-name'),mcpCommand=field('可执行文件','mcp-command'),mcpArgs=field('参数 JSON 数组','mcp-args','text',3);mcpId.input.required=true;mcpCommand.input.required=true;mcpArgs.input.value='[]';const mcpSave=elem('button','primary','保存服务');mcpForm.append(mcpId.label,mcpName.label,mcpCommand.label,mcpArgs.label,mcpSave);mcpPanel.append(mcpForm);
mcpForm.onsubmit=async event=>{event.preventDefault();mcpSave.disabled=true;try{await api('/api/mcp','PUT',{id:mcpId.input.value,name:mcpName.input.value,command:mcpCommand.input.value,args:JSON.parse(mcpArgs.input.value),enabled:true});await loadMcp();toast('服务已保存，点击连接获取工具');}catch(error){toast(error.message)}finally{mcpSave.disabled=false}};
async function loadMcp(){const rows=await api('/api/mcp');mcpCards.replaceChildren();for(const row of rows){const card=elem('article','mcp-card');const info=elem('div');info.append(elem('h3','',row.name),elem('p','hint',row.command+' · '+row.tools.length+' 个工具'));const toggleLabel=elem('label','switch-pill');const toggle=elem('input');toggle.type='checkbox';toggle.checked=row.enabled;toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','启用 MCP '+row.name);toggle.onchange=async()=>{try{await api('/api/mcp','PUT',{...row,enabled:toggle.checked});await loadMcp();}catch(error){toggle.checked=row.enabled;toast(error.message);}};toggleLabel.append(elem('span','','启用'),toggle);const connect=actionButton('连接并获取工具',async()=>{connect.disabled=true;try{const result=await api('/api/mcp/discover','POST',{id:row.id});toast('已发现 '+result.count+' 个工具');await loadMcp();}finally{connect.disabled=false}},'secondary');connect.disabled=!row.enabled;const edit=actionButton('编辑',async()=>{mcpId.input.value=row.id;mcpName.input.value=row.name;mcpCommand.input.value=row.command;mcpArgs.input.value=JSON.stringify(row.args);},'secondary');const remove=actionButton('删除',async()=>{if(confirm('删除这个 MCP 服务配置？')){await api('/api/mcp','PUT',{id:row.id,delete:true});await loadMcp();}},'danger-text');card.append(colorIcon('plugin'),info,toggleLabel,connect,edit,remove);mcpCards.append(card);}if(!rows.length)mcpCards.append(elem('p','hint','添加服务后，点击连接完成初始化和工具发现。'));}
const previousExecutionTab=selectSettingsTab;selectSettingsTab=function(name){previousExecutionTab(name);if(name==='storage')loadStorage().catch(error=>toast(error.message));if(name==='mcp')loadMcp().catch(error=>toast(error.message));};
const materialGroup = elem('section', 'settings-group');
materialGroup.append(elem('h3', '', '材质与密度'));
const materialChoices = [
    ['material', [['quiet', '静谧'], ['glass', '透彩玻璃'], ['contrast', '高对比']]],
    ['density', [['comfortable', '舒适'], ['compact', '紧凑']]]
];
for (const [attribute, choices] of materialChoices) {
    const fallback = attribute === 'material' ? 'glass' : 'comfortable';
    const saved = localStorage.getItem('astra-' + attribute);
    const current = choices.some(([value]) => value === saved) ? saved : fallback;
    const row = elem('div', 'material-options');
    for (const [value, label] of choices) {
        const button = actionButton(label, () => {
            document.documentElement.dataset[attribute] = value;
            localStorage.setItem('astra-' + attribute, value);
            for (const item of row.children) {
                item.classList.toggle('active', item === button);
                item.setAttribute('aria-pressed', String(item === button));
            }
        }, 'secondary');
        if (attribute === 'material') button.dataset.materialChoice = value;
        button.classList.toggle('active', current === value);
        button.setAttribute('aria-pressed', String(current === value));
        row.append(button);
    }
    materialGroup.append(row);
    document.documentElement.dataset[attribute] = current;
}
$('[data-panel=appearance]').append(materialGroup);
const newWindowButton=actionButton('新窗口',async()=>{if(window.pywebview?.api?.new_window)await window.pywebview.api.new_window(state.session?.id||'');else window.open(location.origin+'/?session='+(state.session?.id||''),'_blank','noopener');},'secondary');$('.topbar').append(newWindowButton);
const requestedSession=new URLSearchParams(location.search).get('session');if(requestedSession)setTimeout(async()=>{const rows=await api('/api/sessions');const session=rows.find(row=>row.id===requestedSession);if(session)await openSession(session);},800);
Object.assign(eventNames,{context_compacted:'已压缩上下文',budget:'执行预算收尾',dispatch:'跨窗口派发'});

const previousRestartApi=api;api=async function(path,method='GET',data){try{return await previousRestartApi(path,method,data);}catch(error){if(error.status!==403||!error.message.includes('页面会话'))throw error;const bootstrap=await previousRestartApi('/api/bootstrap');state.token=bootstrap.token;return previousRestartApi(path,method,data);}};
const watchdogStatus=elem('p','hint');generalPanel.append(watchdogStatus);async function updateWatchdogStatus(){const value=await api('/api/desktop');watchdogStatus.textContent=value.status==='web'?'当前通过开发服务运行':'桌面守护服务 · '+value.status+' · 已恢复 '+value.restarts+' 次';}setInterval(()=>{if(!$('#settings').hidden&&$('[data-panel=general]').hidden===false)updateWatchdogStatus().catch(()=>{});},5000);

const skillVersionButton=actionButton('查看 Skill 版本',async()=>{const result=await api('/api/skill-versions/'+encodeURIComponent(skillId.value));const dialog=elem('dialog','message-more');dialog.append(elem('h2','','Skill 版本'));if(!result.versions.length)dialog.append(elem('p','hint','此 Skill 尚无学习版本。'));for(const version of result.versions)dialog.append(actionButton('恢复 '+version,async()=>{if(confirm('恢复到这个版本？当前版本会先保存。')){await api('/api/skill-versions/'+encodeURIComponent(skillId.value),'POST',{version});await reloadCapabilities();dialog.close();}},'secondary'));dialog.append(actionButton('关闭',async()=>dialog.close(),'secondary'));dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();},'secondary');skillActions.prepend(skillVersionButton);
