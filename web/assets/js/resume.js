// Reconnect using durable server events. Replaying never starts another model request.
const activeStreams=new Map();
const streamKeys=new Map();
async function consumeDurableStream(sid,key,payload,onDelta,after=0){
    let cursor=after,finished=false,answer='',attempt=0,first=Boolean(payload);
    while(!finished){
        let reader;
        try{
            const response=await fetch(first?`/api/sessions/${sid}/chat`:`/api/stream/${key}?after=${cursor}`,first?{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':state.token},body:JSON.stringify(payload)}:{});
            if(!response.ok){
                if(response.status===404&&payload){first=true;throw new Error('正在恢复请求');}
                const failure=await response.json();const error=new Error(failure.error||'续读失败');error.terminal=true;throw error;
            }
            first=false;
            reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
            while(true){
                const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
                let boundary;
                while((boundary=buffer.indexOf('\n\n'))>=0){
                    const packet=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
                    const lines=packet.split('\n'),data=lines.find(line=>line.startsWith('data:'));
                    if(!data)continue;
                    const id=Number(lines.find(line=>line.startsWith('id:'))?.slice(3)||0);
                    if(id&&id<=cursor)continue;
                    const event=JSON.parse(data.slice(5));
                    if(event.type==='delta')onDelta(event.text);
                    if(typeof handleAgentEvent==='function')handleAgentEvent(sid,event);
                    if(event.type==='approval'){
                        const approval=await api('/api/approvals/'+event.id);
                        if(approval.pending)await requestApproval(event);
                    }
                    if(id)cursor=id;
                    if(event.type==='done'||event.type==='cancelled'){answer=event.content;finished=true;}
                    if(event.type==='error'){const error=new Error(event.message);error.terminal=true;throw error;}
                }
                if(done)break;
            }
            if(!finished)throw new Error('连接中断');
        }catch(error){
            if(error.terminal||attempt>=30)throw error;
            attempt++;
            if(state.session?.id===sid)toast('连接中断，正在续读…');
            await new Promise(resolve=>setTimeout(resolve,Math.min(5000,attempt*500)));
        }finally{reader?.releaseLock();}
    }
    return {content:answer};
}
receiveStream=async function(sid,content,onDelta){
    const bootstrap=await api('/api/bootstrap');state.token=bootstrap.token;
    const key=crypto.randomUUID();
    const payload={content,...runtimeOptions(),...(typeof attachmentOptions==='function'?attachmentOptions(sid):{}),stream:true,request_id:key};
    streamKeys.set(sid,key);
    const promise=consumeDurableStream(sid,key,payload,onDelta);
    activeStreams.set(sid,promise);
    try{return await promise;}finally{if(activeStreams.get(sid)===promise){activeStreams.delete(sid);streamKeys.delete(sid);}}
};
async function recoverSessionStream(session){
    if(activeStreams.has(session.id)||state.session?.id!==session.id)return;
    const job=await api('/api/sessions/'+session.id+'/stream');
    if(!job||job.status!=='running'||activeStreams.has(session.id)||state.session?.id!==session.id)return;
    const input=JSON.parse(job.input);
    const user={role:'user',content:input.content,attachments:JSON.stringify(input.attachments)};
    const draft={role:'assistant',content:'',streaming:true};
    state.messages.push(user,draft);state.pending.add(session.id);renderMessages();
    const promise=consumeDurableStream(session.id,job.id,null,text=>{draft.content+=text;if(state.session?.id===session.id)renderMessages();});
    activeStreams.set(session.id,promise);streamKeys.set(session.id,job.id);
    try{
        await promise;
        if(state.session?.id===session.id)state.messages=await api('/api/sessions/'+session.id+'/messages');
    }catch(error){
        draft.streaming=false;
        if(state.session?.id===session.id){$('#chat-error').hidden=false;$('#chat-error').textContent=error.message;}
    }finally{
        activeStreams.delete(session.id);streamKeys.delete(session.id);state.pending.delete(session.id);
        if(state.session?.id===session.id){renderMessages();await refreshTaskRecords();}
    }
}
const previousResumableOpenSession=openSession;
openSession=async function(session){await previousResumableOpenSession(session);recoverSessionStream(session).catch(error=>toast(error.message));};
setTimeout(()=>{if(state.session)recoverSessionStream(state.session).catch(()=>{});},500);
