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





    const fixture=JSON.parse(execFileSync(python,['-c',`
import sys,json
from pathlib import Path
sys.path.insert(0,'tests')
from test_intelligent_ui import DOCUMENT
import backend,intelligent_ui as iui
backend.DATA=Path(sys.argv[1]);backend.initialize()
with backend.database() as db:db.execute("INSERT INTO sessions(id,title) VALUES('iui-browser','IUI fixture')")
with backend.database() as db:result=iui.render(db,'iui-browser',DOCUMENT,'browser:fixture')
with backend.database() as db:db.execute("INSERT INTO messages(session_id,role,content) VALUES('iui-browser','assistant',?)",('示例数据，用于交互验证。\\n\\n'+result['markdown'],))
print(json.dumps(result))
`,data],{cwd:root,windowsHide:true,encoding:'utf8'}));
    await page.evaluate(async()=>{await refreshList();await openSession({id:'iui-browser',title:'IUI fixture'});});
    const ui=page.locator('.intelligent-ui');
    await ui.getByRole('heading',{name:'出行计划',exact:true}).waitFor();
    assert.equal(await ui.locator('.iui-block').count(),9);
    assert.equal(await ui.locator('img,iframe,script').count(),0);
    assert.ok((await ui.innerText()).includes('<img src=x onerror=alert(1)>'));
    await ui.locator('.iui-result-value').filter({hasText:'600 元'}).waitFor();
    const days=ui.getByRole('slider',{name:'天数',exact:false});
    await days.focus();await days.press('ArrowRight');
    await ui.locator('.iui-result-value').filter({hasText:'800 元'}).waitFor();
    await ui.getByRole('spinbutton',{name:'每天费用',exact:true}).fill('500');
    await ui.locator('.iui-result-value').filter({hasText:'2,000 元'}).waitFor();
    await ui.getByRole('checkbox',{name:'预订住宿',exact:true}).check();
    await ui.getByRole('radio',{name:'高铁',exact:true}).check();
    await ui.getByRole('radio',{name:'是',exact:true}).check();
    await ui.getByText('回答正确',{exact:true}).waitFor();
    const table=ui.locator('.iui-table-scroll');
    await table.getByRole('button',{name:'费用',exact:true}).click();
    await table.getByRole('button',{name:'费用',exact:true}).click();
    assert.ok((await table.locator('tbody tr').first().innerText()).includes('上海'));
    await ui.getByRole('searchbox',{name:'筛选表格',exact:true}).fill('杭州');
    assert.equal(await table.locator('tbody tr').count(),1);
    await ui.locator('.iui-chart-legend').getByRole('button',{name:'费用',exact:true}).click();
    assert.equal(await ui.locator('.iui-chart-bar').count(),0);
    await ui.locator('.iui-chart-legend').getByRole('button',{name:'费用',exact:true}).click();
    assert.equal(await ui.locator('.iui-chart-bar[data-negative=true]').count(),1);
    await page.evaluate(()=>{$('#chat-input').value='继续比较';});
    await ui.getByRole('button',{name:'将结果加入输入框',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#chat-input').value.includes('[x] 预订住宿'));
    const draft=await page.locator('#chat-input').inputValue();
    assert.ok(draft.startsWith('继续比较\n\n'));assert.ok(draft.includes('2,000 元'));assert.ok(draft.includes('[x] 预订住宿'));
    await page.reload();await page.waitForFunction(()=>state.token&&state.session?.id==='iui-browser');
    await ui.getByRole('checkbox',{name:'预订住宿',exact:true}).waitFor();
    assert.equal(await ui.getByRole('checkbox',{name:'预订住宿',exact:true}).isChecked(),true);
    await ui.locator('.iui-result-value').filter({hasText:'2,000 元'}).waitFor();
    // Another tab changes independent state. The local patch retries against its revision.
    await page.evaluate(async id=>{const doc=await api('/api/iui/'+id+'?session=iui-browser');await api('/api/iui/'+id+'/state','POST',{session_id:'iui-browser',revision:doc.revision,patch:{mode:'air'}});},fixture.iui_id);
    await ui.getByRole('checkbox',{name:'预订住宿',exact:true}).uncheck();
    await page.waitForFunction(()=>[...iuiDocuments.values()].every(entry=>!entry.saving&&!Object.keys(entry.pending).length));
    assert.equal(await ui.getByRole('radio',{name:'飞机',exact:true}).isChecked(),true);
    // A recoverable failed save keeps the draft and has an explicit retry.
    await page.route('**/api/iui/*/state',route=>route.abort());
    await ui.getByRole('checkbox',{name:'预订住宿',exact:true}).check();
    await ui.getByRole('button',{name:'重试',exact:true}).waitFor();
    await page.unroute('**/api/iui/*/state');
    await ui.getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>[...iuiDocuments.values()].every(entry=>!entry.error&&!entry.saving&&!Object.keys(entry.pending).length));
    const branch=await page.evaluate(async()=>{const result=await api('/api/sessions/iui-browser/branch','POST',{});await openSession(result);return result;});
    await ui.getByRole('heading',{name:'出行计划',exact:true}).waitFor();
    assert.notEqual(await ui.getAttribute('data-iui-id'),fixture.iui_id);
    assert.equal(await ui.getByRole('checkbox',{name:'预订住宿',exact:true}).isChecked(),true);
    const stranger=await page.evaluate(async id=>{try{await api('/api/iui/'+id+'?session=wrong');return false;}catch(error){return error.status===400;}},fixture.iui_id);
    assert.equal(stranger,true);
    const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(url+'/api/iui/'+fixture.iui_id+'?session=iui-browser')).status(),403);await anonymous.close();

    // Exercise the real chat endpoint and streaming tool loop using a local fixture provider.
    const http=require('node:http');let wireCalls=0,advertised=false;
    const wire=http.createServer((request,response)=>{
      let raw='';request.on('data',chunk=>raw+=chunk);request.on('end',()=>{
        const payload=JSON.parse(raw);wireCalls++;
        const hasResult=payload.messages.some(message=>message.role==='tool'&&message.content.includes('iui_id'));
        advertised ||= payload.tools?.some(tool=>tool.function.name==='render_iui');
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({model:'iui-mock',choices:[{message:hasResult?{role:'assistant',content:'在下面选择一个方案。'}:{role:'assistant',content:null,tool_calls:[{id:'call-ui',type:'function',function:{name:'render_iui',arguments:JSON.stringify({title:'实时模型界面',blocks:[{id:'choice',type:'choices',items:[{id:'a',label:'第一个方案'},{id:'b',label:'第二个方案'}]}]})}}]}}]}));
      });
    });
    await new Promise(resolve=>wire.listen(0,'127.0.0.1',resolve));
    try{
      const base='http://127.0.0.1:'+wire.address().port+'/v1';
      await page.evaluate(async base=>{
        await api('/api/settings','PUT',{base_url:base,model:'iui-mock',api_key:'fixture',vendor:'generic',api_protocol:'chat',models:[{id:'iui-mock',tool_calling:true}],timeout:10});
        const session=await api('/api/sessions','POST',{title:'实时模型调用'});await openSession(session);
        const response=await fetch('/api/sessions/'+session.id+'/chat',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':state.token},body:JSON.stringify({content:'请提供可选择的界面',model:'iui-mock',allow_tools:false,iui_enabled:true,stream:true})});
        if(!response.ok)throw Error(await response.text());
        const packets=(await response.text()).split('\n\n').flatMap(packet=>packet.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5))));
        if(packets.some(event=>event.type==='error'))throw Error(JSON.stringify(packets));
        const final=packets.find(event=>event.type==='done');
        if(!final?.content.includes('[[iui:'))throw Error('IUI marker missing');
        await openSession(session);
      },base);
      await ui.getByRole('heading',{name:'实时模型界面',exact:true}).waitFor();
      await ui.getByRole('radio',{name:'第一个方案',exact:true}).check();
      assert.equal(advertised,true);assert.equal(wireCalls,2);
    }finally{await new Promise(resolve=>wire.close(resolve));}
    await page.evaluate(async branch=>openSession(branch),branch);
    await ui.getByRole('heading',{name:'出行计划',exact:true}).waitFor();
    assert.ok(await ui.locator('.iui-option strong').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=13));
    await page.screenshot({path:path.join(root,'work/intelligent-ui-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>applyTheme('dark'));
    assert.equal(await ui.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await page.screenshot({path:path.join(root,'work/intelligent-ui-mobile.png')});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({model_stream_tool:true,native_components:9,calculator:true,keyboard:true,checklist:true,quiz:true,sorting:true,chart:true,reload:true,conflict_retry:true,network_retry:true,branch:true,session_isolation:true,responsive:true,page_errors:errors}));
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
