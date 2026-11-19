/* Desktop interaction regression using an isolated server and profile. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function renderedFonts(cdp, selector) {
  const {root: {nodeId}} = await cdp.send('DOM.getDocument');
  const {nodeId: target} = await cdp.send('DOM.querySelector', {nodeId, selector});
  assert.ok(target, selector);
  const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId: target});
  return fonts.filter(font => font.glyphCount > 0);
}

async function assertEditorialFont(cdp, selector) {
  const fonts = await renderedFonts(cdp, selector);
  assert.ok(fonts.length && fonts.every(font => font.isCustomFont && /Noto Serif SC/i.test(font.familyName)),
    `${selector}: ${JSON.stringify(fonts)}`);
}

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
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url + "/#access=" + token);
    await page.waitForFunction(
      () =>
        state.token &&
        state.settings &&
        document.querySelector(".command-launcher"),
    );



    const shellReady = () => state.token && state.settings && document.querySelector('.command-launcher');
    // Old boots wrote the default pair even without a user edit.
    await page.evaluate(() => localStorage.setItem('astra-colors', JSON.stringify({theme:'#8582b8',accent:'#77a1ff'})));
    await page.reload();
    await page.waitForFunction(shellReady);
    assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.uiStyle, localStorage.getItem('astra-colors')]), ['light-rainbow', null]);
    // An explicit edit keeps even the old preset values; it is not a migration candidate.
    await page.evaluate(() => localStorage.setItem('astra-colors', JSON.stringify({theme:'#8582b8',accent:'#77a1ff',custom:true})));
    await page.reload();
    await page.waitForFunction(shellReady);
    assert.equal(await page.locator('html').getAttribute('data-custom-colors'),'');
    assert.equal(await page.locator('#accent-color-picker').inputValue(),'#77a1ff');
    await page.waitForFunction(() => typeof appearanceDraft !== 'undefined' && appearanceDraft && !appearanceControls.disabled);
    const previewColors = await page.evaluate(async () => {
      await marketReady;
      const root = document.documentElement;
      const accent = () => getComputedStyle(root).getPropertyValue('--accent-color').trim();
      const before = accent();
      const saved = localStorage.getItem('astra-colors');
      const skin = marketData.entries.find(entry => entry.kind === 'skin');
      previewMarketSkin(skin);
      const previewed = document.body.classList.contains('market-skin');
      cancelSkinPreview();
      const restored = accent();
      showSettings();
      selectSettingsTab('appearance');
      return { before, previewed, restored, settings: accent(), unchanged: localStorage.getItem('astra-colors') === saved };
    });
    assert.deepEqual(previewColors,{before:'#77a1ff',previewed:true,restored:'#77a1ff',settings:'#77a1ff',unchanged:true});
    await page.evaluate(() => resetColors.click());
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-custom-colors'));
    assert.equal(await page.evaluate(() => localStorage.getItem('astra-colors')),null);


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
    await page.evaluate(() => applyTheme('light'));
    assert.equal(await page.locator('#theme-color-picker').evaluate(input=>input.parentElement.querySelector('output').value),'#D8CCF2');
    await advanced.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'work/advanced-appearance-light.png')});
    await advanced.locator(':scope > summary').click();
    const builtin = page.locator('#builtin-theme-styles');
    assert.equal(await builtin.locator('[data-builtin-style]').count(),6);
    assert.equal(await builtin.getByRole('button',{name:'LightRainbow',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>localStorage.getItem('astra-colors')),null);
    const styles=[];
    for (const name of ['LightRainbow','Anthropic','OpenAI','Fluent3','朱峰Agent','AstraAgent']) {
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
        if(name==='LightRainbow') {
          assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--blue').trim()),mode==='light'?'#5545ab':'#b7a9ff');
          assert.equal(await page.locator('#theme-color-picker').inputValue(),mode==='light'?'#d8ccf2':'#655689');
        }
        if(name==='Anthropic')assert.equal(values.surface,mode==='light'?'#f5f4ed':'#262623');
        if(name==='OpenAI')assert.equal(values.surface,mode==='light'?'#ffffff':'#212124');
        await page.screenshot({path:path.join(root,'work/theme-'+selected+'-'+mode+'.png')});
        styles.push(values);
      }
      assert.equal(await builtin.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
    }
    // Restart preserves each new layout and its scheme-specific preset colors.
    for (const [id, accent] of [['fluent3', '#60cdff'], ['zhufeng', '#85bee6']]) {
      const choice = builtin.locator(`[data-builtin-style=${id}]`);
      await choice.click();
      await page.waitForFunction(() => !document.querySelector('[data-builtin-style]').disabled);
      await page.reload();
      await page.waitForFunction(shellReady);
      assert.equal(await page.locator('html').getAttribute('data-ui-style'), id);
      assert.equal(await choice.getAttribute('aria-pressed'), 'true');
      await page.evaluate(() => applyTheme('dark'));
      assert.equal(await page.locator('#accent-color-picker').inputValue(), accent);
      await page.evaluate(async () => { await closeSettingsPage(); await newSession(); });
      for (const [mode, width, height] of [['light',1440,1000],['dark',1440,1000],['dark',390,844],['light',320,800]]) {
        await page.setViewportSize({width, height});
        await page.evaluate(mode => applyTheme(mode), mode);
        await page.locator('#chat-input').fill('主题布局测试');
        const overflow = await page.evaluate(() => {
          const messages = document.querySelector('#messages');
          return Math.max(document.documentElement.scrollWidth - innerWidth, messages.scrollWidth - messages.clientWidth);
        });
        assert.ok(overflow <= 1, `${id} ${width}: horizontal overflow ${overflow}px`);
        const composer = await page.locator('#chat-form').boundingBox();
        assert.ok(composer && composer.x >= 0 && composer.y >= 0 && composer.x + composer.width <= width + 1 && composer.y + composer.height <= height + 1,
          `${id} ${width}: ${JSON.stringify(composer)}`);
        if (id === 'fluent3') {
          const rail = await page.locator('.app-rail').boundingBox();
          assert.ok(width === 1440 ? rail.width >= 150 : rail.width < 80, JSON.stringify({width, rail}));
          const welcome = await page.locator('.welcome').evaluate(node => {
            const heading = node.querySelector('h1');
            const subtitle = node.querySelector(':scope > p');
            const cards = [...node.querySelectorAll('.starter-card')].map(card => card.getBoundingClientRect());
            return {left: [heading.getBoundingClientRect().left, subtitle.getBoundingClientRect().left, cards[0].left],
              align: [getComputedStyle(heading).textAlign, getComputedStyle(subtitle).textAlign],
              cardRows: new Set(cards.map(card => card.top)).size};
          });
          assert.ok(welcome.align.every(value => value === 'start' || value === 'left'), JSON.stringify(welcome));
          assert.ok(Math.max(...welcome.left) - Math.min(...welcome.left) <= 1, JSON.stringify(welcome));
          assert.equal(welcome.cardRows, width === 1440 ? 1 : 3);
        }
        await page.locator('#chat-input').clear();
        await page.locator('#chat-input').blur();
        await page.screenshot({path: path.join(root, `work/theme-${id}-home-${width === 1440 ? mode : width}.png`)});
      }
      await page.setViewportSize({width:1440,height:1000});
      await page.evaluate(() => { showSettings(); selectSettingsTab('appearance'); });
    }
    await builtin.getByRole('button',{name:'Anthropic',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-builtin-style]').disabled);

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
    await page.evaluate(async()=>{ closeSettingsPage(); await newSession(); });
    for (const [mode, width, height, label] of [
      ['light', 1440, 1000, 'light'], ['dark', 1440, 1000, 'dark'], ['dark', 390, 844, 'mobile'], ['light', 320, 800, 'small'],
    ]) {
      await page.setViewportSize({width, height});
      await page.evaluate(mode=>applyTheme(mode),mode);
      const view=await page.evaluate(()=>{
        const style=selector=>getComputedStyle(document.querySelector(selector));
        const area=document.querySelector('#messages');
        return {title:style('.welcome h1').fontFamily, action:style('#send').backgroundColor,
          panel:style('#app > main').backgroundColor, grid:style('.welcome .starter-grid').display, body:document.body.className,
          overflow: Math.max(document.documentElement.scrollWidth-innerWidth, area.scrollWidth-area.clientWidth)};
      });
      assert.match(view.title,/Astra Editorial Serif/);
      assert.equal(view.grid,'flex');
      await page.evaluate(() => document.fonts.ready);
      await assertEditorialFont(cdp, '.welcome h1');
      const [welcome, form] = await Promise.all([
        page.locator('.welcome').boundingBox(), page.locator('#chat-form').boundingBox(),
      ]);
      assert.ok(form.y - (welcome.y + welcome.height) >= 0 && form.y - (welcome.y + welcome.height) <= 32,
        JSON.stringify({welcome, form}));
      assert.equal(view.action,mode==='light'?'rgb(166, 77, 51)':'rgb(225, 147, 119)',JSON.stringify(view));
      assert.equal(view.panel,mode==='light'?'rgb(245, 244, 237)':'rgb(38, 38, 35)');
      assert.equal(view.overflow,0);
      await page.screenshot({path:path.join(root,'work/theme-anthropic-home-'+label+'.png')});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>applyTheme('light'));
    await page.evaluate(async()=>{
      await newSession();
      state.messages=[{id:101,role:'user',content:'帮我整理一下今天的想法。'},{id:102,role:'assistant',content:'## 从一个想法开始\n\n先把最重要的事情写下来，再逐步展开。\n\n- 清晰的目标\n- 舒服的阅读节奏\n\nA calm space for your next idea.'}];
      renderMessages();
    });
    for(const name of ['Anthropic','OpenAI','Fluent3','朱峰Agent','AstraAgent']) {
      await page.evaluate(()=>{showSettings();selectSettingsTab('appearance');});
      await builtin.getByRole('button',{name,exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('[data-builtin-style]').disabled);
      await page.evaluate(()=>closeSettingsPage());
      await page.screenshot({path:path.join(root,'work/theme-chat-'+name+'.png')});
      const font=await page.locator('.message.assistant .markdown').evaluate(node=>getComputedStyle(node).fontFamily);
      if(name==='Anthropic') {
        assert.match(font,/Astra Editorial Serif/);
        await page.evaluate(() => document.fonts.ready);
        await assertEditorialFont(cdp, '.message.assistant .markdown h2');
        await assertEditorialFont(cdp, '.message.assistant .markdown p:first-of-type');
        await assertEditorialFont(cdp, '.message.assistant .markdown p:last-of-type');
      }
      if(name==='OpenAI')assert.ok(!font.includes('Astra Editorial Serif'));
      const bubble=await page.locator('.message.user > .markdown').evaluate(node=>getComputedStyle(node).backgroundColor);
      if(name==='Anthropic')assert.equal(bubble,'rgb(235, 233, 223)');
      if(name==='OpenAI')assert.equal(bubble,'rgb(240, 240, 241)');
      if (name === '朱峰Agent') {
        const card = page.locator('#messages > .message.assistant');
        assert.deepEqual(await card.evaluate(node => {
          const style = getComputedStyle(node);
          return [style.backgroundColor, style.outlineStyle];
        }), ['rgba(0, 0, 0, 0)', 'none']);
        await page.setViewportSize({width:1279,height:719});
        const geometry = await page.evaluate(() => {
          const bounds = selector => document.querySelector(selector).getBoundingClientRect();
          return {
            rail: bounds('.app-rail').width, pane: bounds('#conversation-sidebar').width,
            title: bounds('.topbar').height, reading: bounds('.message.assistant').width,
            composer: bounds('#chat-form').width, rightInset: bounds('#chat-form').right - bounds('#send').right,
          };
        });
        assert.deepEqual(geometry, {rail:46,pane:233,title:37,reading:812,composer:834,rightInset:12});
        const group = page.locator('#item-list .session-group').first();
        await group.locator('summary').press('Space');
        assert.equal(await group.locator('.list-item').first().isVisible(), false);
        await group.locator('summary').press('Enter');
        assert.equal(await group.locator('.list-item').first().isVisible(), true);
        await group.locator('summary').blur();
        const wallpaperFixture = await page.evaluate(async () => {
          await appearanceReady;
          const previous = structuredClone(appearanceDraft);
          const image = document.createElement('canvas');
          image.width = 1280;
          image.height = 720;
          const context = image.getContext('2d');
          const wash = context.createLinearGradient(0, 0, 1280, 720);
          wash.addColorStop(0, '#2b3c55');
          wash.addColorStop(.58, '#6f8da7');
          wash.addColorStop(1, '#3a435d');
          context.fillStyle = wash;
          context.fillRect(0, 0, image.width, image.height);
          for (let index = 0; index < 11; index++) {
            context.beginPath();
            context.ellipse(650, 400, 570 - index * 19, 188 + index * 8, -.34, 0, Math.PI * 2);
            context.strokeStyle = index % 3 ? '#bce8fc' : '#f4d5ae';
            context.lineWidth = index % 3 ? 2 : 13;
            context.stroke();
          }
          const blob = await new Promise(resolve => image.toBlob(resolve, 'image/png'));
          const asset = await sendAppearanceFile('/api/appearance/upload?name=zhufeng-test.png', blob);
          appearanceDraft.enabled = true;
          Object.assign(appearanceDraft.background, {asset: asset.id, opacity: 1});
          appearanceDraft.styles.composer_radius = 17;
          applyPersonalAppearance();
          await document.querySelector('#personal-wallpaper img').decode();
          return previous;
        });
        assert.equal(await card.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
        for (const mode of ['light', 'dark']) {
          await page.evaluate(mode => applyTheme(mode), mode);
          await page.screenshot({path:path.join(root,`work/theme-zhufeng-conversation-${mode}.png`)});
        }
        await page.evaluate(previous => { appearanceDraft = previous; applyPersonalAppearance(); applyTheme('light'); }, wallpaperFixture);
        const previousChat = await page.evaluate(() => ({id: state.session.id, messages: state.messages}));
        await page.locator('.zhufeng-new-chat').click();
        await page.waitForFunction(previous => state.session?.id !== previous, previousChat.id);
        await page.evaluate(async ({id, messages}) => {
          await openSession(state.sessions.find(item => item.id === id));
          state.messages = messages;
          renderMessages();
        }, previousChat);
        await page.setViewportSize({width:1440,height:1000});
        const rail = page.getByRole('navigation', {name: '主导航'});
        await rail.getByRole('button', {name: '更多', exact: true}).click();
        await page.getByRole('menuitem', {name: '无限画布', exact: true}).click();
        const canvas = page.locator('#canvas-view');
        await canvas.getByRole('button', {name: '新建空白画布', exact: true}).click();
        await page.locator('.app-dialog').getByRole('button', {name:'确认', exact:true}).click();
        await canvas.getByRole('button', {name: '添加第一张便签', exact: true}).click();
        await canvas.locator('#node-title').fill('产品构思');
        await canvas.locator('#node-content').fill('先把最重要的事情写下来，再逐步展开。');
        await canvas.locator('.canvas-toolbar [data-add=document]').click();
        await canvas.locator('#node-title').fill('下一步计划');
        await canvas.locator('#node-content').fill('整理目标、约束和验收标准。');
        await canvas.locator('#fit').click();
        await page.evaluate(() => applyTheme('dark'));
        const grid = await canvas.locator('.viewport').evaluate(node => {
          const style = getComputedStyle(node);
          return {image: style.backgroundImage, size: style.backgroundSize, scale: state.scale};
        });
        assert.match(grid.image, /^linear-gradient/);
        assert.ok(grid.size.split(' ').every(size => Math.abs(parseFloat(size) - 22 * grid.scale) < 0.01), JSON.stringify(grid));
        assert.equal(await canvas.locator('.node.selected').evaluate(node => getComputedStyle(node).outlineColor), 'rgb(133, 190, 230)');
        await page.screenshot({path: path.join(root, 'work/theme-zhufeng-canvas-dark.png')});
        await rail.getByRole('button', {name: '主页', exact: true}).click();
        await page.locator('#chat-view').waitFor();
        await page.evaluate(() => applyTheme('light'));
      }
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
    const wallpaperUrl = frame.url();
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
    assert.equal(await page.evaluate(()=>appearanceDraft.enabled),true);
    await page.locator('#nav-home > .personal-icon').waitFor({state:'attached'});
    await page.evaluate(()=>{
      state.messages=[{role:'user',content:'Personalized user message'},{role:'assistant',content:'## Personal appearance\n\nBackground, fonts, colors and icons.'}];renderMessages();
    });
    assert.equal(await page.locator('.message.assistant').evaluate(el=>getComputedStyle(el).borderRadius),'28px');
    assert.equal(await page.locator('.message.assistant').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 34, 51)');
    assert.equal(await page.locator('#chat-form').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 51, 68)');
    assert.equal(await page.locator('.message.user > .markdown').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 34, 51)');
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
    const videoResponse=await page.request.get(url+'/appearance-assets/'+clip.id);
    assert.equal(videoResponse.status(),200);
    assert.equal(videoResponse.headers()['cache-control'],'private, no-store');
    const videoBytes=await videoResponse.body();
    const largeUpload=await page.request.post(url+'/api/appearance/upload?name=large.'+clip.id.split('.').pop(),{
      headers:{'Content-Type':'application/octet-stream'}, data:Buffer.concat([videoBytes,Buffer.alloc(9*1024*1024)])
    });
    assert.equal(largeUpload.status(),201);
    assert.ok((await largeUpload.json()).size>8*1024*1024);
    const anonymous=await browser.newContext();
    assert.equal((await anonymous.request.get(url+'/api/appearance')).status(),403);
    assert.equal((await anonymous.request.get(url+'/appearance-assets/'+clip.id)).status(),403);
    assert.equal((await anonymous.request.get(wallpaperUrl)).status(),403);
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
