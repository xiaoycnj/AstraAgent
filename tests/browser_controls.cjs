/* Shared-control regression against an isolated Astra server and browser profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { execFileSync, spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(root, 'work/ui-regression/node_modules/playwright'));
const python = process.env.ASTRA_TEST_PYTHON || path.join(root, 'runtimes/python/python.exe');
const work = path.join(root, 'work');

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(work, `astra-controls-${name}.png`), animations: 'disabled' });
}

async function settings(page, tab) {
  await page.evaluate((tab) => { showSettings(); selectSettingsTab(tab); }, tab);
  await page.locator(`[data-panel=${tab}]`).waitFor();
}

async function checkDisclosureHeading(summary) {
  const heading = await summary.evaluate((node) => {
    const text = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
    const range = document.createRange();
    if (text) range.selectNodeContents(text);
    else range.selectNodeContents(node.querySelector(':scope > strong'));
    const lines = [...range.getClientRects()];
    const icon = node.querySelector(':scope > .chevron').getBoundingClientRect();
    return { lines: lines.length, clear: lines.every((line) => line.right <= icon.left), hint: !!node.querySelector(':scope > .hint') };
  });
  assert.deepEqual(heading, { lines: 1, clear: true, hint: false }, 'hint-free title must fit on one line without overlapping its chevron');
}

async function checkDisclosure(page, details, existingChevron = false) {
  const summary = details.locator(':scope > summary');
  await summary.waitFor();
  const structure = await summary.evaluate((node) => ({
    tag: node.parentElement.tagName,
    first: node === node.parentElement.firstElementChild,
    role: node.getAttribute('role'),
    expanded: node.getAttribute('aria-expanded'),
    shared: node.classList.contains('ui-disclosure'),
  }));
  assert.deepEqual(structure, { tag: 'DETAILS', first: true, role: null, expanded: null, shared: true });
  const indicators = summary.locator(':scope > .chevron');
  assert.equal(await indicators.count(), 1, existingChevron ? 'existing chevron was duplicated' : 'fallback chevron missing or duplicated');
  assert.equal(await indicators.getAttribute('aria-hidden'), 'true');
  assert.ok(await indicators.isVisible(), 'chevron must be visible');
  await checkDisclosureHeading(summary);

  await details.evaluate((node) => { node.open = false; });
  await summary.focus();
  await page.keyboard.press('Enter');
  await details.evaluate((node) => {
    if (!node.open) throw Error('Enter did not open native details');
  });
  await page.keyboard.press('Tab');
  assert.equal(await details.evaluate((node) => node.contains(document.activeElement) && document.activeElement.tagName !== 'SUMMARY'), true, 'open descendants must be in the tab order');
  await summary.focus();
  await page.keyboard.press('Space');
  assert.equal(await details.evaluate((node) => node.open), false, 'Space did not close native details');
  await page.keyboard.press('Tab');
  assert.equal(await details.evaluate((node) => node.contains(document.activeElement)), false, 'collapsed descendants remained in the forward tab order');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await summary.evaluate((node) => node === document.activeElement), true, 'reverse Tab did not return to collapsed summary');
}

async function checkMotion(page) {
  const motion = page.locator('#reduce-motion');
  await motion.waitFor();
  assert.equal(await page.getByRole('switch', { name: await motion.getAttribute('aria-label'), exact: true }).count(), 1);
  const original = await motion.isChecked();
  for (const checked of [!original, original]) {
    await motion.focus();
    await page.keyboard.press('Space');
    assert.equal(await motion.isChecked(), checked, 'Space did not toggle motion preference');
    const expected = checked ? 'reduced' : 'full';
    assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.motion, localStorage.getItem('astra-motion')]), [expected, expected]);
  }
  assert.equal(await motion.evaluate((node) => node.matches('input[type=checkbox].ui-switch[role=switch]')), true);
  assert.equal(await motion.evaluate((node) => !!node.closest('.ui-setting-row')), true);
  return motion;
}

async function goToNightSkin(page) {
  await page.evaluate(() => navigatePage('marketplace'));
  await page.getByRole('button', { name: '\u0055\u0049 \u76ae\u80a4', exact: true }).click();
  await page.locator('[data-package-id=midnight-orbit]').getByRole('button', { name: '\u9884\u89c8', exact: true }).click();
  await page.getByRole('button', { name: '\u5e94\u7528\u76ae\u80a4', exact: true }).click();
  await page.waitForFunction(() => marketData?.state.active_skin === 'midnight-orbit' && !skinPreview);
}

async function desktopAppearance(page) {
  const colors = [];
  for (const variant of ['light', 'dark', 'night']) {
    if (variant === 'night') await goToNightSkin(page);
    else await page.evaluate((theme) => applyTheme(theme), variant);
    await settings(page, 'appearance');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), variant === 'light' ? 'light' : 'dark');
    const motion = await checkMotion(page);
    const advanced = page.locator('#advanced-appearance');
    await checkDisclosure(page, advanced, true);
    await advanced.locator(':scope > summary').press('Enter');
    const section = page.locator('#advanced-appearance .appearance-subsection.ui-section').first();
    await section.waitFor();
    const { background, divider } = await section.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, divider: style.borderBottomColor };
    });
    assert.equal(background, 'rgba(0, 0, 0, 0)', 'advanced subsections should not become nested cards');
    colors.push(await motion.evaluate((node, divider) => ({
      divider,
      switchEdge: getComputedStyle(node, '::after').borderColor,
      switchTrack: getComputedStyle(node, '::after').backgroundColor,
      switchThumb: getComputedStyle(node, '::before').backgroundColor,
    }), divider));
    await motion.scrollIntoViewIfNeeded();
    await screenshot(page, `appearance-${variant}`);
  }
  assert.notEqual(colors[0].divider, colors[1].divider, 'light/dark shared divider colors should differ');
  console.log('Appearance palettes:', JSON.stringify(colors));

  await page.locator('#settings-tab-layout').click();
  const modules = page.locator('#skin-modules.ui-section');
  const discovery = modules.locator(':scope > .settings-disclosure').first();
  await checkDisclosure(page, discovery);
  await discovery.locator(':scope > summary').press('Enter');
  await screenshot(page, 'layout-modules');
}

async function checkProvider(page) {
  await settings(page, 'connection');
  await page.locator('#provider-add').click();
  const dialog = page.locator('dialog:has(#provider-save)');
  await dialog.waitFor();
  const checkbox = dialog.locator('#clear-key');
  await dialog.locator('.settings-disclosure:has(#clear-key) > summary').press('Enter');
  await checkbox.waitFor();
  assert.equal(await checkbox.getAttribute('role'), null);
  assert.equal(await checkbox.evaluate((node) => node.matches('input[type=checkbox]:not(.ui-switch)') && getComputedStyle(node).appearance === 'auto'), true);
  assert.equal(await dialog.getByRole('checkbox').evaluateAll((nodes) => nodes.some((node) => node.id === 'clear-key')), true);
  await checkbox.focus();
  await page.keyboard.press('Space');
  assert.equal(await checkbox.isChecked(), true);
  await page.keyboard.press('Space');
  assert.equal(await checkbox.isChecked(), false);

  const buttons = await dialog.evaluate((node) => ['#provider-save', '#test-api', '.provider-close'].map((selector) => {
    const button = node.querySelector(selector);
    const style = getComputedStyle(button);
    return {
      selector, shared: button.matches('.ui-button'),
      variant: button.matches('.primary') ? 'primary' : button.matches('.secondary') ? 'secondary' : 'quiet',
      background: style.backgroundColor, border: style.borderTopColor,
    };
  }));
  assert.deepEqual(buttons.map(({ shared, variant }) => [shared, variant]), [[true, 'primary'], [true, 'secondary'], [true, 'quiet']]);
  assert.notEqual(buttons[0].background, buttons[1].background, 'primary should stand apart from secondary');
  assert.notDeepEqual([buttons[1].background, buttons[1].border], [buttons[2].background, buttons[2].border], 'secondary should stand apart from quiet');
  await screenshot(page, 'provider');
  console.log('Provider button variants:', JSON.stringify(buttons));
}

async function checkForcedColors(page) {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  await settings(page, 'appearance');
  const motion = page.locator('#reduce-motion');
  const styles = () => motion.evaluate((node) => ({
    track: getComputedStyle(node, '::after').backgroundColor,
    thumb: getComputedStyle(node, '::before').backgroundColor,
    duration: getComputedStyle(node, '::after').transitionDuration,
    thumbDuration: getComputedStyle(node, '::before').transitionDuration,
    outline: getComputedStyle(node).outlineStyle,
  }));
  await motion.focus();
  const before = await styles();
  await page.keyboard.press('Space');
  const after = await styles();
  assert.notEqual(before.track, after.track, 'forced-colors track must distinguish checked and unchecked');
  for (const state of [before, after]) {
    assert.notEqual(state.track, state.thumb, 'forced-colors thumb must remain distinct from its track');
    assert.ok(state.duration.split(',').every((time) => Number.parseFloat(time) <= 0.001));
    assert.ok(state.thumbDuration.split(',').every((time) => Number.parseFloat(time) <= 0.001));
  }
  assert.notEqual(after.outline, 'none', 'keyboard focus must be visible in forced colors');
  await screenshot(page, 'forced-colors');
  console.log('Forced colors / reduced motion:', JSON.stringify({ before, after }));
}

async function mobile(page, width) {
  await page.setViewportSize({ width, height: 844 });
  assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
  await settings(page, 'appearance');
  const sizes = {};
  async function hitTarget(selector) {
    const locator = page.locator(selector);
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    assert.ok(box && box.width >= 43.9 && box.height >= 43.9, `${selector} at ${width}px: expected 44px touch target, got ${JSON.stringify(box)}`);
    assert.ok(box.x >= -1 && box.x + box.width <= width + 1, `${selector} overflows horizontally at ${width}px`);
    sizes[selector] = [box.width, box.height];
  }
  await hitTarget('#advanced-appearance > summary');
  await checkDisclosureHeading(page.locator('#advanced-appearance > summary'));
  await hitTarget('#reduce-motion');
  await screenshot(page, `appearance-${width}`);
  await page.locator('#settings-tab-layout').click();
  const discovery = page.locator('#skin-modules > .settings-disclosure > summary');
  await discovery.scrollIntoViewIfNeeded();
  await checkDisclosureHeading(discovery);
  await settings(page, 'connection');
  await hitTarget('#provider-add');
  await screenshot(page, `connection-${width}`);
  console.log(`Coarse ${width}px:`, JSON.stringify(sizes));
}

async function main() {
  fs.mkdirSync(work, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-controls-'));
  const data = path.join(temp, 'data');
  fs.mkdirSync(data, {recursive: true});
  fs.writeFileSync(path.join(data, 'settings.json'), '{}');
  const server = spawn(python, ['-u', 'server.py', '--port', '0', '--data-dir', data], {
    cwd: root, env: { ...process.env, PYTHONUTF8: '1' }, windowsHide: true,
  });
  const errors = [];
  let browser, log = '', serverError;
  server.stdout.on('data', (chunk) => { log += chunk; });
  server.stderr.on('data', (chunk) => { log += chunk; });
  server.on('error', (error) => { serverError = error; });
  try {
    for (let i = 0; i < 100 && !serverError && server.exitCode === null && !/http:\/\/127\.0\.0\.1:\d+/.test(log); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (serverError) throw serverError;
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, log || 'Astra server did not report a listening URL');
    const token = execFileSync(python, ['-c', 'import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))', data], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
    browser = await chromium.launch({ headless: true, executablePath: process.env.ASTRA_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    async function open(options) {
      const page = await browser.newPage({ locale: 'zh-CN', ...options });
      page.setDefaultTimeout(7000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${url}/#access=${token}`);
      await page.waitForFunction(() => state.token && state.settings && appearanceDraft);
      return page;
    }
    const failures = [];
    async function check(name, run) {
      try { await run(); } catch (error) { failures.push(error); console.error(`${name}:`, error); }
    }
    for (const width of [390, 320]) {
      await check(`Coarse pointer ${width}px`, async () => {
        const page = await open({ hasTouch: true, viewport: { width, height: 844 } });
        try { await mobile(page, width); } finally { await page.context().close(); }
      });
    }
    const page = await open({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    await check('Desktop Appearance', () => desktopAppearance(page));
    await check('Forced colors / reduced motion', () => checkForcedColors(page));
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
    await check('Provider controls', () => checkProvider(page));
    await check('Browser errors', () => assert.deepEqual(errors, [], 'uncaught browser errors'));
    assert.equal(failures.length, 0, 'shared control checks failed (see diagnostics above)');
    console.log('Shared controls browser regression passed');
  } finally {
    try {
      await browser?.close();
    } finally {
      if (server.pid && server.exitCode === null && server.signalCode === null) {
        const exit = once(server, 'exit');
        server.kill();
        await exit;
      }
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
