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


    const source = '<!doctype html><html><head><style>body{font:20px system-ui;padding:32px}button{padding:16px 32px;border-radius:12px}</style></head><body><h1>Interactive counter</h1><button id="counter">0</button><script>document.querySelector("#counter").onclick=function(){this.textContent=Number(this.textContent)+1};try{parent.document.body.dataset.previewEscaped="yes"}catch(e){window.parentBlocked=true}fetch("/api/settings").then(()=>window.requestBlocked=false).catch(()=>window.requestBlocked=true)</script></body></html>';
    await page.evaluate(source => {
      state.session = {id: 'rich-fixture', title: 'Rich conversation'};
      state.messages = [
        {id: 1, role: 'user', content: '请做一个交互式计数器，并解释实现方式。'},
        {id: 2, role: 'assistant', content: '# 富文本与交互\n\n支持 **粗体**、*斜体*、~~删除线~~ 与 `行内代码`。\n\n> 阅读与操作在同一条消息中完成。\n\n- 第一项\n- 第二项\n\n公式 $x^2+\\frac{1}{2}$\n\n| 功能 | 状态 |\n| --- | --- |\n| 富文本 | 完成 |\n| =1+1 | 安全导出 |\n\n```html\n' + source + '\n```'}
      ];
      renderMessages();
    }, source);
    assert.equal(await page.locator('.message.assistant h1').textContent(), '富文本与交互');
    assert.equal(await page.locator('.message.assistant .katex').count(), 1);
    assert.ok(await page.locator('.message.assistant code .cm-tag').count() > 0);
    const block = page.locator('.message.assistant');
    await block.getByRole('button', {name: '自动换行', exact: true}).click();
    assert.equal(await block.locator('pre').getAttribute('class'), 'code-wrap');
    const codeDownload = page.waitForEvent('download');
    await block.getByRole('button', {name: '下载代码', exact: true}).click();
    const code = await codeDownload;
    assert.equal(code.suggestedFilename(), 'snippet.html');
    assert.ok(fs.readFileSync(await code.path(), 'utf8').includes('Interactive counter'));
    const csvDownload = page.waitForEvent('download');
    await block.getByRole('button', {name: '下载 CSV', exact: true}).click();
    const csv = await csvDownload;
    assert.ok(fs.readFileSync(await csv.path(), 'utf8').includes('"\'=1+1"'));

    await page.locator('#chat-input').fill('Existing draft');
    await block.getByRole('button', {name: '引用', exact: true}).click();
    assert.ok((await page.locator('#chat-input').inputValue()).startsWith('Existing draft\n\n> #'));
    await page.locator('#chat-input').fill('');
    await page.locator('#chat-input').dispatchEvent('input');
    await block.getByRole('button', {name: '交互预览', exact: true}).click();
    const preview = page.frameLocator('.interactive-preview-frame');
    await preview.locator('#counter').waitFor();
    const previewFrame = page.frames().find(frame => frame.url().endsWith('/interactive-preview'));
    await previewFrame.waitForFunction(() => typeof document.querySelector('#counter')?.onclick === 'function');
    await preview.locator('#counter').click();
    assert.equal(await preview.locator('#counter').textContent(), '1');
    await page.waitForFunction(() => !document.body.dataset.previewEscaped);
    assert.equal(await previewFrame.evaluate(() => window.parentBlocked), true);
    await previewFrame.waitForFunction(() => window.requestBlocked === true);
    const policy = (await page.request.get(url + '/interactive-preview')).headers()['content-security-policy'];
    assert.ok(policy.includes('sandbox allow-scripts') && !policy.includes('allow-same-origin'));
    assert.ok(policy.includes("connect-src 'none'"));
    await page.screenshot({path: path.join(root, 'work/rich-chat-preview.png')});
    await page.locator('.interactive-preview').getByRole('button', {name: '关闭', exact: true}).click();
    assert.equal(await block.getByRole('button', {name: '交互预览', exact: true}).evaluate(el => el === document.activeElement), true);

    await page.evaluate(() => { selectedLanguage = 'en'; applyUiLanguage(); });
    assert.equal(await block.getByRole('button', {name: 'Interactive preview', exact: true}).count(), 1);
    await page.evaluate(() => { selectedLanguage = 'ja'; applyUiLanguage(); });
    assert.equal(await block.getByRole('button', {name: 'インタラクティブプレビュー', exact: true}).count(), 1);
    await page.evaluate(() => { selectedLanguage = 'zh-CN'; applyUiLanguage(); });

    const stream = await page.evaluate(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      state.messages = [{role: 'assistant', content: '# Streaming heading\n\nStable paragraph.\n\n```python\nprint(1)', streaming: true}];
      renderMessages(); await frame();
      state.messages[0].content += '\nprint(2)';
      renderMessages(); await frame();
      const heading = document.querySelector('#messages h1');
      state.messages[0].content += '\n```\n\n**Next paragraph**';
      renderMessages(); await frame();
      return {
        heading: !!heading,
        retained: heading === document.querySelector('#messages h1'),
        code: !!document.querySelector('#messages .code-toolbar'),
        strong: document.querySelector('#messages strong')?.textContent,
        plain: !!document.querySelector('#messages .streaming-text')
      };
    });
    assert.deepEqual(stream, {heading: true, retained: true, code: true, strong: 'Next paragraph', plain: false});
    const input = page.locator('#chat-input');
    await input.focus();
    assert.equal(await input.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#chat-form')).outlineOffset === '1px');
    await input.blur();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#chat-form')).outlineOffset === '-2px');
    const reveal = await page.evaluate(async () => {
      const message = state.messages[0];
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const heading = document.querySelector('#messages h1');
      message.content += '\n\n这段文字已经可读。';
      renderMessages(); await frame();
      message.content += '复核完成👍🏽。';
      renderMessages(); await frame();
      const tail = document.querySelector('#messages .stream-block:last-child .stream-reveal');
      const keyframes = tail?.getAnimations()[0]?.effect.getKeyframes();
      return {tail: tail?.textContent, filter: keyframes?.[0].filter,
        headingRetained: heading === document.querySelector('#messages h1'),
        text: tail?.closest('p').textContent};
    });
    assert.deepEqual(reveal, {tail: '复核完成👍🏽。', filter: 'blur(2px)', headingRetained: true, text: '这段文字已经可读。复核完成👍🏽。'});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.evaluate(async () => {
      state.messages[0].content += '无需动效';
      renderMessages();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('#messages .stream-reveal').count(), 0);
    const unsafe = await page.evaluate(() => {
      const node = markdown('<script>window.escaped=true</script><img src=x onerror="window.escaped=true"><iframe src="/api/settings"></iframe><a href="javascript:alert(1)">bad</a>');
      return !!node.querySelector('script,iframe,[onerror],[href^="javascript:"]');
    });
    assert.equal(unsafe, false);
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: path.join(root, 'work/rich-chat-mobile.png')});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({rich_markdown:true, interactive_counter:true, sandbox_isolation:true, network_blocked:true, downloads:true, quote_preserves_draft:true, incremental_rich_stream:true, responsive:true, page_errors:errors}));
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
