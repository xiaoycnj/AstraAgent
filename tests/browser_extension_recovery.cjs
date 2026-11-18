/* Real Edge boot/retry regression. All server writes use a fresh temporary data dir. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const python = process.env.ASTRA_TEST_PYTHON || path.join(root, 'runtimes/python/python.exe');
  const {entries} = JSON.parse(fs.readFileSync(path.join(root, 'marketplace/catalog.json'), 'utf8'));
  const skin = entries.find(entry => entry.kind === 'skin' && entry.payload.widgets?.length);
  assert.ok(skin, 'Bundled catalog must contain a skin with widgets');
  const repaired = JSON.stringify({installed: {['skin:' + skin.id]: skin}, active_skin: skin.id});
  const corrupt = repaired.slice(0, -1);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-extension-recovery-'));
  const data = path.join(folder, 'data');
  fs.mkdirSync(data, {recursive: true});
  fs.writeFileSync(path.join(data, 'settings.json'), '{}');
  const stateFile = path.join(data, 'marketplace/state.json');
  let server, closed, browser, log = '';
  try {
    fs.mkdirSync(path.dirname(stateFile), {recursive: true});
    fs.writeFileSync(stateFile, corrupt);
    server = spawn(python, ['-u', 'server.py', '--port', '0', '--data-dir', data],
      {cwd: root, windowsHide: true, env: {...process.env, PYTHONUTF8: '1'}});
    closed = new Promise(resolve => server.once('close', resolve));
    server.on('error', error => { log += error.message; });
    server.stdout.on('data', chunk => { log += chunk; });
    server.stderr.on('data', chunk => { log += chunk; });
    const address = /http:\/\/127\.0\.0\.1:\d+/;
    for (let i = 0; i < 100 && !address.test(log) && server.exitCode === null; i++)
      await new Promise(resolve => setTimeout(resolve, 100));
    const url = log.match(address)?.[0];
    assert.ok(url, 'Isolated server failed to start: ' + log);
    const token = execFileSync(python, ['-c',
      'import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))', data],
      {cwd: root, windowsHide: true, encoding: 'utf8'}).trim();
    browser = await chromium.launch({headless: true, executablePath: process.env.ASTRA_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    const page = await browser.newPage({locale: 'zh-CN', reducedMotion: 'reduce', viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ready = async () => {
      await page.waitForFunction(() => state.token && state.settings && typeof marketReady !== 'undefined');
      await page.evaluate(() => marketReady);
    };
    const panel = page.locator('.extension-recovery');
    const button = panel.getByRole('button', {name: '重新检查并恢复', exact: true});
    const verifyPaused = async () => {
      await panel.getByRole('heading', {name: '扩展安全模式', exact: true}).waitFor();
      const safety = await page.evaluate(() => api('/api/extensions/safety'));
      assert.equal(safety.active, true);
      assert.ok(safety.reason?.trim(), 'Backend must explain why extensions stopped');
      assert.ok((await panel.innerText()).includes(safety.reason));
      assert.equal(await page.locator('body.market-skin, #skin-shortcuts, .plugin-list .plugin-card, .market-card').count(), 0);
      assert.deepEqual(await page.evaluate(async () => (await api('/api/capabilities')).plugins), []);
      assert.equal(fs.readFileSync(stateFile, 'utf8'), corrupt, 'Retry must preserve the corrupt file');
    };
    const retry = async () => {
      const [response] = await Promise.all([page.waitForResponse(r =>
        new URL(r.url()).pathname === '/api/extensions/safety' && r.request().method() === 'POST'), button.click()]);
      assert.equal(response.status(), 200);
      assert.deepEqual(response.request().postDataJSON(), {action: 'retry'});
    };
    await page.goto(url + '/#access=' + token);
    await ready();
    await page.evaluate(() => navigatePage('marketplace'));
    await verifyPaused();
    await retry();
    await page.waitForFunction(() => !document.querySelector('.extension-recovery button')?.disabled);
    await verifyPaused();

    fs.writeFileSync(stateFile, repaired);
    await Promise.all([page.waitForEvent('domcontentloaded'), retry()]);
    await ready();
    assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'reload');
    assert.equal(await page.evaluate(() => document.body.classList.contains('market-skin')), true);
    assert.deepEqual(await page.locator('#skin-shortcuts button').allTextContents(), skin.payload.widgets.map(w => w.label));
    await page.locator('.plugin-list .plugin-card').first().waitFor({state: 'attached'});
    await page.evaluate(() => navigatePage('marketplace'));
    await page.locator('.market-card').first().waitFor();
    assert.equal(await panel.count(), 0);
    assert.equal(await page.evaluate(async () => (await api('/api/extensions/safety')).active), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({edge: browser.version(), corrupt_boot_paused: true, retry_still_paused: true,
      repaired_retry_reloaded: true, skin_widgets_and_plugins_restored: true, page_errors: errors}));
  } finally {
    try { if (browser) await browser.close(); }
    finally {
      if (server) { server.kill(); await closed; }
      fs.rmSync(folder, {recursive: true, force: true, maxRetries: 3});
    }
  }
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
