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




    await page.evaluate(() => showSettings());
    await page.locator('[data-settings-group=performance]').click();
    await page.locator('#settings-page-title').filter({hasText:'性能统计'}).waitFor();
    const panel=page.locator('#performance-panel');
    await panel.getByText('尚无调用记录。发送消息后会自动采集。',{exact:false}).waitFor();
    assert.equal(await panel.locator('.performance-metric').count(),6);
    const anonymous=await browser.newContext();
    assert.equal((await anonymous.request.get(url+'/api/performance')).status(),403);
    await anonymous.close();
    execFileSync(python,['-c',`
import sys,time
from pathlib import Path
import usage_meter as u
p=Path(sys.argv[1])
for i in range(55):
    c={'id':'fixture-provider','name':'Fixture','_routing':{'requested_model':'AutoRouter'},'_performance':{'duration_ms':2000+i*10,'ttft_ms':100,'generation_ms':1500,'response_model':'fast-model' if i%3 else 'fast-model-2026'}}
    u.record(p,str(i),'fast-model','api_key','completed',{'input_tokens':10,'output_tokens':100},stamp=time.time()-i*86400,config=c)
u.record(p,'legacy','old-model','api_key','completed',{'output_tokens':30},stamp=1)
u.record(p,'unsafe','<img src=x onerror=alert(1)>','api_key','failed',None)
`,data],{cwd:root,windowsHide:true});
    await panel.getByRole('button',{name:'刷新统计',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#performance-panel tbody tr').length===53);
    const metric=panel.locator('.performance-metric');
    assert.ok((await metric.nth(0).innerText()).includes('有效样本 55'));
    assert.ok((await metric.nth(4).innerText()).includes('标识不同 19'));
    assert.equal(await panel.locator('img').count(),0);
    assert.equal(await panel.locator('.performance-table-wrap').nth(1).locator('tbody tr').count(),50);
    await panel.getByRole('button',{name:'下一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#performance-panel .performance-table-wrap:last-of-type tbody tr').length!==50);
    await panel.locator('.performance-pager').getByText('2 / 2',{exact:true}).waitFor();
    assert.equal(await panel.locator('.performance-table-wrap').nth(1).locator('tbody tr').count(),7);
    await panel.getByRole('combobox',{name:'模型标识',exact:true}).selectOption('different');
    await panel.locator('.performance-pager').getByText('1 / 1',{exact:true}).waitFor();
    assert.equal(await panel.locator('.performance-table-wrap').nth(1).locator('tbody tr').count(),19);
    await panel.getByRole('button',{name:'重置筛选',exact:true}).click();
    await panel.getByRole('combobox',{name:'目标模型',exact:true}).selectOption('old-model');
    await page.waitForFunction(()=>document.querySelector('#performance-panel .performance-metric small').textContent.includes('0'));
    assert.ok((await metric.nth(0).innerText()).includes('— tok/s'));
    await panel.getByRole('button',{name:'重置筛选',exact:true}).click();
    await panel.getByRole('combobox',{name:'统计范围',exact:true}).selectOption('custom');
    await panel.getByLabel('开始日期',{exact:true}).fill('2026-12-31');
    await panel.getByLabel('结束日期',{exact:true}).fill('2026-01-01');
    await panel.getByText('开始日期不能晚于结束日期',{exact:false}).waitFor();
    await panel.getByRole('button',{name:'重置筛选',exact:true}).click();
    await panel.getByRole('button',{name:'fast-model',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#performance-panel .performance-model').length===1);
    assert.equal(await panel.getByRole('combobox',{name:'目标模型',exact:true}).inputValue(),'fast-model');
    await panel.getByRole('button',{name:'重置筛选',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#performance-panel .performance-model').length===3);

    const http=require('node:http');
    const wire=http.createServer((req,res)=>{
      req.resume();req.on('end',()=>{
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({model:'wire-response',choices:[{message:{role:'assistant',content:'OK'}}],usage:{prompt_tokens:5,completion_tokens:9}}));
      });
    });
    await new Promise(resolve=>wire.listen(0,'127.0.0.1',resolve));
    try {
      const base='http://127.0.0.1:'+wire.address().port+'/v1';
      const result=await page.evaluate(async base=>{
        await api('/api/settings/test','POST',{base_url:base,api_key:'fixture',model:'wire-target',models:[{id:'wire-target'}],vendor:'generic',api_protocol:'chat',timeout:10});
        return await api('/api/performance?model=wire-target');
      },base);
      assert.equal(result.summary.calls,1);
      assert.equal(result.rows[0].response_model,'wire-response');
      assert.equal(result.rows[0].identity,'different');
      assert.equal(result.rows[0].output,9);
      assert.ok(result.rows[0].duration_ms>0);
      assert.equal(result.rows[0].ttft_ms,null);
    } finally {await new Promise(resolve=>wire.close(resolve));}
    await panel.getByRole('button',{name:'刷新统计',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#performance-panel .performance-model').length===4);
    await page.screenshot({path:path.join(root,'work/performance-desktop.png'),fullPage:true});
    const automatic=page.waitForRequest(r=>r.url().includes('/api/performance'),{timeout:17000});
    await automatic;
    await page.waitForFunction(()=>document.querySelector('#performance-panel').getAttribute('aria-busy')==='false');
    await panel.getByRole('switch',{name:'自动刷新',exact:true}).uncheck();
    let calls=0;
    page.on('request',r=>{if(r.url().includes('/api/performance'))calls++;});
    await page.evaluate(()=>{showSettings();selectSettingsTab('appearance');});
    await page.waitForTimeout(16000);
    assert.equal(calls,0);
    await page.evaluate(()=>selectSettingsTab('performance'));
    await page.waitForFunction(()=>document.querySelector('#performance-panel').getAttribute('aria-busy')==='false');
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(root,'work/performance-mobile.png'),fullPage:true});
    // Fetch errors keep the retry action available.
    await page.route('**/api/performance?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'fixture unavailable'})}));
    await panel.getByRole('button',{name:'刷新统计',exact:true}).click();
    await panel.getByText('fixture unavailable',{exact:false}).waitFor();
    assert.equal(await panel.getByRole('button',{name:'刷新统计',exact:true}).isEnabled(),true);
    await page.unroute('**/api/performance?**');
    await panel.getByRole('button',{name:'刷新统计',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#performance-panel').getAttribute('aria-busy')==='false');
    await page.evaluate(async()=>{await api('/api/ui/language','PUT',{language:'en'});await loadLanguagePacks();});
    await panel.getByRole('button',{name:'Refresh statistics',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({history:true,filters:true,pagination:true,identity:true,unknown_timing:true,auth:true,literal_models:true,responsive:true,automatic_collection:true,automatic_refresh:true,hidden_polling_paused:true,retry:true,localization:true,page_errors:errors}));
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
