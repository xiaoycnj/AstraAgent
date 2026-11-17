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
      reducedMotion: 'reduce',
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




    await page.waitForFunction(()=>typeof appearanceDraft!=='undefined' && appearanceDraft && !layoutControls.disabled);
    await page.evaluate(()=>{showSettings();selectSettingsTab('appearance');});
    await page.getByRole('tab',{name:'布局与模组',exact:true}).click();
    const panel=page.locator('#layout-customization');
    await panel.waitFor();
    await panel.getByRole('switch',{name:'启用自定义布局',exact:true}).check();
    await panel.getByRole('textbox',{name:'自定义欢迎标题',exact:true}).fill('我的工作空间');
    await panel.getByRole('combobox',{name:'内容对齐',exact:true}).selectOption('left');
    await panel.getByRole('combobox',{name:'建议与快捷入口列数',exact:true}).selectOption('2');
    await panel.getByRole('combobox',{name:'输入框位置',exact:true}).selectOption('center');
    await panel.locator('[data-layout-block=hint]').getByRole('switch',{name:'显示',exact:true}).uncheck();
    await panel.locator('[data-layout-block=starters]').getByRole('button',{name:'上移',exact:true}).click();
    await panel.locator('[data-layout-block=greeting]').dragTo(panel.locator('[data-layout-block=shortcuts]'));
    assert.notEqual(await page.evaluate(()=>appearanceDraft.layout.home_order[0]),'greeting');
    await panel.locator('[data-layout-nav=schedule]').getByRole('switch',{name:'固定',exact:true}).check();
    await page.waitForFunction(()=>document.querySelector('#nav-schedule').parentElement===railTop);
    await panel.getByRole('switch',{name:'侧栏显示文字',exact:true}).check();
    await panel.getByRole('button',{name:'添加快捷入口',exact:true}).click();
    const dialog=page.locator('.layout-shortcut-dialog');
    await dialog.getByRole('textbox',{name:'按钮名称',exact:true}).fill('写作助手');
    await dialog.getByRole('combobox',{name:'入口动作',exact:true}).selectOption('prompt');
    await dialog.getByRole('textbox',{name:'提示词内容',exact:true}).fill('帮我拟一份写作提纲');
    await dialog.getByRole('button',{name:'保存',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.locator('.app-rail').getByRole('button',{name:'写作助手',exact:true}).count(),1);
    await page.evaluate(async()=>{await flushAppearance();await newSession();});
    const welcome=page.locator('#messages .welcome');
    await welcome.getByRole('heading',{name:'我的工作空间',exact:true}).waitFor();
    assert.equal(await welcome.locator(':scope>p').isHidden(),true);
    assert.equal(await welcome.locator('h1').evaluate(node=>getComputedStyle(node).textAlign),'left');
    assert.equal((await welcome.locator('.starter-grid').evaluate(node=>getComputedStyle(node).gridTemplateColumns)).split(' ').length,2);
    assert.equal(await page.evaluate(()=>document.body.classList.contains('layout-home-center')),true);
    await welcome.getByRole('button',{name:'写作助手',exact:true}).click();
    assert.equal(await page.locator('#chat-input').inputValue(),'帮我拟一份写作提纲');
    await page.waitForTimeout(5100);
    assert.equal(await welcome.locator('h1').textContent(),'我的工作空间');
    await page.reload();
    await page.waitForFunction(()=>appearanceDraft?.layout.enabled && document.querySelector('#nav-schedule')?.parentElement===railTop);
    assert.equal(await page.evaluate(()=>appearanceDraft.layout.home_columns),2);
    await page.keyboard.press('Control+Alt+l');
    await panel.waitFor();
    await page.screenshot({path:path.join(root,'work/layout-editor-desktop.png')});
    const modules=page.locator('#skin-modules');
    await modules.getByText('发现内置模组',{exact:true}).click();
    await modules.locator('.skin-mod-preset').filter({hasText:'宽屏工作台'}).getByRole('button',{name:'安装',exact:true}).click();
    const card=modules.locator('[data-mod-id=wide-workspace]');await card.waitFor();
    assert.equal(await page.evaluate(()=>effectiveAppearance().layout.home_width),1100);
    await card.getByRole('switch',{name:'启用',exact:true}).uncheck();
    assert.equal(await page.evaluate(()=>effectiveAppearance().layout.home_width),840);
    await card.getByRole('button',{name:'预览',exact:true}).click();
    await page.locator('.layout-preview-bar').waitFor();
    assert.equal(await page.evaluate(()=>effectiveAppearance().layout.home_width),1100);
    assert.equal(await page.evaluate(()=>appearanceDraft.mods[0].enabled),false);
    await page.locator('.layout-preview-bar').getByRole('button',{name:'取消预览',exact:true}).click();
    assert.equal(await page.evaluate(()=>effectiveAppearance().layout.home_width),840);
    await card.getByRole('button',{name:'设置',exact:true}).click();
    const modDialog=page.locator('.skin-mod-dialog');
    await modDialog.getByRole('spinbutton',{name:'主页内容宽度',exact:true}).fill('980');
    await modDialog.getByRole('button',{name:'保存模组',exact:true}).click();
    await modDialog.waitFor({state:'hidden'});
    await card.getByRole('switch',{name:'启用',exact:true}).check();
    assert.equal(await page.evaluate(()=>effectiveAppearance().layout.home_width),980);
    await card.locator('summary').click();
    await card.getByRole('button',{name:'编辑配置',exact:true}).click();
    await page.evaluate(()=>document.querySelector('.skin-mod-dialog .CodeMirror').CodeMirror.setValue('{bad json'));
    await modDialog.getByRole('button',{name:'保存模组',exact:true}).click();
    assert.equal(await modDialog.isVisible(),true);
    assert.equal(await page.evaluate(()=>appearanceDraft.mods[0].settings.layout.home_width),980);
    await modDialog.getByRole('button',{name:'关闭',exact:true}).click();
    const exported=page.waitForEvent('download');
    await card.getByRole('button',{name:'导出模组',exact:true}).click();
    const file=await (await exported).path();
    assert.ok(fs.statSync(file).size>100);
    await card.getByRole('button',{name:'卸载',exact:true}).click();
    await card.waitFor({state:'detached'});
    await modules.locator('input[type=file]').setInputFiles(file);
    await card.waitFor();
    assert.equal(await page.evaluate(()=>appearanceDraft.mods[0].settings.layout.home_width),980);
    await page.evaluate(async()=>{await flushAppearance();await newSession();});
    await page.screenshot({path:path.join(root,'work/layout-home-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(root,'work/layout-home-mobile.png')});
    await page.keyboard.press('Control+Alt+l');
    await page.setViewportSize({width:1440,height:1000});
    // An invalid shortcut action is rejected without changing saved state.
    await modules.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'work/skin-mod-manager.png')});
    const rejected=await page.evaluate(async()=>{
      const before=await api('/api/appearance');
      const invalid=structuredClone(before);invalid.layout.shortcuts[0].action='javascript:alert(1)';
      try{await api('/api/appearance','PUT',invalid);return false;}catch{}
      return JSON.stringify(await api('/api/appearance'))===JSON.stringify(before);
    });
    assert.equal(rejected,true);
    const anonymous=await browser.newContext();
    assert.equal((await anonymous.request.get(url+'/api/appearance')).status(),403);await anonymous.close();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({home_layout:true,sidebar_customization:true,prompt_shortcut:true,drag_buttons:true,modules:true,preview_cancel:true,config_validation:true,mod_zip:true,reload:true,responsive:true,page_errors:errors}));
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
