/* Optional UI regression. Uses an installed Playwright and an isolated browser profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-security-ui-'));
  const data = path.join(folder, 'data');
  const python = process.env.ASTRA_TEST_PYTHON || path.join(root, 'runtimes/python/python.exe');
  const server = spawn(python, ['-u', path.join(root, 'server.py'), '--port', '0', '--data-dir', data], {
    cwd: root, env: {...process.env, PYTHONUTF8: '1'}, windowsHide: true
  });
  let log = '';
  server.stdout.on('data', chunk => log += chunk.toString());
  server.stderr.on('data', chunk => log += chunk.toString());
  let browser;
  try {
    for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+/.test(log); i++) {
      if (server.exitCode !== null) throw new Error('Test server exited');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, 'server ready');
    const token = execFileSync(python, ['-c', 'import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))', data], {cwd: root, windowsHide: true}).toString().trim();
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({headless: true, executablePath: process.env.ASTRA_TEST_BROWSER || (fs.existsSync(edge) ? edge : undefined)});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
    });
    assert.equal((await context.request.get(url + '/api/bootstrap')).status(), 403);
    await page.goto(url + '/#access=' + token);
    await page.waitForFunction(() => state.token && state.settings);
    assert.equal(await page.evaluate(() => location.hash), '');
    await page.waitForSelector('#nav-home');
    assert.equal(await page.locator('.rail-top .rail-button').count(),7);
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('#sidebar-toggle').click();
    await page.waitForTimeout(280);
    assert.equal(await page.locator('#conversation-sidebar').evaluate(el=>el.inert),true);
    assert.equal(await page.locator('#nav-home').isVisible(),true);
    await page.screenshot({path:path.join(root,'work/sidebar-collapsed.png')});
    await page.reload();
    await page.waitForSelector('#nav-home');
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'false');
    await page.keyboard.press('Control+Shift+S');
    await page.waitForTimeout(280);
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('#nav-images').click();
    await page.locator('.rail-collection[open]').waitFor();
    assert.equal(await page.locator('#nav-images').getAttribute('aria-current'),'page');
    await page.locator('.rail-collection header button').click();
    await page.locator('#nav-library').click();
    await page.locator('.rail-collection[open]').waitFor();
    await page.locator('.rail-collection header button').click();
    await page.locator('#nav-schedule').click();
    await page.locator('.hub-dialog[open]').waitFor();
    await page.locator('.hub-header button').click();
    await page.locator('#nav-more').click();
    assert.equal(await page.locator('.rail-menu').isVisible(),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.rail-menu').isVisible(),false);
    await page.locator('#nav-review').click();
    assert.equal(await page.locator('.workbench-drawer').isVisible(),true);
    await page.evaluate(()=>closeWorkbench());
    await page.locator('#nav-home').click();
    const navIcons=await page.locator('.app-rail img').evaluateAll(async imgs=>{await Promise.all(imgs.map(img=>img.decode()));return imgs.every(img=>img.naturalWidth>0)});
    assert.equal(navIcons,true);
    await page.screenshot({path:path.join(root,'work/composer-preview.png')});
    assert.equal(await page.locator('.desktop-menubar .app-menu').count(),4);
    assert.equal(await page.locator('.composer-shelf').count(),1);
    await page.locator('.starter-card').first().click();
    assert.ok(await page.locator('#chat-input').inputValue());
    await page.locator('.composer-options summary').click();
    assert.equal(await page.locator('#review-toggle').isVisible(),true);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{
      state.messages=[{id:1,role:'user',content:'请审阅这段代码，并说明验证步骤。'},{id:2,role:'assistant',content:'## 审阅结果\n\n可以先核对输入约束，再检查错误路径。\n\n- 保留现有调用方式\n- 修改后执行验证\n\n```python\ndef greet(name):\n    return f"Hello, {name}"\n```'}];
      renderMessages();
    });
    await page.screenshot({path:path.join(root,'work/dialogue-desktop.png')});
    await page.evaluate(()=>applyTheme('dark'));
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#nav-home').isVisible(),true);
    await page.locator('#sidebar-toggle').click();
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('.pane-backdrop').click({position:{x:290,y:350}});
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'false');
    await page.screenshot({path:path.join(root,'work/dialogue-mobile.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await page.locator('#send').isVisible(),true);
    assert.ok(await page.locator('#send').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
    assert.ok((await page.locator('#send').boundingBox()).y+40<=844);
    assert.ok((await page.locator('main').boundingBox()).height>=780);
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>applyTheme('light'));

    assert.equal(await page.evaluate(() => document.cookie.includes('astra_')), false);
    const markup = await page.evaluate(() => {
      const block = markdown('# 标题\n\n**Bold**\n\n$x^2+\\frac{1}{2}$\n\n```python\nprint("hello")\n```\n\n<span style="position:fixed;inset:0">ordinary text</span>');
      document.querySelector('#messages').replaceChildren(block);
      return {math: !!block.querySelector('.katex'), code: !!block.querySelector('.code-toolbar'),
        unsafe: !!block.querySelector('span[style*="position:fixed"]')};
    });
    assert.equal(markup.math, true);
    assert.equal(markup.code, true);
    assert.equal(markup.unsafe, false);
    await page.reload();
    await page.waitForFunction(() => state.token && state.settings);
    await page.click('#nav-settings');
    await page.evaluate(() => selectSettingsTab('general'));
    await page.getByRole('button', {name: '查看安全记录', exact: true}).click();
    await page.getByRole('heading', {name: '最近 200 条安全记录'}).waitFor();
    await page.getByRole('button', {name: '关闭', exact: true}).last().click();
    await page.evaluate(() => selectSettingsTab('connection'));
    await page.getByText('允许 HTTPS 私有网络接口（信任此服务商）', {exact: true}).waitFor();
    await page.evaluate(async()=>{
      await api('/api/providers','POST',{name:'Image fixture',type:'image_api',base_url:'http://127.0.0.1:9/v1',model:'gpt-image-1',models:[{id:'gpt-image-1',name:'Image'}]});
      await loadProviders();
      const provider=providerRows.find(row=>row.name==='Image fixture');
      expandProvider(provider.id,null,'edit');
    });
    assert.equal(await page.locator('#provider-type').inputValue(),'image_api');
    assert.equal(await page.locator('#provider-select option').evaluateAll(options=>options.some(option=>option.textContent==='Image fixture')),false);
    await page.evaluate(()=>providerDialog.close());
    const imageItem=await page.evaluate(async()=>await api('/api/attachments','POST',{name:'fixture.png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII='}));
    const imageRendered=await page.evaluate(item=>{const block=markdown('![result](/api/attachments/'+item.id+'/content)');return !!block.querySelector('img')},imageItem);
    assert.equal(imageRendered,true);
    await page.evaluate(item=>previewGeneratedImage(item),imageItem);
    await page.locator('.generated-image-dialog img').waitFor();
    await page.waitForFunction(()=>document.querySelector('.generated-image-dialog img')?.naturalWidth===1);
    await page.locator('.generated-image-dialog button').click();

    const violations = await page.evaluate(() => window.cspViolations);
    assert.deepEqual(errors, []);
    assert.deepEqual(violations, []);
    await page.screenshot({path: path.join(root, 'work/security-settings.png')});
    console.log(JSON.stringify({authenticated_boot: true, reload: true, math: true, code: true, audit_dialog: true, page_errors: errors, csp_violations: violations}));
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
    // This exact directory was created by mkdtemp for this test only.
    fs.rmSync(folder, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
