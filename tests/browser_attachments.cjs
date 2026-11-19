const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-attachment-ui-'));
  fs.writeFileSync(path.join(data, 'settings.json'), '{}');
  const python = process.env.ASTRA_TEST_PYTHON || path.join(root, 'runtimes/python/python.exe');
  const server = spawn(python, ['-u', 'server.py', '--port', '0', '--data-dir', data], {
    cwd: root, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' },
  });
  let log = '', browser;
  server.stdout.on('data', chunk => log += chunk);
  server.stderr.on('data', chunk => log += chunk);
  try {
    const address = /http:\/\/127\.0\.0\.1:\d+/;
    for (let attempt = 0; attempt < 100 && !address.test(log); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.match(log, address);
    const token = execFileSync(python, [
      '-c', 'import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))', data,
    ], { cwd: root, windowsHide: true }).toString().trim();
    browser = await chromium.launch({
      executablePath: process.env.ASTRA_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    });
    const page = await browser.newPage({locale:'zh-CN', reducedMotion:'reduce', viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(log.match(address)[0]+'/#access='+token);
    await page.waitForFunction(() => state.token && state.settings && document.body.dataset.appPage === 'home');
    await page.evaluate(() => newSession());
    const raw = Buffer.from('<b>原始附件内容</b>\r\n');
    const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=', 'base64');
    const upload = (name, buffer) => page.evaluate(body => api('/api/attachments','POST',body), {name,data:buffer.toString('base64')});
    const doc = await upload('附件.txt', raw);
    const image = await upload('像素.png', picture);
    await page.evaluate(items => {
      pendingAttachments.push(...items);
      renderAttachmentTray();
      const note = markdown('[下载测试交付物](/api/attachments/'+items[0].id+'/content)');
      document.querySelector('#chat-form').before(note);
    }, [doc,image]);

    const pane = page.locator('#attachment-side-preview');
    const docTrigger = page.getByRole('button',{name:'在侧栏中预览 '+doc.name});
    await docTrigger.click();
    assert.match(await pane.locator('pre').textContent(), /<b>原始附件内容<\/b>/);
    assert.equal(await pane.locator('.attachment-preview-body b').count(), 0);
    assert.equal(await pane.evaluate(node => {
      const composer = document.querySelector('#chat-form').getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return rect.width >= 300 && composer.width > 300 && composer.right <= rect.left + 1;
    }), true);

    const save = pane.getByRole('link',{name:'下载原文件'});
    const [download] = await Promise.all([page.waitForEvent('download'),save.click()]);
    assert.equal(download.suggestedFilename(), doc.name);
    assert.deepEqual(fs.readFileSync(await download.path()), raw);
    await page.keyboard.press('Escape');
    assert.equal(await pane.isHidden(), true);
    assert.equal(await docTrigger.evaluate(el => document.activeElement === el), true);
    const deliveredLink = page.getByRole('link',{name:'下载测试交付物'});
    const [delivered] = await Promise.all([page.waitForEvent('download'),deliveredLink.click()]);
    assert.deepEqual(fs.readFileSync(await delivered.path()), raw);

    // A canceled native dialog must not fall through to a browser download.
    const nativeDownloads = [];
    page.on('download', download => nativeDownloads.push(download));
    await page.evaluate(() => {
      window.savedAttachments=[];
      window.pywebview={api:{save_attachment:async id => {window.savedAttachments.push(id);return false;}}};
    });
    await page.locator('#session-resources').click();
    await page.locator('#resource-panel').getByRole('button',{name:doc.name+' 待发送'}).click();
    await pane.locator('pre').waitFor();
    await save.click();
    await page.waitForFunction(id => window.savedAttachments[0] === id, doc.id);
    assert.doesNotMatch(await page.locator('#toast').textContent(), /附件已保存/);
    await page.keyboard.press('Escape');
    await page.evaluate(() => navigatePage('library'));
    const viewer = page.locator('dialog.image-preview');
    await page.getByRole('button',{name:'预览 '+image.name,exact:true}).click();
    await viewer.locator('.image-preview-plane img').waitFor();
    await viewer.getByRole('button',{name:'下载原图',exact:true}).click();
    await page.waitForFunction(id => window.savedAttachments[1] === id, image.id);
    assert.deepEqual(nativeDownloads, []);
    await viewer.getByRole('button',{name:'在侧面板中打开',exact:true}).click();
    await pane.locator('img').waitFor();
    assert.equal(await viewer.isHidden(), true);
    assert.equal(await pane.locator('img').evaluate(img => img.naturalWidth), 1);

    await page.setViewportSize({width:390,height:844});
    const bounds = await pane.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const close = node.querySelector('button[aria-label="关闭附件预览"]').getBoundingClientRect();
      return {pane:rect.toJSON(), close:close.toJSON(), width:innerWidth, height:innerHeight};
    });
    assert.ok(bounds.pane.x >= 0 && bounds.pane.right <= bounds.width && bounds.pane.height > 300 &&
      bounds.pane.bottom <= bounds.height && bounds.close.right <= bounds.pane.right &&
      bounds.close.bottom <= bounds.pane.bottom, JSON.stringify(bounds));
    const libraryDoc = page.getByRole('button',{name:'预览 '+doc.name,exact:true});
    await pane.getByRole('button',{name:'关闭附件预览'}).click();
    await libraryDoc.click();
    await pane.locator('pre').waitFor();
    await pane.getByRole('button',{name:'关闭附件预览'}).click();
    let releasePreview;
    const previewGate = new Promise(resolve => {releasePreview=resolve;});
    await page.route(`**/api/attachments/${doc.id}/preview`, async route => {
      await previewGate;
      await route.continue();
    });
    await libraryDoc.click();
    await pane.getByRole('status').waitFor();
    await page.evaluate(() => navigatePage('home'));
    const oldResponse=page.waitForResponse(`**/api/attachments/${doc.id}/preview`);
    releasePreview();
    assert.ok((await oldResponse).ok());
    assert.equal(await pane.isHidden(), true);
    assert.deepEqual(errors, []);
    console.log('PASS attachment browser: downloads match original bytes; native cancel; conversation and library previews; image docking; focus and narrow layout');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
