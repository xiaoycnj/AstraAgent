const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-canvas-ui-'));
  const python = process.env.ASTRA_TEST_PYTHON || path.join(root, 'runtimes/python/python.exe');
  const server = spawn(python, ['-u', 'server.py', '--port', '0', '--data-dir', data], {
    cwd: root, windowsHide: true, env: {...process.env, PYTHONUTF8: '1'},
  });
  const closed = new Promise(resolve => server.once('close', resolve));
  let browser, log = '';
  server.stdout.on('data', chunk => { log += chunk.toString(); });
  server.stderr.on('data', chunk => { log += chunk.toString(); });
  try {
    const address = /http:\/\/127\.0\.0\.1:\d+/;
    for (let i = 0; i < 100 && !address.test(log) && server.exitCode === null; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const url = log.match(address)?.[0];
    assert.ok(url, log);
    const token = execFileSync(python, ['-c',
      'import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))', data],
    {cwd: root, windowsHide: true, encoding: 'utf8'}).trim();
    browser = await chromium.launch({headless: true, executablePath: process.env.ASTRA_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    const page = await browser.newPage({locale: 'zh-CN', reducedMotion: 'reduce', viewport: {width: 1440, height: 900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url + '/#access=' + token);
    const wizard = page.locator('#first-run');
    const next = step => wizard.locator(`[data-first-step="${step}"] [data-first-next]`);
    await wizard.locator('#first-run-privacy').check();
    await next(1).click();
    await wizard.locator('#first-run-terms').check();
    await next(2).click();
    await next(3).click();
    await wizard.locator('#first-provider-url').fill('https://example.com/v1');
    await wizard.locator('#first-run-finish').click();
    await wizard.locator('#first-run-error').waitFor();
    assert.equal(await wizard.locator('#first-provider-model').evaluate(node => node === document.activeElement), true);
    await wizard.locator('#first-run-skip').click();
    await wizard.locator('#first-run-canvas').click();
    await page.locator('.canvas-empty').waitFor();
    await page.waitForFunction(() => !state.onboarding.required && !state.settings.base_url);
    assert.deepEqual(await page.evaluate(() => api('/api/canvases')), []);

    const canvas = page.locator('#canvas-view');
    const open = title => canvas.getByRole('button', {name: title, exact: true}).click();
    await open('使用工作流模板');
    await page.locator('.app-dialog').getByRole('button', {name: '确认', exact: true}).click();
    await canvas.locator('.node').nth(4).waitFor();
    assert.deepEqual(await canvas.locator('.node-title').allTextContents(), ['项目目标', '策划', '执行', '审核', '总结']);
    await canvas.locator('#node-content').fill('为校园读书会设计报名页');
    await open('关闭详情');
    await page.waitForFunction(() => !document.querySelector('#canvas-view').classList.contains('has-node-details'));
    await open('适应');
    const bounds = await canvas.locator('#viewport').boundingBox();
    const cards = await Promise.all((await canvas.locator('.node').all()).map(row => row.boundingBox()));
    const left = Math.max(bounds.x + 4, Math.min(...cards.map(r => r.x)) - 8);
    const top = Math.min(...cards.map(r => r.y)) - 8;
    const right = Math.min(bounds.x + bounds.width - 4, Math.max(...cards.map(r => r.x + r.width)) + 8);
    const bottom = Math.max(...cards.map(r => r.y + r.height)) + 8;
    await page.keyboard.down('Shift');
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, {steps: 6});
    await page.mouse.up();
    await page.keyboard.up('Shift');
    assert.match(await canvas.locator('.canvas-batch [role=status]').textContent(), /5/);
    await open('整理选中');
    await open('删除选中');
    await page.locator('.app-dialog').getByRole('button', {name: '确认', exact: true}).click();
    await page.waitForFunction(() => !document.querySelector('#nodes').children.length);
    await canvas.locator('#undo').click();
    assert.equal(await canvas.locator('.node').count(), 5);

    // Run each stage by hand through the ordinary UI. The mock only replaces the model stream.
    const requests = [];
    await page.route('**/api/sessions/*/chat', async route => {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      const answer = `fixture result ${requests.length}`;
      await route.fulfill({status: 200, contentType: 'text/event-stream',
        body: `id: 1\ndata:${JSON.stringify({type: 'done', content: answer})}\n\n`});
    });
    await page.evaluate(async () => {
      state.settings = await api('/api/settings', 'PUT', {base_url: 'https://example.com/v1', model: 'fixture'});
    });
    const search = canvas.getByRole('searchbox', {name: '查找画布节点'});
    async function run(title) {
      await search.fill(title);
      await canvas.locator('.canvas-search-results').getByRole('button', {name: title, exact: true}).click();
      await canvas.locator('#run-node').click();
    }
    await run('审核');
    assert.equal(requests.length, 0);
    for (const [index, title] of ['策划', '执行', '审核', '总结'].entries()) {
      await run(title);
      await canvas.getByRole('button', {name: `${title} · 结果`, exact: true}).waitFor();
      assert.equal(requests[index].conversation_mode, 'chat');
      assert.equal(requests[index].access_policy, 'deny');
      assert.equal(requests[index].iui_enabled, false);
      assert.match(requests[index].content, /校园读书会/);
      if (index) assert.ok(requests[index].content.includes(`fixture result ${index}`));
    }
    await run('策划');
    await page.waitForFunction(() => state.board?.data.nodes.some(node => node.content === 'fixture result 5'));
    assert.equal(await canvas.getByRole('button', {name: '策划 · 结果', exact: true}).count(), 1);
    await page.evaluate(() => flushBoard());
    const boardId = await page.evaluate(() => state.board.id);
    await page.reload();
    await page.waitForFunction(() => !!state.token);
    await page.evaluate(() => switchMode('canvas'));
    await page.waitForFunction(id => state.board?.id === id, boardId);
    assert.equal(await canvas.locator('.node').count(), 9);
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => fit());
    for (const selector of ['.canvas-toolbar', '.canvas-extra-actions']) {
      const area = await canvas.locator(selector).boundingBox();
      const viewport = await canvas.locator('#viewport').boundingBox();
      assert.ok(area.x >= viewport.x && area.x + area.width <= viewport.x + viewport.width + 1, selector);
    }
    assert.deepEqual(errors, []);
    console.log('Canvas onboarding, empty state, batch editing, role runs, recovery of saved board, and compact controls passed');
  } finally {
    if (browser) await browser.close();
    server.kill();
    await closed;
    fs.rmSync(data, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
