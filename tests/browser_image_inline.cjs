/* Inline image view contract: isolated app, synthetic events, no upstream API. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'astra-inline-'));
 fs.writeFileSync(path.join(data,'settings.json'),'{}');
 const python=process.env.ASTRA_TEST_PYTHON||path.join(root,'runtimes/python/python.exe');
 const server=spawn(python,['-u','server.py','--port','0','--data-dir',data],{cwd:root,env:{...process.env,PYTHONUTF8:'1'},windowsHide:true});
 let log='',browser;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
 try{
  for(let i=0;i<100&&!/http:\/\/127\.0\.0\.1:\d+/.test(log);i++)await new Promise(r=>setTimeout(r,100));
  const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(url,log);
  const token=execFileSync(python,['-c','import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))',data],{cwd:root,windowsHide:true}).toString().trim();
  browser=await chromium.launch({headless:true,executablePath:process.env.ASTRA_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage({locale:'zh-CN',viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.previewVoiceMock={stopped:0};
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>new Promise(resolve=>{
    window.previewVoiceMock.allow=()=>resolve({getTracks:()=>[{stop:()=>window.previewVoiceMock.stopped++}]});
   })});
   window.MediaRecorder=class {
    static isTypeSupported(){return true;}
    constructor(stream,{mimeType}){this.state='inactive';this.mimeType=mimeType;}
    start(){this.state='recording';}
    stop(){this.state='inactive';queueMicrotask(()=>{
     this.ondataavailable?.({data:new Blob(['fixture'],{type:this.mimeType})});
     this.onstop?.();
    });}
   };
  });
  await page.route('**/api/attachments/*/content',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g"><stop stop-color="#556de8"/><stop offset="1" stop-color="#9ee2cf"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><circle cx="320" cy="240" r="100" fill="white" opacity=".3"/></svg>'}));
  await page.goto(url+'/#access='+token);
  await page.waitForFunction(()=>state.token&&typeof updateInlineImageRun==='function');
  await page.evaluate(async()=>{await newSession();window.imageTestDraft={role:'assistant',content:'',streaming:true};state.messages.push(window.imageTestDraft);updateInlineImageRun(window.imageTestDraft,{type:'tool_start',name:'generate_image',tool_call_id:'one'});updateInlineImageRun(window.imageTestDraft,{type:'tool_start',name:'generate_image',tool_call_id:'two'});renderMessages();});
  await page.locator('.image-generation-placeholder').waitFor({state:'visible'});
  assert.equal(await page.locator('.image-generation-particles i').count(),81);
  assert.match(await page.locator('.image-generation-label').innerText(),/2/);
  const out=path.join(root,'work');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'inline-image-pending.png')});
  await page.evaluate(()=>document.documentElement.dataset.motion='reduced');
  assert.equal(await page.locator('.image-generation-particles i').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.evaluate(()=>delete document.documentElement.dataset.motion);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.image-generation-particles i').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.evaluate(()=>{const a='a'.repeat(32),b='b'.repeat(32);for(const [tool_call_id,id] of [['one',a],['two',b]])updateInlineImageRun(window.imageTestDraft,{type:'tool',name:'generate_image',tool_call_id,result:{ok:true,attachment:{kind:'image',id}}});window.imageTestDraft.content=`![生成的图片](/api/attachments/${a}/content)`;renderMessages();});
  await page.locator('.image-candidate-thumb').nth(1).waitFor();
  assert.equal(await page.locator('.image-generation-placeholder').count(),0);
  assert.equal(await page.locator('.image-candidate-thumb').count(),2);
  await page.locator('.image-candidate-thumb').first().focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.image-candidate-thumb').nth(1).getAttribute('aria-pressed'),'true');
  await page.screenshot({path:path.join(out,'inline-image-candidates.png')});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(out,'inline-image-mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:320,height:740});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{updateInlineImageRun(window.imageTestDraft,{type:'tool_start',name:'image_gen',tool_call_id:'cancel'});updateInlineImageRun(window.imageTestDraft,{type:'cancelled'});renderMessages();});
  assert.equal(await page.locator('.image-generation-placeholder').count(),0);
  await page.evaluate(()=>{updateInlineImageRun(window.imageTestDraft,{type:'tool_start',name:'image_gen',tool_call_id:'failure'});updateInlineImageRun(window.imageTestDraft,{type:'tool',name:'image_gen',tool_call_id:'failure',result:{ok:false,error:'fixture failure'}});renderMessages();});
  assert.equal(await page.locator('.image-generation-placeholder').count(),0);
  assert.equal(await page.locator('.image-candidate-thumb').count(),2);
  await page.evaluate(()=>{updateInlineImageRun(window.imageTestDraft,{type:'step_reused',name:'image_gen',tool_call_id:'replayed',result:{ok:true,attachment:{kind:'image',id:'a'.repeat(32)}}});renderMessages();});
  assert.equal(await page.locator('.image-candidate-thumb').count(),2);
  const dialog=page.locator('dialog.image-preview'),photo=dialog.locator('.image-preview-flight');
   const liveImage=dialog.locator('.image-preview-plane img'),launcher=page.locator('.image-candidate-preview');
   const src=await launcher.locator('img').getAttribute('src');
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.setViewportSize({width:1280,height:900});
   await launcher.click();
   await photo.waitFor({state:'visible'});
   const opening=await photo.evaluate(node=>{
    const dialog=node.closest('dialog'),all=dialog.getAnimations({subtree:true});
    const animation=all.find(anim=>anim.id==='astra-gallery-photo');
    for(const anim of all.filter(anim=>anim.id.startsWith('astra-gallery-'))){anim.pause();anim.currentTime=80;}
    return {phase:dialog.dataset.galleryFlight,frames:animation.effect.getKeyframes(),
     filter:getComputedStyle(node).filter,opacity:getComputedStyle(node).opacity,
     scrimOpacity:getComputedStyle(dialog.querySelector('.image-preview-scrim')).opacity,
     sourceHidden:getComputedStyle(document.querySelector('.image-candidate-preview img')).visibility,
     active:document.activeElement.getAttribute('aria-label'),scale:getComputedStyle(dialog).scale};
   });
   assert.equal(opening.phase,'open');
   assert.notEqual(opening.frames[0].transform,opening.frames[1].transform);
   assert.equal(opening.filter,'none');assert.equal(opening.opacity,'1');
   assert.ok(Number(opening.scrimOpacity)>0&&Number(opening.scrimOpacity)<1);
   assert.equal(opening.sourceHidden,'hidden');assert.equal(opening.active,'关闭预览');assert.equal(opening.scale,'none');
   await page.screenshot({path:path.join(out,'inline-image-gallery-flight.png')});
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>document.querySelector('dialog.image-preview').dataset.galleryFlight==='close');
   assert.equal(await photo.count(),1);
   await dialog.waitFor({state:'hidden'});
   assert.equal(await launcher.evaluate(node=>node===document.activeElement),true);
   assert.equal(await photo.count(),0);
   assert.equal(await page.locator('.image-preview-origin').count(),0);

   // A new open must replace an in-progress return without an old animation closing it.
   await launcher.click();
   await photo.waitFor({state:'visible'});
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>document.querySelector('dialog.image-preview').dataset.galleryFlight==='close');
   await launcher.evaluate(node=>node.click());
   await photo.waitFor({state:'visible'});
   await photo.waitFor({state:'detached'});
   assert.equal(await dialog.evaluate(node=>node.open&&document.querySelectorAll('dialog.image-preview[open]').length===1),true);
   assert.equal(await liveImage.getAttribute('src'),url+src);
   await dialog.locator('select.image-preview-zoom').selectOption('3');
   const stage=dialog.locator('.image-preview-stage');
   assert.equal(await stage.evaluate(node=>node.scrollWidth>node.clientWidth&&node.scrollHeight>node.clientHeight),true);
   await stage.evaluate(node=>{node.scrollLeft=70;});
   assert.equal(await stage.evaluate(node=>node.scrollLeft),70);
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'hidden'});

   for(const reduction of ['app','system']){
    if(reduction==='app')await page.evaluate(()=>document.documentElement.dataset.motion='reduced');
    else{await page.evaluate(()=>delete document.documentElement.dataset.motion);await page.emulateMedia({reducedMotion:'reduce'});}
    await launcher.click();await liveImage.waitFor({state:'visible'});
    assert.equal(await dialog.evaluate(node=>node.getAnimations({subtree:true}).filter(anim=>anim.id.startsWith('astra-gallery-')).length),0);
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
   }
   await page.setViewportSize({width:1920,height:940});
   const referenceId='d'.repeat(32), referenceSrc=`/api/attachments/${referenceId}/content`;
   await page.route('**'+referenceSrc, route=>route.fulfill({contentType:'image/svg+xml',body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1036" height="812" viewBox="0 0 1036 812"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#7e8d9f"/><stop offset="1" stop-color="#e8b394"/></linearGradient></defs><path fill="url(#g)" d="M0 0h1036v812H0z"/><path fill="#acb7bf" d="m0 583 240-250 100 100 192-224 190 214 104-117 210 289v217H0z"/><path fill="#526269" d="m0 673 194-114 166 63 191-120 239 107 246-94v297H0z"/><path fill="#29373c" d="m0 727 231-58 165 71 160-48 161 55 319-88v153H0z"/></svg>'}));
   const titleBar=page.locator('.custom-titlebar');
   const titleClip={x:0,y:0,width:1920,height:Math.floor((await titleBar.boundingBox()).height)};
   const titleBefore=await page.screenshot({clip:titleClip});
   await page.evaluate(src=>openImagePreview([{src,alt:'构图测试.png'}]), referenceSrc);
   await liveImage.waitFor({state:'visible'});
   const geometry=await dialog.evaluate(node=>{
    const box=selector=>node.querySelector(selector).getBoundingClientRect().toJSON();
    return {viewer:node.getBoundingClientRect().toJSON(),photo:box('.image-preview-plane'),stage:box('.image-preview-stage'),
     edit:box('.image-preview-prompt'),header:box('.image-preview-header-tools'),scrim:box('.image-preview-scrim'),
     zoom:node.querySelector('.image-preview-zoom-wrap span').textContent};
   });
   for(const [actual,expected] of [[geometry.viewer.x,0],[geometry.viewer.y,titleClip.height],[geometry.scrim.y,titleClip.height],
     [geometry.photo.y,geometry.stage.y],[geometry.photo.height,geometry.stage.height],
     [geometry.edit.width,884],[geometry.header.height,44],[geometry.photo.x+geometry.photo.width/2,960]]){
    assert.ok(Math.abs(actual-expected)<=2,JSON.stringify(geometry));
   }
   assert.equal(geometry.zoom,`${Math.round(geometry.photo.height/812*100)}%`);
   assert.ok(titleBefore.equals(await page.screenshot({clip:titleClip})), 'preview must not paint over the titlebar');
   const surface=dialog.locator('.image-preview-prompt');
   assert.match(await surface.evaluate(node=>getComputedStyle(node).backdropFilter),/blur/);
   const cdp=await page.context().newCDPSession(page);
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'},{name:'prefers-reduced-motion',value:'reduce'}]});
   assert.equal(await surface.evaluate(node=>getComputedStyle(node).backdropFilter),'none');
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await dialog.locator('textarea').focus();
   await page.screenshot({path:path.join(out,'image-preview-reference-desktop.png')});
   const effortButton=dialog.getByRole('button',{name:'思考强度',exact:true});
   const effortPanel=dialog.locator('#reasoning-popover');
   const effortSlider=effortPanel.getByRole('slider',{name:'思考强度'});
   await effortButton.click();
   await effortSlider.waitFor({state:'visible'});
   await page.keyboard.press('End');
   assert.equal(await effortButton.innerText(),'最高');
   assert.equal(await page.evaluate(()=>runtimeOptions().reasoning),'max');
   assert.equal(await page.locator('#model-pill .model-strength').innerText(),'最高');
   await page.screenshot({path:path.join(out,'image-preview-reference-effort.png')});
   await effortButton.click();
   assert.equal(await effortButton.getAttribute('aria-expanded'),'false');
   await effortButton.click();
   await page.keyboard.press('Escape');
   assert.ok(await dialog.isVisible());
   assert.ok(await effortButton.evaluate(el=>el===document.activeElement));
   assert.equal(await page.locator('body > #reasoning-popover').count(),1);
   await dialog.getByRole('button',{name:'移除背景',exact:true}).click();
   assert.match(await dialog.locator('textarea').inputValue(),/移除背景/);
   const editPrompt=dialog.getByRole('textbox',{name:'图像修改说明'});
   const action=dialog.locator('.image-preview-prompt-actions .image-preview-submit');
   assert.equal(await dialog.locator('.image-preview-prompt-actions button').count(),2); // effort and one primary action
   assert.equal(await action.getAttribute('aria-label'),'发送修改');
   await editPrompt.fill('');
   await page.evaluate(()=>{sttSettings.base_url='https://example.invalid';sttSettings.model='fixture-stt';});
   let transcribe;
   await page.route('**/api/stt',async route=>{
    assert.equal(route.request().postDataJSON().data,Buffer.from('fixture').toString('base64'));
    await new Promise(resolve=>{transcribe=resolve;});
    await route.fulfill({json:{text:'降低高光'}});
   });
   await dialog.getByRole('button',{name:'语音输入修改说明',exact:true}).click();
   await dialog.getByRole('button',{name:'取消麦克风请求',exact:true}).waitFor();
   await page.evaluate(()=>window.previewVoiceMock.allow());
   await dialog.getByRole('button',{name:'结束录音',exact:true}).click();
   await dialog.getByRole('button',{name:'正在转写',exact:true}).waitFor();
   assert.equal(await action.getAttribute('aria-disabled'),'true');
   for(let n=0;!transcribe&&n<100;n++)await new Promise(resolve=>setTimeout(resolve,30));
   assert.ok(transcribe,'no STT request received');transcribe();
   await dialog.getByRole('button',{name:'发送修改',exact:true}).waitFor();
   assert.equal(await editPrompt.inputValue(),'降低高光');
   await dialog.getByRole('button',{name:'更多图像选项',exact:true}).click();
   await dialog.getByRole('button',{name:'追加语音输入',exact:true}).click();
   await dialog.getByRole('button',{name:'取消麦克风请求',exact:true}).waitFor();
   await page.evaluate(()=>window.previewVoiceMock.allow());
   await dialog.getByRole('button',{name:'结束录音',exact:true}).waitFor();
   await page.keyboard.press('Escape');
   await dialog.getByRole('button',{name:'发送修改',exact:true}).waitFor();
   assert.equal(await editPrompt.inputValue(),'降低高光');
   assert.equal(await page.evaluate(()=>window.previewVoiceMock.stopped),2);
   await editPrompt.fill('');
   await dialog.getByRole('button',{name:'调整大小',exact:true}).click();
   await dialog.getByRole('spinbutton',{name:'宽度',exact:true}).fill('192');
   await dialog.getByRole('spinbutton',{name:'高度',exact:true}).fill('128');
   const resized=page.waitForEvent('download');
   await dialog.getByRole('button',{name:'下载调整后的图像',exact:true}).click();
   const png=fs.readFileSync(await (await resized).path());
   assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[192,128]);
   await page.keyboard.press('Escape');
   await dialog.getByRole('button',{name:'标注',exact:true}).click();
   await page.screenshot({path:path.join(out,'image-preview-reference-annotate.png')});
   for(const width of [390,320]){
    await page.setViewportSize({width,height:740});
    assert.equal((await dialog.boundingBox()).y,(await titleBar.boundingBox()).height);
    for(const selector of ['.image-preview-header-tools','.image-preview-annotation-tools','.image-preview-prompt']){
     const bounds=await dialog.locator(selector).boundingBox();
     assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,JSON.stringify({selector,width,bounds}));
    }
   }
   await page.screenshot({path:path.join(out,'image-preview-reference-mobile.png')});
   await page.keyboard.press('Escape');
   await dialog.getByRole('button',{name:'标注',exact:true}).waitFor({state:'visible'});
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'hidden'});
   await page.locator('#model-pill').click();
   const chatEffort=page.locator('body > #reasoning-popover').getByRole('slider',{name:'思考强度'});
   assert.equal(await chatEffort.inputValue(),'7');
   await page.keyboard.press('ArrowLeft');
   await page.keyboard.press('Escape');
   await page.evaluate(src=>openImagePreview([{src}]),referenceSrc);
   await liveImage.waitFor({state:'visible'});
   assert.equal(await effortButton.innerText(),'超高');
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'hidden'});
   await page.evaluate(()=>useModel(AUTO_MODEL));
   await page.evaluate(src=>openImagePreview([{src}]),referenceSrc);
   await liveImage.waitFor({state:'visible'});
   await dialog.getByRole('button',{name:'最低模型强度',exact:true}).click();
   const routerSlider=effortPanel.getByRole('slider',{name:'最低模型强度'});
   assert.equal(await routerSlider.getAttribute('max'),'2');
   await page.keyboard.press('End');
   assert.equal(await page.evaluate(()=>runtimeOptions().auto_min_tier),'flagship');
   await page.keyboard.press('Escape');
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'hidden'});
   await page.setViewportSize({width:1280,height:900});
   await page.emulateMedia({reducedMotion:'no-preference'});
   const tallId='c'.repeat(32);
   await page.route('**/api/library',route=>route.fulfill({json:{items:[{kind:'image',name:'Gallery Test Image.png',size:1200,id:tallId}]}}));
   await page.route(`**/api/attachments/${tallId}/content`,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="1000"><rect width="320" height="1000" fill="#556de8"/></svg>'}));
   await page.evaluate(()=>navigatePage('library'));
   const asset=page.locator('.asset-preview');
   await asset.locator('img').evaluate(node=>node.decode());
   await asset.click();await photo.waitFor({state:'visible'});
   assert.equal(await asset.locator('img').evaluate(node=>node.classList.contains('image-preview-origin')),true);
   const crop=await photo.evaluate(node=>node.getAnimations().find(anim=>anim.id==='astra-gallery-photo').effect.getKeyframes()[0].clipPath);
   assert.match(crop,/^inset\([1-9]/);
   await photo.waitFor({state:'detached'});
   const fallback=await asset.evaluate(node=>{
    node.remove();
    const dialog=document.querySelector('dialog.image-preview');
    dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
    return dialog.getAnimations({subtree:true}).map(anim=>anim.id);
   });
   assert.ok(fallback.includes('astra-gallery-fallback'));
   assert.ok(!fallback.includes('astra-gallery-photo'));
   await dialog.waitFor({state:'hidden'});
   assert.equal(await photo.count(),0);
   assert.equal(await page.locator('.image-preview-origin').count(),0);
   assert.deepEqual(errors,[]);console.log('PASS inline browser: generation and candidates; gallery flight, safe area, responsive materials, mocked dictation, shared reasoning, annotation, zoom/pan, and focus.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
