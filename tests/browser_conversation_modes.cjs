/* Desktop interaction regression using an isolated server and profile. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const root = path.resolve(__dirname, "..");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "astra-shared-ui-"));
  const data = path.join(folder, "data");
  const python =
    process.env.ASTRA_TEST_PYTHON ||
    path.join(root, "runtimes/python/python.exe");
  const server = spawn(
    python,
    ["-u", "server.py", "--port", "0", "--data-dir", data],
    {
      cwd: root,
      env: { ...process.env, PYTHONUTF8: "1" },
      windowsHide: true,
    },
  );
  let log = "",
    browser;
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));
  try {
    for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+/.test(log); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, log);
    const token = execFileSync(
      python,
      [
        "-c",
        "import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))",
        data,
      ],
      { cwd: root, windowsHide: true },
    )
      .toString()
      .trim();
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.ASTRA_TEST_BROWSER ||
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    });
    const page = await browser.newPage({
      locale: 'zh-CN',
      reducedMotion: 'reduce',
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url + "/#access=" + token);
    await page.waitForFunction(
      () =>
        state.token &&
        state.settings &&
        document.querySelector(".command-launcher"),
    );






    await page.waitForFunction(()=>typeof getConversationMode==='function');
    assert.equal(await page.evaluate(()=>getConversationMode()),'chat');
    await page.evaluate(()=>newSession());
    const first=await page.evaluate(()=>({...state.session}));
    assert.equal(first.conversation_mode,'chat');
    assert.equal(await page.evaluate(()=>runtimeOptions().file_permission),'none');
    assert.equal(await page.evaluate(()=>runtimeOptions().command_permission),'none');
    assert.equal(await page.evaluate(()=>shelfProject.hidden),true);
    await page.locator('.conversation-mode-picker>summary').click();
    await page.getByRole('button',{name:'Agent',exact:true}).click();
    await page.waitForFunction(()=>getConversationMode()==='agent'&&!conversationModeSaving);
    assert.equal(await page.evaluate(()=>shelfProject.hidden),false);
    assert.equal(await page.evaluate(async id=>(await api('/api/sessions')).find(s=>s.id===id).conversation_mode,first.id),'agent');
    await page.locator('.conversation-mode-picker>summary').click();
    await page.getByRole('button',{name:'Chat',exact:true}).click();
    await page.waitForFunction(()=>getConversationMode()==='chat'&&!conversationModeSaving);
    await page.reload();await page.waitForFunction(()=>state.session&&getConversationMode()==='chat');
    assert.equal(await page.locator('button[data-conversation-mode=chat]').getAttribute('aria-pressed'),'true');
    const http=require('node:http');
    const calls=[];
    const wire=http.createServer((request,response)=>{
      let raw='';request.on('data',chunk=>raw+=chunk);request.on('end',()=>{
        const payload=JSON.parse(raw);calls.push(payload);
        const last=payload.messages.findLast(message=>message.role==='user')?.content||'';
        const question={title:'安排学习计划',purpose:'question',blocks:[
          {id:'goal',type:'choices',title:'学习目标',items:[{id:'math',label:'数学'},{id:'english',label:'英语'}]},
          {id:'schedule',type:'form',fields:[{id:'hours',label:'每天时长',type:'number',min:1,max:8,default:'',required:true}]}]};
        const confirmation={title:'确认学习目标',purpose:'confirmation',blocks:[{id:'proposal',type:'text',text:'将根据选定目标继续整理计划。'}]};
        let message={role:'assistant',content:'已收到你的回答，可以继续。'};
        if(last==='制定学习计划'||last==='确认计划')message={role:'assistant',content:null,tool_calls:[{id:'ask',type:'function',function:{name:'render_iui',arguments:JSON.stringify(last==='确认计划'?confirmation:question)}}]};
        if(last==='越权测试')message={role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'private.txt'})}}]};
        const finish=()=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({model:'modes-mock',choices:[{message}]}));};
        if(last==='慢速任务')setTimeout(finish,1200);else finish();
      });
    });
    await new Promise(resolve=>wire.listen(0,'127.0.0.1',resolve));
    try{
      await page.evaluate(async base=>{
        state.settings=await api('/api/settings','PUT',{base_url:base,api_key:'fixture',model:'modes-mock',models:[{id:'modes-mock',tool_calling:true}],vendor:'generic',api_protocol:'chat',timeout:10});
        updateSettings();
      },'http://127.0.0.1:'+wire.address().port+'/v1');
      await page.locator('#chat-input').fill('制定学习计划');await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
      const question=page.locator('.intelligent-ui[data-iui-purpose=question]');
      await question.getByRole('heading',{name:'安排学习计划',exact:true}).waitFor();
      await page.waitForFunction(()=>!submitting&&!state.pending.size);
      assert.equal(calls.length,1);
      assert.ok(calls[0].tools.every(tool=>['render_iui','image_gen','generate_image','list_image_models','calculator','current_time'].includes(tool.function.name)));
      await question.getByRole('button',{name:'提交回答',exact:true}).click();
      await question.getByRole('alert').filter({hasText:'请选择选项或填写补充回答'}).waitFor();
      assert.equal(calls.length,1);
      await question.getByRole('radio',{name:'数学',exact:true}).check();
      await question.getByRole('spinbutton',{name:'每天时长',exact:false}).fill('2');
      await question.getByRole('textbox',{name:'补充回答',exact:true}).fill('周末可以多一点');
      await page.evaluate(()=>uploadFiles([new File(['仅作为草稿附件'],'draft.txt',{type:'text/plain'})]));
      await page.locator('#chat-input').fill('保留我的草稿');
      await question.getByRole('button',{name:'提交回答',exact:true}).click();
      await page.waitForFunction(()=>!submitting&&!state.pending.size&&state.messages.some(message=>message.role==='assistant'&&message.content.includes('已收到你的回答')));
      assert.equal(calls.length,2);
      assert.equal(await page.locator('#chat-input').inputValue(),'保留我的草稿');
      assert.equal(await page.evaluate(()=>pendingAttachments.length),1);
      assert.equal(calls[1].messages.findLast(message=>message.role==='user').content.includes('仅作为草稿附件'),false);
      await page.evaluate(()=>{pendingAttachments=[];attachmentDrafts.set(state.session.id,[]);renderAttachmentTray();});
      const reply=calls[1].messages.findLast(message=>message.role==='user').content;
      assert.ok(reply.includes('数学'));assert.ok(reply.includes('每天时长 = 2'));assert.ok(reply.includes('周末可以多一点'));
      await page.locator('#chat-input').fill('确认计划');await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
      const confirm=page.locator('.intelligent-ui[data-iui-purpose=confirmation]');
      await confirm.getByRole('button',{name:'取消',exact:true}).waitFor();await page.waitForFunction(()=>!submitting&&!state.pending.size);
      await confirm.getByRole('button',{name:'取消',exact:true}).click();
      await page.waitForFunction(()=>!submitting&&!state.pending.size&&state.messages.at(-1)?.content.includes('已收到你的回答'));
      assert.ok(calls.at(-1).messages.findLast(message=>message.role==='user').content.includes('决定 · 取消'));
      await page.locator('#chat-input').fill('确认计划');await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
      await page.waitForFunction(()=>!submitting&&!state.pending.size);
      const newest=page.locator('.intelligent-ui[data-iui-purpose=confirmation]').last();
      await newest.getByRole('button',{name:'确认并继续',exact:true}).click();
      await page.waitForFunction(()=>!submitting&&!state.pending.size&&state.messages.at(-1)?.content.includes('已收到你的回答'));
      assert.ok(calls.at(-1).messages.findLast(message=>message.role==='user').content.includes('决定 · 确认'));
      assert.equal(await page.evaluate(()=>runtimeOptions().file_permission),'none');
      assert.equal(await page.evaluate(()=>getConversationMode()),'chat');
      // A forged model tool call fails at the normal chat endpoint.
      const rejected=await page.evaluate(async()=>{
        try{await api('/api/sessions/'+state.session.id+'/chat','POST',{content:'越权测试',conversation_mode:'chat',allow_tools:true,file_permission:'all',command_permission:'all'});return false;}
        catch(error){return error.status===502;}
      });
      assert.equal(rejected,true);
      // Cancellation can be resumed only under the original conversation mode.
      const pending=await page.evaluate(async()=>{
        const session=await api('/api/sessions','POST',{title:'恢复隔离',conversation_mode:'chat'});await openSession(session);
        const key=crypto.randomUUID();
        const response=await fetch('/api/sessions/'+session.id+'/chat',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':state.token},body:JSON.stringify({content:'慢速任务',model:'modes-mock',conversation_mode:'chat',stream:true,request_id:key})});
        await api('/api/stream/'+key+'/cancel','POST',{});await response.text();
        await api('/api/sessions/'+session.id,'PATCH',{conversation_mode:'agent'});
        try{await api('/api/executions/'+key+'/resume','POST',{});return false;}catch(error){return error.status===409;}
      });
      assert.equal(pending,true);
      await page.evaluate(async session=>openSession((await api('/api/sessions')).find(item=>item.id===session.id)),first);
      const branch=await page.evaluate(async()=>api('/api/sessions/'+state.session.id+'/branch','POST',{}));
      assert.equal(branch.conversation_mode,'chat');
      await page.screenshot({path:path.join(root,'work/conversation-modes-desktop.png')});
      for(const width of [390,320]){
        await page.setViewportSize({width,height:844});
        assert.equal(await page.locator('#chat-form').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      }
      await page.screenshot({path:path.join(root,'work/conversation-modes-mobile.png')});
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({chat_default:true,mode_switch:true,mode_reload:true,chat_allowlist:true,question:true,confirmation:true,free_text:true,submit_continues_chat:true,preserved_draft:true,forged_tool_rejected:true,resume_mode_isolation:true,branch_mode:true,responsive:true,page_errors:errors}));
    }finally{await new Promise(resolve=>wire.close(resolve));}
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((resolve) =>
      server.exitCode !== null ? resolve() : server.once("exit", resolve),
    );
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
