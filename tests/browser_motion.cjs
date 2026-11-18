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


    const stable = await page.evaluate(async () => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      state.session = {id: 'motion-fixture', title: 'Motion'};
      state.messages = Array.from({length: 24}, (_, index) => ({id: index + 1, role: index % 2 ? 'assistant' : 'user', content: ('历史消息 ' + index + '\n\n正文保留阅读位置。').repeat(5)}));
      renderMessages(); await settle();
      const history = document.querySelector('#messages > .message:nth-child(6)');
      const list = document.querySelector('#messages');
      list.scrollTop = 360;
      list.dispatchEvent(new WheelEvent('wheel', {deltaY: -120}));
      list.dispatchEvent(new Event('scroll'));
      await settle();
      const before = history.getBoundingClientRect().top;
      const draft = {role: 'assistant', content: '# 正在生成\n\n第一段', streaming: true};
      state.messages.push(draft); state.pending.add(state.session.id);
      renderMessages(); await settle();
      draft.content += '\n\n```python\nprint(42)\n```';
      renderMessages(); await settle();
      const during = history === list.querySelector(':scope > .message:nth-child(6)');
      const streamNode = list.querySelector(':scope > .message:last-of-type');
      const streamBody = streamNode.querySelector('.markdown');
      const input = document.createElement('input'); input.value = '保留交互状态'; streamBody.append(input);
      const copy = history.querySelector('button'); copy.focus({preventScroll:true});
      state.messages = state.messages.map((message, index) => ({...message, id: index + 1, streaming: false}));
      state.pending.delete(state.session.id);
      renderMessages(); await settle();
      const after = list.querySelector(':scope > .message:nth-child(6)');
      const result = {during, completed: history === after, drift: Math.abs(after.getBoundingClientRect().top - before), animation: getComputedStyle(after).animationName, focus: copy === document.activeElement, body: streamBody === streamNode.querySelector('.markdown'), value: input.isConnected && input.value};
      return result;
    });
    console.log(JSON.stringify({stable}));
    assert.equal(stable.during, true, 'history nodes survive stream start');
    assert.equal(stable.completed, true, 'history nodes survive completion');
    assert.ok(stable.drift < 2, 'history reading position remains stable');
    assert.equal(stable.animation, 'none', 'historical messages do not replay entrance animations');
    assert.equal(stable.focus, true);
    assert.equal(stable.body, true);
    assert.equal(stable.value, '保留交互状态');
    const scrolling = await page.evaluate(async () => {
      const settle = async () => {for(let i=0;i<4;i++) await new Promise(requestAnimationFrame);};
      state.session = {id: 'following-fixture', title: 'Follow'};
      const draft = {role: 'assistant', content: ('第一段\n\n正文。\n\n').repeat(70), streaming: true};
      state.messages = [draft]; state.pending.add(state.session.id);
      renderMessages(); await settle();
      const list = document.querySelector('#messages');
      let maximumGap = 0;
      for(let i=0;i<12;i++) {
        draft.content += ('批次 ' + i + '\n\n新增正文。\n\n').repeat(10);
        renderMessages(); await settle();
        maximumGap = Math.max(maximumGap, list.scrollHeight - list.clientHeight - list.scrollTop);
      }
      list.dispatchEvent(new WheelEvent('wheel',{deltaY:-10}));
      list.scrollTop -= 10; list.dispatchEvent(new Event('scroll')); await settle();
      const top = list.scrollTop;
      const latest = document.querySelector('.conversation-latest');
      const latestVisible = !latest.hidden;
      draft.content += ('继续生成，不移动历史阅读位置。\n\n').repeat(30);
      renderMessages(); await settle();
      const paused = Math.abs(list.scrollTop-top);
      latest.click(); await settle();
      const resumed = list.scrollHeight - list.clientHeight - list.scrollTop;
      state.messages = state.messages.map(message=>({...message, id:999, streaming:false}));
      state.pending.clear(); renderMessages(); await settle();
      const completed = list.scrollHeight - list.clientHeight - list.scrollTop;
      return {maximumGap, paused, latestVisible, resumed, completed};
    });
    assert.ok(scrolling.maximumGap < 2, JSON.stringify(scrolling));
    assert.ok(scrolling.paused < 2, JSON.stringify(scrolling));
    assert.equal(scrolling.latestVisible, true, 'a small upward scroll offers a visible return action');
    assert.ok(scrolling.resumed < 2 && scrolling.completed < 2, JSON.stringify(scrolling));

    const resize = await page.evaluate(async () => {
      const settle = async () => {for(let i=0;i<5;i++) await new Promise(requestAnimationFrame);};
      state.session = {id:'resize-fixture'};
      state.messages = Array.from({length:20},(_,index)=>({id:index+1,role:'assistant',content:('消息 '+index+'\n\n正文\n\n').repeat(3)}));
      renderMessages(); await settle();
      const list=document.querySelector('#messages');
      list.dispatchEvent(new WheelEvent('wheel',{deltaY:-100})); list.scrollTop=500; list.dispatchEvent(new Event('scroll')); await settle();
      const anchor=[...list.querySelectorAll(':scope > .message')].find(node=>node.getBoundingClientRect().bottom>list.getBoundingClientRect().top);
      const before=anchor.getBoundingClientRect().top;
      const media=document.createElement('div');media.style.height='160px';list.firstElementChild.prepend(media);
      await settle();
      return Math.abs(anchor.getBoundingClientRect().top-before);
    });
    assert.ok(resize<2, 'asynchronous content resize preserves the visible anchor');

    const inlineResize = await page.evaluate(async () => {
      const settle = async () => {for(let i=0;i<5;i++) await new Promise(requestAnimationFrame);};
      state.session={id:'inline-resize'};
      state.messages=[{id:1,role:'assistant',content:Array.from({length:80},(_,i)=>'段落 '+i+'。阅读中的内容。').join('\n\n')}];
      renderMessages(); await settle();
      const list=document.querySelector('#messages');
      list.dispatchEvent(new WheelEvent('wheel',{deltaY:-100}));list.scrollTop=600;list.dispatchEvent(new Event('scroll'));await settle();
      const anchor=[...list.querySelectorAll('.markdown > p')].find(node=>node.getBoundingClientRect().bottom>list.getBoundingClientRect().top);
      const before=anchor.getBoundingClientRect().top;
      const media=document.createElement('div');media.style.height='160px';list.querySelector('.markdown').prepend(media);
      await settle();return Math.abs(anchor.getBoundingClientRect().top-before);
    });
    assert.ok(inlineResize<2,'content growth inside a long message preserves the visible paragraph');
    const hiddenReading = await page.evaluate(async () => {
      const settle = async () => {for(let i=0;i<5;i++) await new Promise(requestAnimationFrame);};
      const list = document.querySelector('#messages'), chat = document.querySelector('#chat-view');
      const before = list.scrollTop;
      chat.hidden = true; renderMessages(); await settle();
      chat.hidden = false; await settle();
      return Math.abs(list.scrollTop-before);
    });
    assert.ok(hiddenReading < 2, 'hidden chat retains its reading anchor');
    const audit = await page.evaluate(() => {
      const controls=[...document.querySelectorAll('button,summary,a[href],input:not([type=hidden]),textarea,select')].filter(node=>!node.closest('.CodeMirror'));
      const missing=controls.filter(node=>getComputedStyle(node).transitionDuration.split(',').every(value=>parseFloat(value)===0));
      return {controls:controls.length,missing:missing.map(node=>node.id||node.className||node.tagName)};
    });
    assert.deepEqual(audit.missing, [], JSON.stringify(audit));
    const destinationEnter = await page.evaluate(async () => {
      const navigation = navigatePage('library');
      await new Promise(requestAnimationFrame);
      const animated = document.querySelector('#destination-page').getAnimations().some(animation => animation.id === 'astra-enter');
      await navigation;
      return animated;
    });
    assert.equal(destinationEnter, true, 'workspace destinations use the page transition');
    await page.evaluate(() => navigatePage('home'));
    await page.locator('#nav-settings').click();
    await page.waitForTimeout(250);
    await page.evaluate(()=>selectSettingsTab('appearance'));
    await page.waitForTimeout(250);
    const enter = await page.evaluate(async () => {
      selectSettingsTab('general');
      await new Promise(requestAnimationFrame);
      return document.querySelector('[data-panel=general]').getAnimations().some(animation=>animation.id==='astra-enter');
    });
    assert.equal(enter, true, 'settings panel has one entry animation');
    await page.evaluate(()=>{appConfirm('检查全局弹窗动效');});
    await page.locator('dialog[open]').waitFor();
    assert.ok(await page.locator('dialog[open]').evaluate(node=>getComputedStyle(node).transitionProperty.includes('opacity')));
    assert.ok(await page.locator('dialog[open]').evaluate(node=>node.getAnimations().some(animation=>animation.transitionProperty==='opacity')));
    await page.keyboard.press('Escape');
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced = await page.evaluate(async () => {
      selectSettingsTab('appearance');
      await new Promise(requestAnimationFrame);
      return {animations:document.getAnimations().filter(animation=>animation.id==='astra-enter').length, duration:getComputedStyle(document.querySelector('#settings-close')).transitionDuration, backdrop:getComputedStyle(document.querySelector('.interactive-preview'),'::backdrop').transitionDuration};
    });
    assert.equal(reduced.animations,0);
    assert.equal(parseFloat(reduced.duration),0);
    assert.equal(parseFloat(reduced.backdrop),0);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{document.documentElement.dataset.motion='reduced'; selectSettingsTab('general');});
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(()=>document.getAnimations().filter(animation=>animation.id==='astra-enter').length),0);
    await page.evaluate(()=>{document.documentElement.dataset.motion='full';});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(root,'work/motion-mobile.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    console.log(JSON.stringify({scrolling,resize,inlineResize,hiddenReading,audit,reduced}));
    assert.deepEqual(errors, []);
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
