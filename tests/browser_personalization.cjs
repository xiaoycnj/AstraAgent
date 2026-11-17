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



    await page.waitForFunction(() => typeof appearanceDraft !== 'undefined' && appearanceDraft && !appearanceControls.disabled);
    await page.evaluate(() => { showSettings(); selectSettingsTab('appearance'); });


    const advanced=page.locator('#advanced-appearance');
    await advanced.locator(':scope > summary').click();
    assert.equal(await page.locator('.appearance-setting-label').first().evaluate(node=>getComputedStyle(node).fontSize),'14px');
    assert.equal(await page.locator('.glass-variant span').first().evaluate(node=>getComputedStyle(node).fontSize),'12px');
    const material=advanced.getByRole('group',{name:'界面材质',exact:true});
    assert.equal(await material.count(),1);
    await material.getByRole('button',{name:'透彩玻璃',exact:true}).focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.material),'quiet');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.material),'glass');
    assert.equal(await page.locator('#theme-color-picker').evaluate(input=>input.parentElement.querySelector('output').value),'#8582B8');
    await advanced.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'work/advanced-appearance-light.png')});
    await advanced.locator(':scope > summary').click();
    const builtin = page.locator('#builtin-theme-styles');
    assert.equal(await builtin.locator('[data-builtin-style]').count(),3);
    const styles=[];
    for (const name of ['Anthropic','OpenAI','AstraAgent']) {
      await builtin.getByRole('button',{name,exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('[data-builtin-style]').disabled);
      const selected=await page.evaluate(()=>document.documentElement.dataset.uiStyle);
      for (const mode of ['light','dark']) {
        await page.evaluate(mode=>applyTheme(mode),mode);
        const values=await page.evaluate(()=>({
          style:document.documentElement.dataset.uiStyle,
          theme:document.documentElement.dataset.theme,
          surface:getComputedStyle(document.documentElement).getPropertyValue('--ui-panel-surface').trim(),
          background:getComputedStyle(document.body).backgroundColor,
          selection:getComputedStyle(document.querySelector('[data-settings-group=appearance]')).backgroundColor,
          selectionColor:getComputedStyle(document.querySelector('[data-settings-group=appearance]')).color
        }));
        assert.equal(values.theme,mode);
        if(name==='Anthropic')assert.equal(values.surface,mode==='light'?'#faf8f3':'#2c2823');
        if(name==='OpenAI')assert.equal(values.surface,mode==='light'?'#ffffff':'#212124');
        await page.screenshot({path:path.join(root,'work/theme-'+selected+'-'+mode+'.png')});
        styles.push(values);
      }
      assert.equal(await builtin.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
    }
    await builtin.getByRole('button',{name:'Anthropic',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-builtin-style]').disabled);
    await page.reload();
    await page.waitForFunction(()=>document.documentElement.dataset.uiStyle==='anthropic' && state.token && state.settings);
    await page.evaluate(()=>{showSettings();selectSettingsTab('appearance');});
    assert.equal(await builtin.getByRole('button',{name:'Anthropic',exact:true}).getAttribute('aria-pressed'),'true');

    await page.emulateMedia({colorScheme:'dark'});
    await page.evaluate(()=>applyTheme('system'));
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await page.emulateMedia({colorScheme:'light'});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.evaluate(async()=>{
      await marketReady;
      const skin=marketData.entries.find(entry=>entry.kind==='skin');
      previewMarketSkin(skin);
    });
    assert.equal(await builtin.locator('[aria-pressed=true]').count(),0);
    await page.evaluate(()=>cancelSkinPreview());
    await page.waitForFunction(()=>document.querySelector('[data-builtin-style=anthropic]').getAttribute('aria-pressed')==='true');
    await page.evaluate(async()=>applyMarketSkin(marketData.entries.find(entry=>entry.kind==='skin')));
    assert.equal(await builtin.locator('[aria-pressed=true]').count(),0);
    await builtin.getByRole('button',{name:'OpenAI',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-builtin-style]').disabled);
    assert.equal(await page.evaluate(()=>marketData.state.active_skin),null);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
    assert.equal(await page.evaluate(()=>themePreference),'system');
    assert.equal(await page.evaluate(()=>document.body.classList.contains('market-skin')),false);
    await builtin.getByRole('button',{name:'Anthropic',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-builtin-style]').disabled);
    await page.evaluate(()=>applyTheme('light'));
    await page.evaluate(async()=>{
      await newSession();
      state.messages=[{id:101,role:'user',content:'帮我整理一下今天的想法。'},{id:102,role:'assistant',content:'## 从一个想法开始\n\n先把最重要的事情写下来，再逐步展开。\n\n- 清晰的目标\n- 舒服的阅读节奏\n\nA calm space for your next idea.'}];
      renderMessages();
    });
    for(const name of ['Anthropic','OpenAI','AstraAgent']) {
      await page.evaluate(()=>{showSettings();selectSettingsTab('appearance');});
      await builtin.getByRole('button',{name,exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('[data-builtin-style]').disabled);
      await page.evaluate(()=>closeSettingsPage());
      await page.screenshot({path:path.join(root,'work/theme-chat-'+name+'.png')});
      const font=await page.locator('.message.assistant .markdown').evaluate(node=>getComputedStyle(node).fontFamily);
      if(name==='Anthropic')assert.ok(font.includes('Georgia'));
      if(name==='OpenAI')assert.ok(!font.includes('Georgia'));
      const bubble=await page.locator('.message.user').evaluate(node=>getComputedStyle(node).backgroundColor);
      if(name==='Anthropic')assert.equal(bubble,'rgb(234, 228, 217)');
      if(name==='OpenAI')assert.equal(bubble,'rgb(240, 240, 241)');
    }
    await page.evaluate(()=>{showSettings();selectSettingsTab('appearance');});
    await page.emulateMedia({reducedMotion:'no-preference'});
    const section = page.locator('#personalization-settings');
    await section.waitFor();
    const enabledLabel=section.getByRole('switch',{name:'启用自定义外观',exact:true});
    assert.equal(await enabledLabel.evaluate(input=>getComputedStyle(input.closest('label')).borderRadius),'0px');
    const blur=section.getByRole('slider',{name:'背景模糊',exact:true});
    await blur.focus();await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>appearanceDraft.background.blur===1);
    assert.equal(await blur.getAttribute('aria-valuetext'),'1 px');
    assert.equal(await blur.evaluate(input=>input.parentElement.querySelector('output').value),'1 px');
    await page.evaluate(async()=>{appearanceDraft.background.blur=0;changeAppearance();await flushAppearance();});
    for(const mode of ['light','dark']) {
      await page.evaluate(mode=>applyTheme(mode),mode);
      await advanced.evaluate(node=>node.open=true);
      await advanced.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(root,'work/advanced-appearance-'+mode+'.png')});
    }
    await page.evaluate(()=>applyTheme('light'));
    await advanced.evaluate(node=>node.open=false);
    for(const width of [880,650,390,320]) {
      await page.setViewportSize({width,height:900});
      await advanced.evaluate(node=>node.open=true);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const bounds=await advanced.locator('.appearance-setting-row').first().boundingBox();
      assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
      const toggleBounds=await advanced.getByRole('switch',{name:'点触光感',exact:true}).boundingBox();
      assert.ok(toggleBounds.x+toggleBounds.width<=width+1);
      if(width===390)await page.screenshot({path:path.join(root,'work/advanced-appearance-mobile.png')});
    }
    await page.setViewportSize({width:1440,height:1000});
    await advanced.evaluate(node=>node.open=false);

    const html = '<!doctype html><html><body style="margin:0;background:linear-gradient(130deg,#3758a7,#a48ae2);height:100vh"><h1 id="title">Wallpaper fixture</h1><script>window.ready=true;try{parent.document.body.dataset.wallpaperEscaped="yes"}catch(e){window.isolated=true}fetch("/api/settings").catch(()=>window.blocked=true)</script></body></html>';
    await page.locator('#personalization-settings input[type=file]').nth(0).setInputFiles({name:'wallpaper.html',mimeType:'text/html',buffer:Buffer.from(html)});
    await page.waitForFunction(() => appearanceDraft.background.asset?.endsWith('.html') && !appearanceControls.disabled);
    const wallpaperFrame = page.frameLocator('#personal-wallpaper iframe');
    await wallpaperFrame.locator('#title').waitFor({state:'attached'});
    const frame = page.frames().find(frame => frame.url().includes('/appearance-assets/'));
    await frame.waitForFunction(() => window.ready && window.isolated && window.blocked);
    assert.equal(await page.evaluate(() => document.body.dataset.wallpaperEscaped), undefined);
    const paused = section.getByRole('switch',{name:'暂停动态背景',exact:true});
    await paused.check();
    assert.equal(await page.locator('#personal-wallpaper iframe').getAttribute('src'),'about:blank');
    await paused.uncheck();
    await wallpaperFrame.locator('#title').waitFor({state:'attached'});

    await section.getByRole('textbox',{name:'对话框颜色',exact:true}).fill('#112233');
    await section.getByRole('textbox',{name:'输入框颜色',exact:true}).fill('#223344');
    await section.getByRole('textbox',{name:'文字颜色',exact:true}).fill('#ffffff');
    await section.getByRole('textbox',{name:'强调颜色',exact:true}).fill('#ff8811');
    await page.evaluate(async()=>{
      const input=appearanceFields.get('styles.message_radius');input.value='28';input.dispatchEvent(new Event('input',{bubbles:true}));
      await flushAppearance();
    });
    const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ff8811"/></svg>';
    await section.getByRole('combobox',{name:'图标位置',exact:true}).selectOption('home');
    await page.locator('#personalization-settings input[type=file]').nth(2).setInputFiles({name:'home.svg',mimeType:'image/svg+xml',buffer:Buffer.from(icon)});
    await page.waitForFunction(()=>appearanceDraft.icons.home && !appearanceControls.disabled);
    assert.equal(await page.locator('#nav-home > .personal-icon').count(),1);
    await page.evaluate(()=>{appearanceDraft.icons.send=appearanceDraft.icons.home;changeAppearance();});
    await page.evaluate(()=>{speechInput.value='Icon fixture';speechInput.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>document.querySelector('#send > .personal-icon'));
    await page.evaluate(()=>{speechInput.value='';speechInput.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>!document.querySelector('#send > .personal-icon'));
    const fontFile=path.join(root,'web/assets/fonts/katex/KaTeX_Main-Regular.woff2');
    assert.ok(fs.existsSync(fontFile));
    await builtin.getByRole('button',{name:'Anthropic',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-builtin-style]').disabled);
    await page.locator('#personalization-settings input[type=file]').nth(1).setInputFiles(fontFile);
    await page.waitForFunction(()=>appearanceFont && !appearanceControls.disabled);
    assert.ok((await page.locator('.message.assistant .markdown').evaluate(node=>getComputedStyle(node).fontFamily)).includes('AstraPersonalFont'));
    const exportEvent=page.waitForEvent('download');
    await section.getByRole('button',{name:'导出 ZIP 皮肤包',exact:true}).click();
    const exported=await exportEvent;
    const zipFile=await exported.path();
    assert.ok(fs.statSync(zipFile).size>100);
    const zipNames=execFileSync(python,['-c','import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).namelist())',zipFile],{cwd:root,windowsHide:true}).toString();
    assert.ok(zipNames.includes('astra-skin.json')&&zipNames.includes('.woff2')&&zipNames.includes('.html'));

    await section.getByRole('button',{name:'恢复默认外观',exact:true}).click();
    await page.waitForFunction(()=>!appearanceDraft.enabled);
    assert.equal(await page.locator('#personal-wallpaper iframe').count(),0);
    assert.equal(await page.locator('#nav-home > .personal-icon').count(),0);
    await page.locator('#personalization-settings input[type=file]').nth(3).setInputFiles({name:'skin.zip',mimeType:'application/zip',buffer:fs.readFileSync(zipFile)});
    await page.waitForFunction(()=>appearanceDraft.enabled&&appearanceDraft.icons.home&&!appearanceControls.disabled);
    assert.equal(await page.evaluate(()=>appearanceDraft.styles.message_radius),28);
    await page.reload();
    await page.waitForFunction(()=>appearanceDraft?.background.asset && appearanceDraft?.icons.home);
    assert.equal(await page.locator('#nav-home > .personal-icon').count(),1);
    await page.evaluate(()=>{
      state.messages=[{role:'user',content:'Personalized user message'},{role:'assistant',content:'## Personal appearance\n\nBackground, fonts, colors and icons.'}];renderMessages();
    });
    assert.equal(await page.locator('.message.assistant').evaluate(el=>getComputedStyle(el).borderRadius),'28px');
    assert.equal(await page.locator('.message.assistant').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 34, 51)');
    assert.equal(await page.locator('#chat-form').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 51, 68)');
    assert.equal(await page.locator('.message.user').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 34, 51)');
    assert.equal(await page.locator('.message.assistant .markdown').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
    await page.screenshot({path:path.join(root,'work/personalization-desktop.png')});

    const clip=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
      const context=canvas.getContext('2d');context.fillStyle='#ff8811';context.fillRect(0,0,160,90);
      const stream=canvas.captureStream(10);
      const mp4=MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42001E');
      const type=mp4?'video/mp4;codecs=avc1.42001E':'video/webm;codecs=vp8';
      const recorder=new MediaRecorder(stream,{mimeType:type}),chunks=[];
      recorder.ondataavailable=event=>chunks.push(event.data);
      const done=new Promise(resolve=>recorder.onstop=resolve);
      recorder.start();
      let frame=0;const timer=setInterval(()=>{context.fillStyle=frame++%2?'#ff8811':'#3377aa';context.fillRect(0,0,160,90);},60);
      await new Promise(resolve=>setTimeout(resolve,500));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(track=>track.stop());
      const blob=new Blob(chunks,{type}),name=mp4?'clip.mp4':'clip.webm';
      const saved=await sendAppearanceFile('/api/appearance/upload?name='+name,blob);
      appearanceDraft.background.asset=saved.id;appearanceDraft.background.paused=false;changeAppearance();await flushAppearance();
      return saved;
    });
    await page.waitForFunction(()=>document.querySelector('#personal-wallpaper video')?.readyState>=2).catch(async error=>{throw Error(error.message+' '+JSON.stringify(await page.locator('#personal-wallpaper video').evaluate(el=>({error:el.error?.message,ready:el.readyState,src:el.currentSrc,paused:el.paused})))+' '+JSON.stringify(clip))});
    assert.equal(await page.locator('#personal-wallpaper video').evaluate(el=>el.muted&&el.loop),true);
    const range=await page.request.get(url+'/appearance-assets/'+clip.id,{headers:{Range:'bytes=0-15'}});
    assert.equal(range.status(),206);assert.equal((await range.body()).length,16);
    const suffixRange=await page.request.get(url+'/appearance-assets/'+clip.id,{headers:{Range:'bytes=-8'}});
    assert.equal(suffixRange.status(),206);assert.equal((await suffixRange.body()).length,8);
    const invalidRange=await page.request.get(url+'/appearance-assets/'+clip.id,{headers:{Range:'bytes=99999999-'}});
    assert.equal(invalidRange.status(),416);
    const videoBytes=await (await page.request.get(url+'/appearance-assets/'+clip.id)).body();
    const largeUpload=await page.request.post(url+'/api/appearance/upload?name=large.'+clip.id.split('.').pop(),{
      headers:{'Content-Type':'application/octet-stream'}, data:Buffer.concat([videoBytes,Buffer.alloc(9*1024*1024)])
    });
    assert.equal(largeUpload.status(),201);
    assert.ok((await largeUpload.json()).size>8*1024*1024);
    const anonymous=await browser.newContext();
    assert.equal((await anonymous.request.get(url+'/api/appearance')).status(),403);
    await anonymous.close();
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({builtin_styles:styles.length,advanced_appearance:true,range_values:true,choice_keyboard:true,style_reload:true,system_theme:true,market_skin_switch:true,custom_font_priority:true,html_wallpaper:true,sandbox:true,pause_resume:true,skin_zip_roundtrip:true,font:true,icons:true,colors:true,reload_restore:true,video:clip.mime,byte_ranges:true,responsive:true,page_errors:errors}));
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
