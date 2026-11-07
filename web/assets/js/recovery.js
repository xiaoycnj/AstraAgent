// Execution recovery is explicit; event replay alone never repeats an operation.
Object.assign(eventNames,{step_reused:'复用已保存步骤',execution_resumed:'恢复执行',subagent_retry:'子任务重试'});
const recoveryPanel=elem('section','execution-recovery');recoveryPanel.hidden=true;
recoveryPanel.setAttribute('aria-label','任务恢复');$('#chat-form').before(recoveryPanel);
const recoveryLabels={pending:'待执行',waiting:'待批准',executing:'执行中',done:'已保存',unknown:'结果不确定'};
let recoveryGeneration=0,recoverySnapshot='';
async function refreshExecutionRecovery(){
 const sid=state.session?.id,ticket=++recoveryGeneration;
 if(!sid){recoveryPanel.hidden=true;return;}
 const rows=await api(`/api/sessions/${sid}/executions`);
 if(ticket!==recoveryGeneration||state.session?.id!==sid)return;
 const row=rows.find(item=>item.resumable);
 if(!row||state.pending.has(sid)){recoveryPanel.hidden=true;recoverySnapshot='';return;}
 const signature=sid+JSON.stringify(row);
 if(signature===recoverySnapshot&&!recoveryPanel.hidden)return;
 const opened=!!recoveryPanel.querySelector('details')?.open;
 recoveryPanel.replaceChildren();recoveryPanel.hidden=false;recoverySnapshot=signature;
 const heading=elem('div','recovery-heading');heading.append(svgIcon('history'),elem('strong','','有一个任务可以继续'));
 const details=elem('details'),summary=elem('summary','',`${row.steps.filter(s=>s.status==='done').length} 个已保存步骤 · 查看执行记录`);
 details.open=opened;
 details.append(summary);
 for(const step of row.steps){
  const line=elem('div','recovery-step');line.append(elem('code','',step.name),elem('span','hint',recoveryLabels[step.status]||step.status));
  if(step.status==='unknown')for(const [action,label] of [['skip','跳过此步骤'],['retry','明确重试']]){
   line.append(actionButton(label,async()=>{
    const message=action==='retry'?'该操作可能已经产生效果。请先核对文件、终端或外部服务；重试可能再次执行。确认重试？':'跳过后不会再次执行，也不会将其视为成功。确认已核对实际结果？';
    if(!confirm(typeof uiText==='function'?uiText(message):message))return;
    await api(`/api/executions/${row.request_id}/resolve`,'POST',{step:step.step,action,acknowledged:true});await refreshExecutionRecovery();
   },'secondary'));
  }
  details.append(line);
 }
 const unknown=row.steps.some(step=>step.status==='unknown');
 const hint=elem('p','hint',unknown?'有步骤的结果不确定。先核对并处置，再继续执行。':'已完成的步骤直接复用；待批准的调用会重新询问。');
 const resume=actionButton('继续任务',async()=>resumeExecution(row),'secondary');resume.disabled=unknown;resume.dataset.resumeExecution=row.request_id;
 recoveryPanel.append(heading,hint,details,resume);
}
async function resumeExecution(row){
 const sid=row.session_id;if(activeStreams.has(sid)||state.pending.has(sid))return;
 state.pending.add(sid);recoveryPanel.hidden=true;
 let promise;
 try{
  const result=await api(`/api/executions/${row.request_id}/resume`,'POST',{});
  const draft={role:'assistant',content:'',streaming:true};state.messages.push(draft);renderMessages();
  promise=consumeDurableStream(sid,row.request_id,null,text=>{draft.content+=text;if(state.session?.id===sid)renderMessages();},result.after);
  activeStreams.set(sid,promise);streamKeys.set(sid,row.request_id);await promise;
 }catch(error){toast(error.message);}
 finally{
  if(activeStreams.get(sid)===promise)activeStreams.delete(sid);streamKeys.delete(sid);state.pending.delete(sid);
  if(state.session?.id===sid){state.messages=await api(`/api/sessions/${sid}/messages`);renderMessages();await refreshTaskRecords();}
  await refreshExecutionRecovery();
 }
}
const priorRecoveryOpen=openSession;openSession=async function(session){recoveryPanel.hidden=true;await priorRecoveryOpen(session);await refreshExecutionRecovery();};
const priorRecoveryRecords=refreshTaskRecords;refreshTaskRecords=async function(){await priorRecoveryRecords();await refreshExecutionRecovery();};
const priorRecoveryNew=newSession;newSession=async function(){recoveryPanel.hidden=true;recoveryGeneration++;return priorRecoveryNew();};
setTimeout(()=>refreshExecutionRecovery().catch(()=>{}),900);
