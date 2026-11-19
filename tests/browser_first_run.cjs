const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-first-run-'));
  const python = process.env.ASTRA_TEST_PYTHON || path.join(root, 'runtimes/python/python.exe');
  const server = spawn(python, ['-u', 'server.py', '--port', '0', '--data-dir', data], {
    cwd: root, windowsHide: true, env: {...process.env, PYTHONUTF8: '1'},
  });
  const closed = new Promise(resolve => server.once('close', resolve));
  let browser, log = '';
  server.on('error', error => { log += error.message; });
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
  try {
    const address = /http:\/\/127\.0\.0\.1:\d+/;
    for (let i = 0; i < 100 && !address.test(log); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const url = log.match(address)?.[0];
    assert.ok(url, log);
    const token = execFileSync(python, ['-c',
      'import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))', data],
    {cwd: root, windowsHide: true, encoding: 'utf8'}).trim();
    browser = await chromium.launch({headless: true, executablePath: process.env.ASTRA_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    const animated = await browser.newPage({locale: 'zh-CN', reducedMotion: 'no-preference', viewport: {width: 1000, height: 650}});
    await animated.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => { window.startupDomReady = performance.now(); }, {once: true});
    });
    await animated.goto(url + '/?desktop-loading=1#access=' + token, {waitUntil:'domcontentloaded'});
    const movement = await animated.locator('#workspace-loading').evaluate(async loader => {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const icon = loader.querySelector('.loading-brand img');
      const title = loader.querySelector('.loading-brand strong');
      const field = loader.querySelector('.loading-particles');
      const sample = () => [getComputedStyle(icon).transform, getComputedStyle(title).transform,
        getComputedStyle(field, '::before').transform, getComputedStyle(field, '::after').transform];
      await frames();
      const first = sample();
      await new Promise(resolve => setTimeout(resolve, 180));
      await frames();
      const second = sample();
      return {stage:document.documentElement.dataset.workspaceLoading,
        logo:first[0] !== second[0], wordmark:first[1] !== second[1],
        particles:first[2] !== second[2] && first[3] !== second[3], depth:second[2] !== second[3],
        first, second, names:[getComputedStyle(icon).animationName,getComputedStyle(title).animationName]};
    });
    assert.ok(movement.stage === 'waiting' && movement.logo && movement.wordmark && movement.particles && movement.depth,
      JSON.stringify(movement));
    await animated.waitForFunction(() => document.documentElement.dataset.workspaceLoading === 'leaving');
    assert.ok(await animated.evaluate(() => performance.now() - window.startupDomReady >= 850), 'warm startup leaves time for the brand entrance');
    await animated.locator('#workspace-loading').waitFor({state:'hidden'});
    let releasePlugins;
    const pluginsGate = new Promise(resolve => { releasePlugins = resolve; });
    await animated.route('**/api/capabilities', async route => { await pluginsGate; await route.continue(); });
    try {
      await animated.reload({waitUntil:'domcontentloaded'});
      const reloadMask = animated.locator('#workspace-loading');
      await reloadMask.getByRole('status').getByText('正在重新加载工作空间', {exact:true}).waitFor();
      // The former deadline was 3.2 seconds. A blocked plugin scan must outlast it.
      await new Promise(resolve => setTimeout(resolve, 3400));
      assert.equal(await animated.evaluate(() => document.documentElement.dataset.workspaceLoading), 'waiting');
      assert.equal(await animated.locator('#app').isVisible(), false);
      releasePlugins();
      await reloadMask.waitFor({state:'hidden'});
    } finally { releasePlugins(); }
    await animated.close();
    const page = await browser.newPage({locale: 'zh-CN', reducedMotion: 'reduce'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let releaseAppearance;
    const waitingForAppearance = new Promise(resolve => { releaseAppearance = resolve; });
    const appearanceRoute = '**/api/appearance';
    await page.route(appearanceRoute, async route => { await waitingForAppearance; await route.continue(); });
    await page.goto(url + '/?desktop-loading=1#access=' + token);
    const loading = page.locator('#workspace-loading');
    await loading.waitFor();
    assert.equal(await loading.locator('.loading-brand strong').textContent(),'AstraAgent');
    assert.deepEqual(await loading.evaluate(node => {
      const layers = node.querySelector('.loading-particles');
      return [getComputedStyle(node.querySelector('img')).animationName,
        getComputedStyle(node.querySelector('strong')).animationName,
        getComputedStyle(layers, '::before').animationName,
        getComputedStyle(layers, '::after').animationName];
    }), ['none', 'none', 'none', 'none']);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.workspaceLoading),'waiting');
    releaseAppearance();
    await loading.waitFor({state:'hidden'});
    await page.unroute(appearanceRoute);
    const wizard = page.locator('#first-run');
    const next = step => wizard.locator(`[data-first-step="${step}"] [data-first-next]`);
    await wizard.waitFor({state: 'visible'});
    assert.equal(await page.locator('#app').evaluate(app => app.inert), true);
    await next(1).click();
    assert.equal(await wizard.locator('#first-run-privacy').evaluate(node => node === document.activeElement), true);
    await wizard.locator('#first-run-privacy').check();
    await next(1).click();
    await next(2).click();
    assert.equal(await wizard.locator('#first-run-terms').evaluate(node => node === document.activeElement), true);
    await wizard.locator('#first-run-terms').check();
    await next(2).click();
    await wizard.locator('#first-profile-name').fill('QA Member');
    await next(3).click();
    await wizard.locator('#first-provider-url').fill('https://example.com/v1');
    await wizard.locator('#first-provider-model').fill('fixture-model');
    await wizard.locator('#first-run-review').check();
    await wizard.locator('#first-run-finish').click();
    await wizard.locator('#first-run-enter').click();
    await wizard.waitFor({state: 'hidden'});
    assert.deepEqual(await page.evaluate(async () => ({
      model: state.settings.model,
      profile: (await api('/api/profile')).display_name,
      review: state.onboarding.auto_review_delivered,
      inert: document.querySelector('#app').inert,
    })), {model: 'fixture-model', profile: 'QA Member', review: true, inert: false});

    const sid = await page.evaluate(async () => {
      state.settings = await api('/api/settings', 'PUT', {model: 'fixture-model'});
      return (await api('/api/sessions', 'POST', {title: 'File review fixture'})).id;
    });
    const attachment = {id: 'a'.repeat(32), name: 'report.md', kind: 'text'};
    const events = [
      {type: 'start', provider_id: 'requested', model: 'auto', reasoning: 'default', input: 'Deliver a report'},
      {type: 'routing', provider_id: 'routed', resolved_model: 'routed-model', reasoning: 'low'},
      {type: 'file_generated', name: 'write_file', result: {attachment}},
      {type: 'done', content: 'Delivered'},
    ];
    const requests = [];
    await page.route(`**/api/sessions/${sid}/review`, async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill(requests.length === 1
        ? {status: 409, json: {error: 'Session finishing'}}
        : {json: {summary: 'Checked'}});
    });
    await page.route(`**/api/sessions/${sid}/chat`, route => route.fulfill({
      contentType: 'text/event-stream',
      body: events.map((event, index) => 'id: ' + (index + 1) + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''),
    }));
    const run = () => page.evaluate(id => consumeDurableStream(id, 'fixture', {content: 'Deliver a report'}, () => {}), sid);
    await run();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('自动审查已完成'));
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(requests[0].attachments, [attachment.id]);
    assert.equal(requests[0].provider, 'routed');
    assert.equal(requests[0].model, 'routed-model');
    assert.equal(requests[0].isolated, true);
    assert.match(requests[0].content, /Deliver a report/);
    await run();
    assert.equal(requests.length, 2);
    await page.reload();
    await page.waitForFunction(() => state.onboarding.auto_review_delivered);
    assert.equal(await wizard.isVisible(), false);
    await page.evaluate(() => {showSettings(); selectSettingsTab('general');});
    const toggle = page.getByRole('switch', {name: '自动审查交付文件'});
    assert.equal(await toggle.isChecked(), true);
    await toggle.uncheck();
    await page.waitForFunction(() => state.onboarding.auto_review_delivered === false);
    await page.reload();
    await page.waitForFunction(() => state.onboarding.auto_review_delivered === false);
    await run();
    assert.equal(requests.length, 2);
    assert.deepEqual(errors, []);
    console.log('First-run consent, profile, provider, review retry, deduplication and reload passed');
  } finally {
    if (browser) await browser.close();
    server.kill();
    await closed;
    fs.rmSync(data, {recursive: true, force: true, maxRetries: 3});
  }
}

main().catch(error => {console.error(error.stack); process.exitCode = 1;});
