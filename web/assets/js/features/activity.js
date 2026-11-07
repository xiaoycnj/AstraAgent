// The activity rail consumes existing persisted task, hub and artifact APIs.
const activityRail=elem('aside','activity-rail');activityRail.id='activity-rail';activityRail.setAttribute('aria-label','任务与产物');
const activityHeader=elem('header');activityHeader.append(elem('strong','','任务与产物'));
const activityClose=actionButton('收起',()=>setActivityRail(false),'secondary');activityHeader.append(activityClose);activityRail.append(activityHeader);
const activityBody=elem('div','activity-body');activityRail.append(activityBody);$('#app').append(activityRail);
const activityToggle=actionButton('',()=>setActivityRail(activityRail.hidden),'header-icon');activityToggle.append(svgIcon('review'));activityToggle.title='任务与产物';activityToggle.setAttribute('aria-label','任务与产物');$('.header-actions').append(activityToggle);
let activityTicket=0,activityTimer=null,activityHub={records:[],jobs:[]},activityOutputs=[];
function setActivityRail(open){activityRail.hidden=!open;document.body.classList.toggle('has-activity-rail',open);activityToggle.setAttribute('aria-expanded',String(open));try{localStorage.setItem('astra-activity-rail',String(open))}catch{}if(open)refreshActivity()}
function activitySection(title,rows,render){const section=elem('details','activity-section');section.open=true;const heading=elem('summary');heading.append(elem('strong','',title),elem('span','',String(rows.length)));section.append(heading);if(!rows.length)section.append(elem('p','hint','暂无记录'));for(const row of rows)section.append(render(row));activityBody.append(section)}
function activityRow(title,status,detail,action){const row=elem(action?'button':'div','activity-row');if(action){row.type='button';row.onclick=safely(action)}row.dataset.status=status||'';const dot=elem('i','status-dot');row.append(dot,elem('span','',title||'未命名'));if(detail)row.title=detail;return row}
function drawActivity(){
 activityBody.replaceChildren();
 activitySection('当前会话执行',state.sessionRuns||[],run=>activityRow((run.status==='running'?'执行中':'任务记录')+' · '+run.events.filter(e=>e.type==='tool').length+' 次工具调用',run.status,run.created,async()=>{taskPanel.hidden=false;drawTaskEvents(run.events,run.status)}));
 activitySection('工作空间进度',(activityHub.records||[]).filter(row=>row.kind==='task').slice(0,16),row=>activityRow(row.title,row.status,row.content,async()=>{hubView='task';hubDialog.showModal();await refreshHub()}));
 activitySection('子智能体',(activityHub.jobs||[]).slice(0,12),row=>activityRow(row.name,row.status,row.task,async()=>{const session=state.sessions.find(s=>s.id===row.session_id);if(session)await openSession(session);else{await refreshList();const fresh=state.sessions.find(s=>s.id===row.session_id);if(fresh)await openSession(fresh)}}));
 activitySection('交付物',activityOutputs,row=>{const card=activityRow(row.name,'done',row.kind,async()=>{if(row.kind==='image')previewGeneratedImage(row);else{resourcePanel.hidden=false;await refreshResources()}});if(row.kind==='image'){const image=elem('img','activity-thumbnail');image.src='/api/attachments/'+row.id+'/content';image.alt=row.name;image.loading='lazy';card.prepend(image)}return card});
}
async function refreshActivity(){
 if(activityRail.hidden||document.hidden)return;
 const sid=state.session?.id,ticket=++activityTicket;
 try{const [hub,runs,resources]=await Promise.all([api('/api/hub'),sid?api('/api/sessions/'+sid+'/runs'):[],sid?api('/api/sessions/'+sid+'/resources'):{outputs:[]}]);if(ticket!==activityTicket||sid!==state.session?.id)return;activityHub=hub;state.sessionRuns=runs;activityOutputs=resources.outputs||[];drawActivity()}catch(error){if(ticket===activityTicket)activityBody.replaceChildren(elem('p','hint',error.message),actionButton('重试',refreshActivity,'secondary'))}
}
function scheduleActivity(){clearTimeout(activityTimer);activityTimer=setTimeout(refreshActivity,350)}
const beforeActivityEvent=handleAgentEvent;handleAgentEvent=function(sid,event){beforeActivityEvent(sid,event);if(event.type!=='delta'&&event.type!=='reasoning_summary')scheduleActivity()};
const beforeActivitySession=openSession;openSession=async function(session){await beforeActivitySession(session);scheduleActivity()};
const beforeActivityNew=newSession;newSession=async function(){await beforeActivityNew();activityOutputs=[];scheduleActivity()};
setInterval(()=>{if(!activityRail.hidden&&!document.hidden&&(state.pending.size||activityHub.jobs.some(j=>j.status==='running')))refreshActivity()},5000);
let activityOpen=innerWidth>=1280;try{const value=localStorage.getItem('astra-activity-rail');if(value!==null)activityOpen=value==='true'}catch{}
setActivityRail(activityOpen);
const moduleGroup=elem('section','settings-group');moduleGroup.append(elem('h3','','功能模块'),elem('p','hint','内置模块使用显式工具适配器，插件和 Skills 继续在能力目录中管理。'));
const moduleRows=elem('div');
async function drawModuleSettings(){const modules=await api('/api/modules');moduleRows.replaceChildren();for(const item of modules){const label=elem('label','switch-pill'),toggle=elem('input');toggle.type='checkbox';toggle.setAttribute('role','switch');toggle.checked=item.enabled;toggle.setAttribute('aria-label','启用模块 '+item.name);toggle.onchange=safely(async()=>{try{await api('/api/modules','PUT',{id:item.id,enabled:toggle.checked})}catch(error){toggle.checked=!toggle.checked;throw error}});label.append(elem('span','',item.name),toggle);moduleRows.append(label)}}
moduleGroup.append(moduleRows,actionButton('管理功能模块',drawModuleSettings,'secondary'));capabilitiesPanel.append(moduleGroup);
matchMedia('(min-width:1280px)').addEventListener('change',event=>{if(!event.matches)setActivityRail(false)});
