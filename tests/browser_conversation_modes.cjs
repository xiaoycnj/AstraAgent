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
  fs.mkdirSync(data, {recursive: true});
  fs.writeFileSync(path.join(data, 'settings.json'), '{}');
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
    const imageEdits=[];
    const imageGenerations=[];
    let releaseGeneration;
    const generationGate=new Promise(resolve=>{releaseGeneration=resolve;});
    const generatedImages=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');
      canvas.width=320;canvas.height=240;
      const context=canvas.getContext('2d');
      return [['#263a80','#9bbcff'],['#7e294d','#ffc391']].map(([background,foreground])=>{
        context.fillStyle=background;context.fillRect(0,0,320,240);
        context.fillStyle=foreground;context.beginPath();context.arc(160,120,80,0,Math.PI*2);context.fill();
        return canvas.toDataURL('image/png').split(',')[1];
      });
    });
    const editResult='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=';
    const wire=http.createServer((request,response)=>{
      const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{
        const raw=Buffer.concat(chunks);
        if(request.url.endsWith('/images/edits')){
          imageEdits.push(raw);
          response.writeHead(200,{'Content-Type':'application/json'});
          response.end(JSON.stringify({data:[{b64_json:editResult}]}));
          return;
        }
        if(request.url.endsWith('/images/generations')){
          imageGenerations.push(JSON.parse(raw));
          generationGate.then(()=>{
            response.writeHead(200,{'Content-Type':'application/json'});
            response.end(JSON.stringify({data:[{b64_json:generatedImages[(imageGenerations.length-1)%2]}]}));
          });
          return;
        }
        const payload=JSON.parse(raw);calls.push(payload);
        const user=payload.messages.findLast(message=>message.role==='user')?.content||'';
        const last=Array.isArray(user)?user.find(part=>part.type==='text')?.text||'':user;
        const question={title:'安排学习计划',purpose:'question',blocks:[
          {id:'goal',type:'choices',title:'学习目标',items:[{id:'math',label:'数学'},{id:'english',label:'英语'}]},
          {id:'schedule',type:'form',fields:[{id:'hours',label:'每天时长',type:'number',min:1,max:8,default:'',required:true}]}]};
        const confirmation={title:'确认学习目标',purpose:'confirmation',blocks:[{id:'proposal',type:'text',text:'将根据选定目标继续整理计划。'}]};
        let message={role:'assistant',content:'已收到你的回答，可以继续。'};
        if(last.startsWith('编辑后的提问'))message={role:'assistant',content:'## 先确认交付目标\n\n我会根据附件梳理信息，再把结果整理成一份可以继续修改的提纲。\n\n- **先核对资料**，标出已知条件和待确认项。\n- **再整理结构**，把关键结论放在开头。\n- **最后检查细节**，把引用与原始附件对应起来。'};
        if(last.includes('修改测试图像')&&!payload.messages.some(message=>message.role==='tool')){
          const file=last.match(/file=([a-f0-9]{32})/)?.[1],mask=last.match(/mask=([a-f0-9]{32})/)?.[1];
          message={role:'assistant',content:null,tool_calls:[{id:'image-edit',type:'function',function:{name:'image_gen',arguments:JSON.stringify({file,mask,prompt:'修改测试图像',model:'gpt-image-1'})}}]};
        }
        if(last.includes('生成两张候选测试图')){
          if(payload.messages.some(message=>message.role==='tool')){
            message={role:'assistant',content:'候选测试图已生成。'};
          }else{
            message={role:'assistant',content:null,tool_calls:[0,1].map(i=>({id:'image-generation-'+i,type:'function',function:{name:'image_gen',arguments:JSON.stringify({prompt:last+' '+i,model:'gpt-image-1'})}}))};
          }
        }
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
      const composer=page.locator('#chat-input');
      await composer.fill('使用@图片');
      assert.equal(await page.locator('#composer-command-menu').isVisible(),false);
      await page.locator('.conversation-mode-picker>summary').click();
      await page.getByRole('button',{name:'Agent',exact:true}).click();
      await page.waitForFunction(()=>getConversationMode()==='agent'&&!conversationModeSaving);
      await page.evaluate(()=>{allowTools.checked=true;});
      await composer.fill('使用@图片插件制作封面');
      await composer.evaluate(input=>{
        input.setSelectionRange('使用@图片'.length,'使用@图片'.length);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      await page.getByRole('option').filter({hasText:'图片生成'}).click();
      assert.equal(await composer.inputValue(),'使用[@图片生成]插件制作封面');
      await composer.press('End');
      await composer.press('Space');
      await composer.press('/');
      await page.getByRole('option').filter({hasText:'中文写作'}).waitFor();
      await composer.press('Escape');
      await composer.pressSequentially('writer');
      await composer.press('Enter');
      const taggedPrompt='使用[@图片生成]插件制作封面 [/中文写作]';
      assert.equal(await composer.inputValue(),taggedPrompt);
      const mirror=page.locator('.prompt-tag-mirror');
      await mirror.locator('.prompt-tag').first().waitFor();
      assert.deepEqual(await mirror.locator('.prompt-tag').allTextContents(),['[@图片生成]','[/中文写作]']);
      assert.equal(await mirror.locator('.prompt-tag').first().evaluate(node=>getComputedStyle(node).color),'rgb(23, 87, 173)');
      await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
      await page.waitForFunction(()=>!submitting&&!state.pending.size);
      const taggedCall=calls.at(-1);
      assert.equal(taggedCall.messages.findLast(message=>message.role==='user').content,taggedPrompt);
      const system=taggedCall.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
      assert.match(system,/\[@图片生成\] = 插件 image-generation/);
      assert.match(system,/遵循用户指定的用途、受众、语气、篇幅和格式/);
      assert.ok(taggedCall.tools.some(item=>item.function.name==='image_gen'));
      assert.equal(await page.locator('#messages .message.user').last().locator('.prompt-tag').count(),2);
      await composer.fill('普通后续消息');
      await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
      await page.waitForFunction(()=>!submitting&&!state.pending.size);
      const next=calls.at(-1);
      assert.equal(next.messages.findLast(message=>message.role==='user').content,'普通后续消息');
      assert.doesNotMatch(next.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n'),/\[@图片生成\] = 插件 image-generation/);
      const picture = await page.evaluate(async base => {
        await api('/api/providers','POST',{type:'image_api',name:'编辑测试',base_url:base,model:'gpt-image-1'});
        const canvas=document.createElement('canvas'); canvas.width=360; canvas.height=500;
        const context=canvas.getContext('2d');
        const gradient=context.createLinearGradient(0,0,360,500);
        gradient.addColorStop(0,'#18293d');gradient.addColorStop(1,'#6f82dc');
        context.fillStyle=gradient;context.fillRect(0,0,360,500);
        context.fillStyle='#fff';context.font='28px sans-serif';context.fillText('编辑测试',36,80);
        return api('/api/attachments','POST',{name:'测试原图.png',data:canvas.toDataURL().split(',')[1]});
      },'http://127.0.0.1:'+wire.address().port+'/v1');
      await page.evaluate(()=>newSession());
      await page.evaluate(()=>navigatePage('chat'));
      await page.waitForFunction(()=>getConversationMode()==='agent'&&!conversationModeSaving);
      await page.evaluate(()=>{allowTools.checked=true;});
      const generationSession=await page.evaluate(()=>state.session.id);
      await composer.fill('[@图片生成] 生成两张候选测试图');
      await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
      await page.locator('.image-generation-placeholder').waitFor({state:'visible'});
      assert.equal(await page.locator('.approval-dialog[open]').count(),0);
      releaseGeneration();
      await page.waitForFunction(()=>!submitting&&!state.pending.size&&state.messages.at(-1)?.generated_attachment_ids?.length===2);
      assert.equal(await page.locator('.image-candidate-thumb').count(),2);
      await page.reload();
      await page.waitForFunction(()=>state.messages.some(m=>m.generated_attachment_ids?.length===2));
      assert.equal(await page.locator('.image-candidate-thumb').count(),2);
      await page.evaluate(()=>newSession());
      assert.equal(await page.locator('.image-candidates').count(),0);
      await page.evaluate(async id=>openSession(state.sessions.find(s=>s.id===id)),generationSession);
      await page.locator('.image-candidate-thumb').nth(1).waitFor();
      await composer.fill('这个草稿应该保留');
      await page.evaluate(()=>uploadFiles([new File(['draft'],'edit-draft.txt',{type:'text/plain'})]));
      await page.evaluate(()=>navigatePage('images'));
      await page.getByRole('button',{name:'预览 测试原图.png',exact:true}).click();
      const preview=page.getByRole('dialog',{name:'图像工作台'});
      const canvas=preview.locator('.image-preview-plane canvas');
      await canvas.waitFor();
      await preview.getByRole('button',{name:'矩形',exact:true}).click();
      const bounds=await canvas.boundingBox();
      assert.ok(bounds.width>100&&bounds.height>100,bounds);
      await page.mouse.move(bounds.x+bounds.width*.2,bounds.y+bounds.height*.2);
      await page.mouse.down();
      await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.5,{steps:5});
      await page.mouse.up();
      const downloadEvent=page.waitForEvent('download');
      await preview.getByRole('button',{name:'导出标注',exact:true}).click();
      assert.equal((await downloadEvent).suggestedFilename(),'astra-annotated.png');
      await preview.getByRole('button',{name:'撤销标注',exact:true}).click();
      assert.equal(await preview.getByRole('button',{name:'重做标注',exact:true}).isEnabled(),true);
      await preview.getByRole('button',{name:'重做标注',exact:true}).click();
      await preview.locator('.image-preview-mask input').check();
      await preview.getByRole('textbox',{name:'图像修改说明'}).fill('修改测试图像');
      await page.screenshot({path:path.join(root,'work/image-preview-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await preview.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
      await page.screenshot({path:path.join(root,'work/image-preview-mobile.png')});
      await preview.getByRole('button',{name:'发送修改',exact:true}).click();
      assert.equal(await page.locator('.approval-dialog[open]').count(),0);
      await page.waitForFunction(()=>!submitting&&!state.pending.size&&(
        state.messages.some(message=>message.content.includes('修改测试图像')) ||
        (document.querySelector('.image-preview').open && document.querySelector('.image-preview-status').textContent &&
          !document.querySelector('.image-preview-status').textContent.includes('正在准备'))
      ),null,{timeout:12000}).catch(async error=>{
        const progress=await page.evaluate(()=>({submitting, pending:[...state.pending], mode:state.mode, appPage,
          status:document.querySelector('.image-preview-status').textContent,
          open:document.querySelector('.image-preview').open, error:document.querySelector('#chat-error').textContent,
          saved:state.messages.map(message=>[message.role,message.content.slice(0,100)])}));
        throw Error(JSON.stringify({progress,errors,edited:imageEdits.length,log:log.slice(-2500)})+' '+error.message);
      });
      assert.equal(await preview.isVisible(),false,await page.locator('.image-preview-status').textContent());
      const editCall=calls.find(call=>call.messages.some(message=>message.role==='user'&&Array.isArray(message.content)&&message.content[0].text?.includes('修改测试图像')));
      const editParts=editCall.messages.findLast(message=>message.role==='user').content;
      assert.match(editParts[0].text,new RegExp('file='+picture.id));
      assert.match(editParts[0].text,/mask=[a-f0-9]{32}/);
      assert.equal(editParts.filter(part=>part.type==='image_url').length,2);
      assert.equal(imageEdits.length,1);
      if (imageEdits[0][0] === 123) assert.match(JSON.parse(imageEdits[0]).mask.image_url,/^data:image\/png;base64,/);
      else assert.ok(imageEdits[0].includes('name="mask"; filename="mask.png"'));
      const pixels=await page.evaluate(async src=>{
        const mask=new Image();mask.src=src;await mask.decode();
        const canvas=document.createElement('canvas');canvas.width=mask.width;canvas.height=mask.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(mask,0,0);
        return [mask.width,mask.height,ctx.getImageData(125,150,1,1).data[3],ctx.getImageData(24,24,1,1).data[3]];
      },editParts.filter(part=>part.type==='image_url')[1].image_url.url);
      assert.deepEqual(pixels,[360,500,0,255]);
      assert.ok(await page.evaluate(async()=> (await api('/api/sessions/'+state.session.id+'/resources')).outputs.some(item=>item.kind==='image')));
      assert.equal(await page.evaluate(()=>appPage),'home');
      assert.equal(await composer.inputValue(),'这个草稿应该保留');
      assert.equal(await page.evaluate(()=>pendingAttachments.some(item=>item.name==='edit-draft.txt')),true);
      await page.evaluate(()=>newSession());
      const originalSession=await page.evaluate(()=>state.session.id);
      await page.evaluate(()=>uploadFiles([new File(['reference'],'branch-reference.txt',{type:'text/plain'})]));
      await composer.fill('分支测试原始提问');
      await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
      await page.waitForFunction(()=>!submitting&&!state.pending.size&&state.messages.at(-1)?.role==='assistant'&&state.messages.at(-1)?.id);
      await composer.fill('原会话未发送的草稿');
      const originalQuestion=page.locator('#messages .message.user').first();
      await originalQuestion.hover();
      await originalQuestion.getByRole('button',{name:'编辑提问',exact:true}).click();
      const revision=originalQuestion.getByRole('textbox',{name:'修改提问',exact:true});
      assert.equal(await revision.inputValue(),'分支测试原始提问');
      await revision.fill('编辑后的提问');
      await originalQuestion.getByRole('button',{name:'发送到新分支',exact:true}).click();
      await page.waitForFunction(original=>state.session.id!==original&&!submitting&&state.messages.at(-1)?.role==='assistant'&&state.messages.at(-1)?.id,originalSession);
      const edited=await page.evaluate(()=>({id:state.session.id,parent:state.session.parent_id,questions:state.messages.filter(m=>m.role==='user')}));
      assert.equal(edited.parent,originalSession);
      assert.equal(edited.questions[0].content,'编辑后的提问');
      assert.equal(JSON.parse(edited.questions[0].attachments).length,1);
      assert.equal(await composer.inputValue(),'');
      await composer.fill('编辑分支的独立草稿');
      const branchNav=page.getByRole('group',{name:'会话分支',exact:true});
      assert.equal(await branchNav.locator('.chat-branch-count').textContent(),'2 / 2');
      await branchNav.getByRole('button',{name:'上一会话分支',exact:true}).click();
      await page.waitForFunction(id=>state.session.id===id&&state.messages.at(-1)?.role==='assistant',originalSession);
      assert.equal(await composer.inputValue(),'原会话未发送的草稿');
      assert.equal(await originalQuestion.locator('.markdown').innerText(),'分支测试原始提问');
      await branchNav.getByRole('button',{name:'下一会话分支',exact:true}).click();
      await page.waitForFunction(id=>state.session.id===id&&state.messages.at(-1)?.role==='assistant',edited.id);
      assert.equal(await composer.inputValue(),'编辑分支的独立草稿');
      const revisedReply=page.locator('#messages .message.assistant').last();
      await revisedReply.hover();
      await revisedReply.getByRole('button',{name:'重新生成到新分支',exact:true}).click();
      await page.waitForFunction(id=>state.session.parent_id===id&&!submitting&&state.messages.at(-1)?.role==='assistant'&&state.messages.at(-1)?.id,edited.id);
      assert.equal(await branchNav.locator('.chat-branch-count').textContent(),'3 / 3');
      assert.equal(await originalQuestion.locator('.markdown').innerText(),'编辑后的提问');
      await page.locator('#messages .thinking-process').waitFor({state:'detached'});
      await page.setViewportSize({width:1440,height:1000});
      const geometry=await page.evaluate(()=>{
        const rect=selector=>document.querySelector(selector).getBoundingClientRect();
        const reply=rect('#messages .message.assistant'), composer=rect('#chat-form');
        const user=rect('#messages .message.user'), bubble=rect('#messages .message.user > .markdown');
        return {replyWidth:reply.width, composerWidth:composer.width, columnOffset:Math.abs(reply.left-composer.left),
          rightOffset:Math.abs(user.right-bubble.right), bubbleWidth:bubble.width};
      });
      assert.ok(geometry.replyWidth>=650&&Math.abs(geometry.replyWidth-geometry.composerWidth)<2&&geometry.columnOffset<2,JSON.stringify(geometry));
      assert.ok(geometry.rightOffset<2&&geometry.bubbleWidth<geometry.replyWidth,JSON.stringify(geometry));
      assert.equal(await originalQuestion.evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
      await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('show'));
      await page.screenshot({path:path.join(root,'work/conversation-modes-desktop.png')});
      await page.evaluate(()=>applyTheme('dark'));
      await page.screenshot({path:path.join(root,'work/chat-surface-dark.png')});
      await page.evaluate(()=>applyTheme('light'));
      for(const width of [390,320]){
        await page.setViewportSize({width,height:844});
        assert.equal(await page.locator('#chat-form').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
        const buttons=await page.evaluate(()=>{
          const sid=state.session.id;
          const send=document.querySelector('#send'), stop=document.querySelector('#stop-generation');
          const originalWidth=send.getBoundingClientRect().width;
          state.pending.add(sid);
          syncConversationStop();
          const form=document.querySelector('#chat-form').getBoundingClientRect();
          const box=stop.getBoundingClientRect();
          const active={width:box.width, height:box.height, originalWidth, text:stop.textContent,
            hiddenSend:send.hidden, label:stop.getAttribute('aria-label'),
            within:box.left>=form.left&&box.right<=form.right};
          conversationStopping.add(sid);
          syncConversationStop();
          const cancelling=stop.disabled&&stop.title==='正在停止…'&&stop.querySelector('svg path').textContent==='';
          state.pending.delete(sid);
          conversationStopping.delete(sid);
          syncConversationStop();
          return {...active,cancelling,restored:!send.hidden&&stop.hidden};
        });
        assert.equal(buttons.text,'');
        assert.equal(buttons.label,'停止生成');
        assert.equal(buttons.width,buttons.originalWidth);
        assert.equal(buttons.height,buttons.width);
        assert.ok(buttons.width>0&&buttons.within&&buttons.hiddenSend&&buttons.cancelling&&buttons.restored,JSON.stringify(buttons));
      }
      await page.screenshot({path:path.join(root,'work/conversation-modes-mobile.png')});
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({chat_default:true,mode_switch:true,mode_reload:true,chat_allowlist:true,question:true,confirmation:true,free_text:true,submit_continues_chat:true,preserved_draft:true,forged_tool_rejected:true,resume_mode_isolation:true,branch_mode:true,prompt_tags:true,inline_edit_branch:true,regenerated_branch:true,per_session_drafts:true,image_annotations:true,image_mask_edit:true,responsive:true,page_errors:errors}));
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
