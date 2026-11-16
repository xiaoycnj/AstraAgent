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
    const section = page.locator('#personalization-settings');
    await section.waitFor();
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
    await page.locator('#personalization-settings input[type=file]').nth(1).setInputFiles(fontFile);
    await page.waitForFunction(()=>appearanceFont && !appearanceControls.disabled);
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
    console.log(JSON.stringify({html_wallpaper:true,sandbox:true,pause_resume:true,skin_zip_roundtrip:true,font:true,icons:true,colors:true,reload_restore:true,video:clip.mime,byte_ranges:true,responsive:true,page_errors:errors}));
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
