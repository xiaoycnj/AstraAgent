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
   assert.deepEqual(errors,[]);console.log('PASS inline browser: generation and ordered candidates; gallery flight, focus, rapid reopen, zoom/pan, app/system reduced motion, and library fallback; screenshots in work/inline-image-*.png');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
