const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const work = path.join(root, 'work');
const localPlaywright = path.join(work, 'ui-regression/node_modules/playwright');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || (fs.existsSync(localPlaywright) ? localPlaywright : 'playwright'));
const sizes = [{ width: 560, height: 350 }, { width: 544, height: 311 }];
const literalText = '<b>Astra & "status"</b>';
const longDetail = 'HTTP Error 403: rate limit exceeded\nThe release feed rejected this request.\nRequest ID: ' + 'x'.repeat(400) + '\n' + 'Request details\n'.repeat(90);

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(work, `astra-window-${name}.png`), animations: 'disabled' });
}

async function fits(page, context) {
  const issues = await page.evaluate(() => {
    const card = document.querySelector('.card').getBoundingClientRect();
    const room = document.documentElement;
    const problems = [];
    if (room.scrollHeight > innerHeight || room.scrollWidth > innerWidth) problems.push('document overflows');
    if (card.top < 0 || card.bottom > innerHeight || card.left < 0 || card.right > innerWidth) problems.push('card extends beyond viewport');
    for (const element of document.querySelectorAll('header, h1, .tagline, footer, #status, button, progress, summary, #error-text')) {
      if (!element.checkVisibility()) continue;
      const box = element.getBoundingClientRect();
      if (box.top < card.top || box.bottom > card.bottom || box.left < card.left || box.right > card.right) {
        problems.push(`${element.id || element.tagName} extends beyond card`);
      }
    }
    if (document.querySelector('.tagline').getBoundingClientRect().bottom > document.querySelector('footer').getBoundingClientRect().top) {
      problems.push('footer overlaps subtitle');
    }
    return problems;
  });
  assert.deepEqual(issues, [], context);
}

async function textOnly(page, selector, expected) {
  assert.deepEqual(await page.locator(selector).evaluate(element => ({
    text: element.textContent, children: element.childElementCount,
  })), { text: expected, children: 0 }, `${selector} must display literal text`);
}

async function openWindow(page, name) {
  await page.goto(pathToFileURL(path.join(root, 'web/assets/startup', `${name}.html`)).href);
  await page.locator('.card h1').waitFor();
  await page.locator('#status').waitFor();
  assert.equal(await page.locator('.card img').evaluate(el => el.complete && el.naturalWidth > 0), true, 'local brand mark loads');
  return page.locator('.card').evaluate(card => getComputedStyle(card).color + ' / ' + getComputedStyle(document.body).backgroundColor);
}

async function checkMotion(page) {
  const active = () => page.locator('progress').evaluate(progress => getComputedStyle(progress.parentElement, '::after').animationName);
  assert.equal(await active(), 'none', 'reduced motion stops the indeterminate sweep');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.notEqual(await active(), 'none', 'indeterminate progress animates with motion enabled');
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

async function startup(page, colorScheme, compact) {
  const palette = await openWindow(page, 'splash');
  const close = page.locator('.close');
  const retry = page.locator('.retry');
  const set = (phase, text) => page.evaluate(([phase, text]) => setStartupState(phase, text), [phase, text]);
  await set('waiting', '正在唤醒工作空间');
  assert.equal(await close.isVisible(), true);
  assert.equal(await retry.isVisible(), false);
  await checkMotion(page);
  await fits(page, 'startup waiting');

  await set('loading', '正在加载工作空间…');
  assert.equal(await retry.isVisible(), false);
  await fits(page, 'startup loading');
  if (colorScheme === 'light' && !compact) await screenshot(page, 'startup-light-loading');

  const failure = '无法连接后台服务，请重新连接。';
  await set('failed', `${failure}${literalText}`);
  await textOnly(page, '#status', `${failure}${literalText}`);
  await set('failed', failure);
  assert.equal(await retry.isVisible(), true);
  await fits(page, 'startup failure');
  if (colorScheme === 'dark' && compact) await screenshot(page, 'startup-dark-failure-compact');
  await retry.focus();
  await page.keyboard.press('Enter');
  await set('loading', '正在重新连接…');
  assert.equal(await retry.isVisible(), false);
  await close.click();
  assert.deepEqual(await page.evaluate(() => window.bridgeCalls), ['retry', 'cancel_startup']);
  return palette;
}

async function updater(page, colorScheme, compact) {
  const palette = await openWindow(page, 'update');
  const close = page.locator('#close');
  const progress = page.locator('progress');
  const details = page.locator('#error-details');
  const error = page.locator('#error-text');
  const set = (phase, text, ...bytes) => page.evaluate(args => setUpdateState(...args), [phase, text, ...bytes]);
  const state = async (phase, text, bytes, expectedPosition) => {
    await set(phase, text, ...bytes);
    await textOnly(page, '#status', text);
    assert.equal(await close.isVisible(), false, `${phase} cannot be closed`);
    assert.equal(await details.isVisible(), false);
    assert.equal(await progress.isVisible(), true);
    assert.equal(await progress.evaluate(el => el.position), expectedPosition, `${phase} progress position`);
    await fits(page, `updater ${phase}`);
  };

  assert.equal(await close.isVisible(), false, 'close starts hidden');
  await state('waiting', '正在等待主面板与后台服务退出…', [], -1);
  await checkMotion(page);
  if (colorScheme === 'light' && !compact) await screenshot(page, 'update-light-waiting');
  await state('download', '正在下载更新…', [4], -1);
  await state('download', '正在下载更新…', [0, 0], -1);
  await state('download', '正在下载更新…', [0, 100], 0);
  await state('download', '正在下载更新…', [42, 100], 0.42);
  if (colorScheme === 'dark' && !compact) await screenshot(page, 'update-dark-download');
  await state('download', '正在下载更新…', [42], -1);
  await state('install', `正在安装更新… ${literalText}`, [100, 100], -1);
  await state('restart', '更新完成，正在重新启动…', [100, 100], -1);

  const failure = '更新服务暂时拒绝请求或已限流，请稍后重试。';
  const fail = (message, detail) => page.evaluate(([message, detail]) => setUpdateFailure(message, detail), [message, detail]);
  await fail(`${failure}${literalText}`, `<em>literal detail</em>\n${longDetail}`);
  await textOnly(page, '#status', `${failure}${literalText}`);
  await textOnly(page, '#error-text', `<em>literal detail</em>\n${longDetail}`);
  await state('download', '正在下载更新…', [42, 100], 0.42);
  await fail(failure, longDetail);
  assert.equal(await progress.isVisible(), false);
  assert.equal(await close.isVisible(), true);
  assert.equal(await details.isVisible(), true);
  assert.equal(await error.isVisible(), false, 'error detail starts collapsed');
  await fits(page, 'updater failure collapsed');
  const summary = details.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await error.isVisible(), true);
  await fits(page, 'updater failure expanded');
  if (colorScheme === 'light' && compact) await screenshot(page, 'update-light-failure-compact');
  assert.equal(await error.evaluate(el => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop > 0 && el.scrollWidth === el.clientWidth;
  }), true, 'long error scrolls within the detail panel and wraps long tokens');
  await summary.click();
  assert.equal(await error.isVisible(), false, 'error detail can be collapsed again');
  await close.click();
  assert.deepEqual(await page.evaluate(() => window.bridgeCalls), ['close']);

  await state('waiting', '正在重新检查更新…', [], -1);
  await page.evaluate(() => setUpdateFailure('更新未完成。', ''));
  assert.equal(await close.isVisible(), true);
  assert.equal(await details.isVisible(), false, 'empty detail does not show a disclosure');
  await fits(page, 'updater failure without detail');
  return palette;
}

async function customDialogs(page) {
  await page.setContent('<button id="before">original focus</button>');
  await page.addStyleTag({ path: path.join(root, 'web/assets/css/dialogs.css') });
  await page.addScriptTag({ path: path.join(root, 'web/assets/js/dialogs.js') });
  const nativeDialogs = [];
  page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); void dialog.dismiss(); });
  await page.locator('#before').focus();
  await page.evaluate(() => { window.result = undefined; appConfirm('<img src=x onerror=alert(1)>').then(v => window.result = v); });
  await page.locator('.app-dialog[open]').waitFor();
  assert.equal(await page.locator('.app-dialog img').count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.result === false);
  assert.equal(await page.locator('#before').evaluate(e => e === document.activeElement), true);
  await page.evaluate(() => { appPrompt('名称', '旧名称').then(v => window.result = v); });
  await page.locator('.app-dialog input').fill('新名称');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.result === '新名称');
  await page.evaluate(() => { appConfirm('first').then(v => window.first = v); appConfirm('second').then(v => window.second = v); });
  await page.locator('.app-dialog .primary').click();
  await page.locator('.app-dialog p').filter({ hasText: 'second' }).waitFor();
  await page.locator('.app-dialog .secondary').click();
  await page.waitForFunction(() => window.first === true && window.second === false);
  assert.deepEqual(nativeDialogs, [], 'no native dialogs');
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const viewport of sizes) {
      const palettes = {};
      for (const colorScheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport, colorScheme, reducedMotion: 'reduce' });
        try {
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.addInitScript(() => {
            window.bridgeCalls = [];
            window.pywebview = { api: Object.fromEntries(['cancel_startup', 'retry', 'close'].map(action => [
              action, async () => { window.bridgeCalls.push(action); return true; },
            ])) };
          });
          const compact = viewport.width === 544;
          palettes[colorScheme] = [await startup(page, colorScheme, compact), await updater(page, colorScheme, compact)];
          assert.deepEqual(errors, [], 'no uncaught startup or updater page errors');
        } finally {
          await page.close();
        }
      }
      for (const [index, name] of ['startup', 'update'].entries()) {
        assert.notEqual(palettes.light[index], palettes.dark[index], `${name} follows system color scheme`);
      }
    }
    await customDialogs(await browser.newPage({ viewport: sizes[0] }));
    console.log('Startup and updater layout, phases, themes, reduced motion, error details and bridge calls passed. Custom confirm/prompt, focus, Escape and queue passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
