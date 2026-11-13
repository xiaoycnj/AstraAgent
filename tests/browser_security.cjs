/* Optional UI regression. Uses an installed Playwright and an isolated browser profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-security-ui-'));
  const data = path.join(folder, 'data');
  const python = process.env.ASTRA_TEST_PYTHON || path.join(root, 'runtimes/python/python.exe');
  const server = spawn(python, ['-u', path.join(root, 'server.py'), '--port', '0', '--data-dir', data], {
    cwd: root, env: {...process.env, PYTHONUTF8: '1'}, windowsHide: true
  });
  let log = '';
  server.stdout.on('data', chunk => log += chunk.toString());
  server.stderr.on('data', chunk => log += chunk.toString());
  let browser;
  const fixturePluginId="ui-fixture-"+Date.now();
  try {
    for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+/.test(log); i++) {
      if (server.exitCode !== null) throw new Error('Test server exited');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, 'server ready');
    const token = execFileSync(python, ['-c', 'import security_core,sys;from pathlib import Path;print(security_core.capability(Path(sys.argv[1])))', data], {cwd: root, windowsHide: true}).toString().trim();
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({headless: true, executablePath: process.env.ASTRA_TEST_BROWSER || (fs.existsSync(edge) ? edge : undefined)});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    const page = await context.newPage();
    const errors = [];
    const externalRequests=[];
    page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname))externalRequests.push(url.origin)});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
    });
    assert.equal((await context.request.get(url + '/api/bootstrap')).status(), 403);
    await page.goto(url + '/#access=' + token);
    await page.waitForFunction(() => state.token && state.settings);
    assert.equal(await page.evaluate(() => location.hash), '');
    await page.waitForSelector('#nav-home');
    assert.equal(await page.locator('.rail-top .rail-button').count(),7);
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('#sidebar-toggle').click();
    await page.waitForTimeout(280);
    assert.equal(await page.locator('#conversation-sidebar').evaluate(el=>el.inert),true);
    assert.equal(await page.locator('#nav-home').isVisible(),true);
    await page.screenshot({path:path.join(root,'work/sidebar-collapsed.png')});
    await page.reload();
    await page.waitForSelector('#nav-home');
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'false');
    await page.keyboard.press('Control+Shift+S');
    await page.waitForTimeout(280);
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('#chat-input').fill('保留这条未发送草稿');
    await page.locator('#nav-images').click();
    await page.waitForFunction(()=>appPage==='images'&&!destination.hidden);
    assert.equal(await page.locator('.studio-body').isVisible(),false);
    assert.equal(await page.locator('dialog[open]').count(),0);
    assert.equal(await page.locator('#nav-images').getAttribute('aria-current'),'page');
    await page.locator('#nav-library').click();
    await page.waitForFunction(()=>appPage==='library');
    await page.locator('#history-back').click();
    await page.waitForFunction(()=>appPage==='images');
    await page.locator('#history-forward').click();
    await page.waitForFunction(()=>appPage==='library');
    await page.evaluate(()=>api('/api/hub/record','POST',{kind:'task',action:'create',title:'Long record fixture',content:'L'.repeat(1000)}));
    await page.locator('#nav-schedule').click();
    await page.waitForFunction(()=>appPage==='schedule');
    await page.locator('.destination-body .hub-section-heading').waitFor();
    assert.equal(await page.locator('.destination-body .hub-body').isVisible(),true);
    await page.locator('.destination-body .hub-card').filter({hasText:'Long record fixture'}).getByRole('button',{name:'编辑',exact:true}).click();
    await page.locator('.hub-editor textarea').waitFor();
    assert.equal((await page.locator('.hub-editor textarea').inputValue()).length,1000);
    await page.locator('.hub-editor').getByRole('button',{name:'取消',exact:true}).click();

    assert.equal(await page.locator('dialog[open]').count(),0);
    await page.locator('#nav-home').click();
    assert.equal(await page.locator('#chat-input').inputValue(),'保留这条未发送草稿');
    await page.locator('#chat-input').fill('');
    await page.locator('#chat-input').dispatchEvent('input');
    assert.ok((await page.locator('#chat-form').boundingBox()).height<125);
    assert.ok((await page.locator('#messages').boundingBox()).height>700);
    await page.locator('#nav-more').click();
    assert.equal(await page.locator('.rail-menu').isVisible(),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.rail-menu').isVisible(),false);
    await page.locator('#nav-review').click();
    await page.locator('.workbench-drawer').waitFor();
    await page.evaluate(()=>closeWorkbench());
    await page.locator('#nav-home').click();
    const navIcons=await page.locator('.app-rail img').evaluateAll(async imgs=>{await Promise.all(imgs.map(img=>img.decode()));return imgs.every(img=>img.naturalWidth>0)});
    assert.equal(navIcons,true);
    await page.screenshot({path:path.join(root,'work/composer-preview.png')});
    assert.equal(await page.locator('.desktop-menubar .app-menu').count(),4);
    assert.equal(await page.locator('.composer-shelf').count(),1);
    await page.locator('.starter-card').first().click();
    assert.ok(await page.locator('#chat-input').inputValue());
    await page.locator('.composer-options summary').click();
    assert.equal(await page.locator('#review-toggle').isVisible(),true);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{
      state.messages=[{id:1,role:'user',content:'请审阅这段代码，并说明验证步骤。'},{id:2,role:'assistant',content:'## 审阅结果\n\n可以先核对输入约束，再检查错误路径。\n\n- 保留现有调用方式\n- 修改后执行验证\n\n```python\ndef greet(name):\n    return f"Hello, {name}"\n```'}];
      renderMessages();
    });
    await page.screenshot({path:path.join(root,'work/dialogue-desktop.png')});
    const streamReuse=await page.evaluate(async()=>{
      const previous=state.messages;const original=markdown;let parses=0;
      markdown=function(...args){parses++;return original(...args)};
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      try{
        state.messages=Array.from({length:100},(_,i)=>({id:9000+i,role:i%2?'assistant':'user',content:'Stable history '+i}));
        const draft={role:'assistant',content:'first',streaming:true};state.messages.push(draft);renderMessages();await frame();
        const first=document.querySelector('#messages>.message'),before=parses;
        for(let i=0;i<8;i++){draft.content+=' token';renderMessages();await frame()}
        return {retained:first===document.querySelector('#messages>.message'),extraParses:parses-before};
      }finally{markdown=original;state.messages=previous;renderMessages();await frame()}
    });
    assert.equal(streamReuse.retained,true);assert.equal(streamReuse.extraParses,0);

    await page.evaluate(()=>applyTheme('dark'));
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#nav-home').isVisible(),true);
    await page.locator('#sidebar-toggle').click();
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('.pane-backdrop').click({position:{x:290,y:350}});
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'),'false');
    await page.screenshot({path:path.join(root,'work/dialogue-mobile.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await page.locator('#send').isVisible(),true);
    assert.ok(await page.locator('#send').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
    assert.ok((await page.locator('#send').boundingBox()).y+40<=844);
    assert.ok((await page.locator('main').boundingBox()).height>=780);
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>applyTheme('light'));

    assert.equal(await page.evaluate(() => document.cookie.includes('astra_')), false);
    const markup = await page.evaluate(() => {
      const block = markdown('# 标题\n\n**Bold**\n\n$x^2+\\frac{1}{2}$\n\n```python\nprint("hello")\n```\n\n<span style="position:fixed;inset:0">ordinary text</span>');
      document.querySelector('#messages').replaceChildren(block);
      return {math: !!block.querySelector('.katex'), code: !!block.querySelector('.code-toolbar'),
        unsafe: !!block.querySelector('span[style*="position:fixed"]')};
    });
    assert.equal(markup.math, true);
    assert.equal(markup.code, true);
    assert.equal(markup.unsafe, false);
    await page.reload();
    await page.waitForFunction(() => state.token && state.settings);
    await page.click('#nav-settings');
    await page.evaluate(() => selectSettingsTab('general'));
    await page.getByRole('button', {name: '查看安全记录', exact: true}).click();
    await page.getByRole('heading', {name: '最近 200 条安全记录'}).waitFor();
    await page.getByRole('button', {name: '关闭', exact: true}).last().click();
    await page.evaluate(() => selectSettingsTab('connection'));
    await page.getByText('允许 HTTPS 私有网络接口（信任此服务商）', {exact: true}).waitFor();
    await page.evaluate(async()=>{
      await api('/api/providers','POST',{name:'Image fixture',type:'image_api',base_url:'http://127.0.0.1:9/v1',model:'gpt-image-1',models:[{id:'gpt-image-1',name:'Image'}]});
      await loadProviders();
      const provider=providerRows.find(row=>row.name==='Image fixture');
      expandProvider(provider.id,null,'edit');
    });
    assert.equal(await page.locator('#provider-type').inputValue(),'image_api');
    assert.equal(await page.locator('#provider-select option').evaluateAll(options=>options.some(option=>option.textContent==='Image fixture')),false);
    await page.evaluate(()=>providerDialog.close());
    const imageItem=await page.evaluate(async()=>await api('/api/attachments','POST',{name:'fixture.png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII='}));
    const imageRendered=await page.evaluate(item=>{const block=markdown('![result](/api/attachments/'+item.id+'/content)');return !!block.querySelector('img')},imageItem);
    assert.equal(imageRendered,true);
    await page.evaluate(item=>previewGeneratedImage(item),imageItem);
    await page.locator('.generated-image-dialog img').waitFor();
    await page.waitForFunction(()=>document.querySelector('.generated-image-dialog img')?.naturalWidth===1);
    await page.locator('.generated-image-dialog button').click();

    await page.locator('#nav-library').click();
    await page.waitForFunction(()=>appPage==='library'&&libraryAssets.some(item=>item.name==='fixture.png'));
    await page.locator('.asset-card').first().waitFor();
    assert.equal(await page.locator('.studio-body').isVisible(),false);
    assert.equal(await page.locator('dialog[open]').count(),0);
    await page.screenshot({path:path.join(root,'work/library-page.png')});
    await page.locator('#nav-plugins').click();
    await page.locator('#settings:not([hidden])').waitFor();
    assert.equal(await page.locator('#destination-page').isVisible(),false,'settings must replace library');
    assert.equal(await page.locator('#app>main').evaluate(el=>el.inert),true,'background content must be inert');
    await page.evaluate(()=>applyTheme('dark'));
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(root,'work/settings-exclusive.png')});
    await page.getByRole('button',{name:'返回对话',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#settings').hidden);
    assert.equal(await page.locator('#destination-page').isVisible(),true);
    assert.equal(await page.locator('#app>main').evaluate(el=>el.inert),false);
    for(const origin of ['images','schedule','home']){
      await page.locator('#nav-'+origin).click();
      await page.waitForFunction(name=>appPage===name,origin);
      // The File menu retains its original showSettings callback.
      const fileMenu=page.locator('.desktop-menubar .app-menu').first();
      await fileMenu.locator('summary').click();
      await fileMenu.getByRole('button',{name:'设置',exact:true}).click();
      assert.equal(await page.locator('#destination-page').isVisible(),false);
      assert.equal(await page.locator('.studio-body').isVisible(),false);
      assert.equal(await page.locator('#app>main').evaluate(el=>el.inert),true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.querySelector('#settings').hidden);
      assert.equal(await page.locator('#app>main').evaluate(el=>el.inert),false);
      assert.equal(await page.evaluate(()=>appPage),origin);
      assert.equal(await page.locator('#destination-page').isVisible(),origin!=='home');
    }
    await page.locator('#nav-library').click();

    await page.reload();
    await page.waitForFunction(()=>appPage==='library'&&!!document.querySelector('.asset-card'));
    await page.locator('#nav-home').click();
    await page.evaluate(()=>applyTheme('dark'));
    await page.screenshot({path:path.join(root,'work/compact-dark.png')});
    await page.evaluate(()=>{showSettings();selectSettingsTab('voice');});
    await page.locator('#stt-local-preset').click();
    assert.equal(await page.locator('#stt-base_url').inputValue(),'http://127.0.0.1:8790/v1');
    assert.equal(await page.locator('#stt-model').inputValue(),'base');
    assert.equal(await page.locator('#stt-language').inputValue(),'zh');
    assert.equal(await page.locator('#stt-clear-key').isChecked(),false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('#settings').hidden);
    const recoverySession=await page.evaluate(()=>api('/api/sessions','POST',{title:'Recovery fixture'}));
    execFileSync(python,['-c',`
import contextlib,json,sqlite3,sys
from pathlib import Path
import execution_state
data=Path(sys.argv[1]);sid=sys.argv[2];key='ui-recovery-fixture';db=sqlite3.connect(data/'workspace.sqlite3');db.row_factory=sqlite3.Row
db.execute("INSERT INTO runs(id,session_id,status,events) VALUES('ui-recovery-run',?,'interrupted','[]')",(sid,))
db.execute("INSERT INTO stream_requests(id,session_id,hash,run_id,status,input) VALUES(?,?,'hash','ui-recovery-run','interrupted',?)",(key,sid,json.dumps({'content':'Recover task','attachments':[]})))
execution_state.create(db,key,sid,{'model':'fixture','allow_tools':False},{'access_policy':'ask','model':'fixture'})
db.commit()
@contextlib.contextmanager
def database():
 yield db
 db.commit()
state=execution_state.State(database,key)
state.initial({'model':'fixture','messages':[{'role':'user','content':'Recover task'}],'stream':False})
state.begin('model:0','model','fixture',{'model':'fixture'})
state.done('model:0',{'choices':[{'message':{'content':'Recovered from checkpoint'}}]})
state.begin('final-memory','memory','memory',{});state.phase('final-memory','executing');state.pause('restart')
state.close();db.close()
`,data,recoverySession.id],{cwd:root,windowsHide:true});
    await page.evaluate(session=>openSession(session),recoverySession);
    await page.locator('.execution-recovery:not([hidden])').waitFor();
    assert.equal(await page.locator('[data-resume-execution]').isDisabled(),true);
    await page.locator('.execution-recovery summary').click();
    await page.locator('.execution-recovery').getByRole('button',{name:'跳过此步骤',exact:true}).click();
    await page.locator('.app-dialog').getByRole('button',{name:'确认',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-resume-execution]')?.disabled);
    await page.screenshot({path:path.join(root,'work/execution-recovery.png')});
    await page.locator('[data-resume-execution]').click();
    await page.waitForFunction(()=>state.messages.some(m=>m.content==='Recovered from checkpoint'));
    assert.equal(await page.locator('.execution-recovery').isVisible(),false);
    // Application dialogs must preserve dirty settings and editor cancellation.
    const nativeDialogs=[];page.on('dialog',dialog=>{nativeDialogs.push(dialog.type());dialog.dismiss();});
    await page.evaluate(()=>{showSettings();settingsDirty=true;window.closedSettings=undefined;void closeSettingsPage().then(v=>window.closedSettings=v);});
    await page.locator('.app-dialog .secondary').click();
    await page.waitForFunction(()=>window.closedSettings===false);
    assert.equal(await page.locator('#settings').isVisible(),true);
    await page.evaluate(()=>{void closeSettingsPage().then(v=>window.closedSettings=v);});
    await page.locator('.app-dialog .primary').click();
    await page.waitForFunction(()=>window.closedSettings===true);
    await page.evaluate(()=>{editorDirty=true;void confirmEditorChange().then(v=>window.editorAllowed=v);});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>window.editorAllowed===false);
    assert.equal(await page.evaluate(()=>editorDirty),true);
    await page.evaluate(()=>{editorDirty=false;});
    assert.deepEqual(nativeDialogs,[]);
    await page.evaluate(()=>{
      window.dragCalls=0;window.controlCalls=[];
      window.pywebview={api:{window_chrome:async body=>{window.chromeRegions=body;return {ready:true};},window_drag:async()=>{window.dragCalls++;},window_control:async action=>{window.controlCalls.push(action);return {};}}};
      dispatchEvent(new Event('pywebviewready'));
    });
    await page.waitForFunction(()=>nativeChromeReady&&window.chromeRegions?.drag?.[0]?.[2]>0);
    const dragBox=await page.locator('.titlebar-drag').boundingBox();
    await page.mouse.click(dragBox.x+dragBox.width/2,dragBox.y+dragBox.height/2);
    await page.waitForFunction(()=>window.dragCalls===1);
    await page.locator('#window-maximize').click();
    await page.waitForFunction(()=>window.controlCalls.includes('maximize'));
    assert.equal(await page.evaluate(()=>window.dragCalls),1,'window buttons must not start dragging');
    assert.equal((await context.request.get(url+'/api/dlc/status')).status(),200);
    let dlcPhase='idle',dlcInstalledFixture=[];
    await page.route('**/api/dlc**',async route=>{
      const request=route.request(),pathname=new URL(request.url()).pathname;
      if(pathname==='/api/dlc/install'){
        assert.deepEqual(request.postDataJSON(),{release:'v3.4.1',asset_id:42});dlcPhase='downloading';
        return route.fulfill({status:202,json:{phase:'resolving'}});
      }
      if(pathname==='/api/dlc/cancel'){dlcPhase='cancelled';return route.fulfill({json:{phase:dlcPhase}});}
      if(pathname==='/api/dlc/status')return route.fulfill({json:{phase:dlcPhase,received:50,total:100,message:dlcPhase==='complete'?'DLC 安装完成':dlcPhase==='cancelled'?'已取消，未安装 DLC':'正在下载',installed:dlcInstalledFixture,result:dlcPhase==='complete'?{id:'demo-pack',backup:'dlcs/.backups/demo-old'}:null}});
      return route.fulfill({json:{release:'v3.4.1',installed:[],assets:[{asset_id:42,name:'AstraAgent-demo-DLC-v1.0.0-win-x64.zip',size:100,available:true}]}});
    });
    await page.evaluate(()=>{showSettings();selectSettingsTab('about');});
    await page.locator('#dlc-refresh').click();
    await page.locator('[data-dlc-install]').click();
    await page.locator('.app-dialog .primary').click();
    await page.locator('.dlc-state[data-phase=downloading]').waitFor();
    assert.equal(await page.locator('.dlc-state progress').getAttribute('value'),'0.5');
    await page.locator('.dlc-state').getByRole('button',{name:'取消下载',exact:true}).click();
    await page.locator('.dlc-state[data-phase=cancelled]').waitFor();
    await page.locator('[data-dlc-install]').click();
    await page.locator('.app-dialog .primary').click();
    await page.locator('.dlc-state[data-phase=downloading]').waitFor();
    dlcPhase='complete';dlcInstalledFixture=[{id:'demo-pack',version:'1.0.0',path:'dlcs/demo-pack'}];
    await page.evaluate(()=>refreshDLCStatus());
    await page.locator('.dlc-state[data-phase=complete]').waitFor();
    assert.match(await page.locator('.dlc-installed').textContent(),/demo-pack/);
    assert.match(await page.locator('.dlc-state').textContent(),/dlcs\/.backups\/demo-old/);
    await page.locator('#dlc-manager').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'work/dlc-manager-desktop.png')});
    await page.evaluate(()=>closeSettingsPage());
    const ocrFixture=await page.evaluate(async()=>{const item=await api('/api/attachments','POST',{name:'ocr-ui.png',data:btoa('\x89PNG\r\n\x1a\nfixture')});pendingAttachments.push(item);renderAttachmentTray();return item;});
    await page.route('**/api/document/status',route=>route.fulfill({json:{available:true}}));
    await page.route('**/api/attachments/'+ocrFixture.id+'/ocr',route=>route.fulfill({json:{...ocrFixture,ocr_status:'complete'}}));
    await page.route('**/api/attachments/'+ocrFixture.id+'/preview',route=>route.fulfill({json:{text:'OCR2026',pages:[{number:1,lines:[{text:'OCR2026',confidence:0.99,box:[[0,0],[100,0],[100,20],[0,20]]}]}]}}));
    await page.locator('.attachment-card').filter({hasText:'ocr-ui.png'}).getByRole('button',{name:'识别文字',exact:true}).click();
    await page.waitForFunction(()=>documentDialog.open&&documentBody.textContent.includes('OCR2026'));
    assert.match(await page.evaluate(()=>documentBody.textContent),/第 1 页/);
    await page.evaluate(()=>documentDialog.close());
    await page.evaluate(()=>{showSettings();selectSettingsTab('profile');});
    await page.waitForFunction(()=>localProfile.display_name&&profileForm.hidden);
    await page.getByRole('button',{name:'编辑资料',exact:true}).click();
    await page.locator('#profile-region').fill('中国（澳门）');
    await page.getByRole('button',{name:'保存资料',exact:true}).click();
    await page.waitForFunction(()=>profileForm.hidden&&localProfile.region==='中国（澳门）');
    assert.match(await page.locator('.profile-read-view').textContent(),/中国（澳门）/);
    await page.evaluate(()=>{selectSettingsTab('capabilities');selectIntegration('plugins');});
    await page.getByRole('button',{name:'创建应用插件',exact:true}).click();
    await page.locator('#maker-id').fill(fixturePluginId);
    await page.locator('#maker-name').fill('UI Fixture');
    await page.locator('#maker-description').fill('UI behavior fixture');
    await page.evaluate(()=>{makerAction.value='reading_layout';makerAction._refresh?.();});
    await page.locator('#maker-value').fill('compact');
    await page.getByRole('button',{name:'安装插件',exact:true}).click();
    await page.locator('.app-dialog .primary').click();
    await page.waitForFunction(()=>!pluginMaker.open);
    const fixtureCard=page.locator('.plugin-card').filter({hasText:'UI Fixture'});
    await fixtureCard.locator('.plugin-switch').click();
    await page.waitForFunction(()=>document.body.classList.contains('plugin-reading-compact'));
    await fixtureCard.locator('.plugin-switch').click();
    await page.waitForFunction(()=>!document.body.classList.contains('plugin-reading-compact'));
    await page.evaluate(async()=>{languageSelect.value='ja';await languageSelect.onchange();selectSettingsTab('profile');});
    await page.waitForFunction(()=>document.documentElement.lang.startsWith('ja'));
    assert.equal(await page.getByRole('button',{name:'プロフィールを編集',exact:true}).count(),1);
    await page.screenshot({path:path.join(root,'work/profile-japanese.png')});
    await page.evaluate(async()=>{languageSelect.value='zh-CN';await languageSelect.onchange();});
    await page.evaluate(()=>navigatePage('marketplace'));
    await page.waitForSelector('.market-card');
    assert.equal(await page.locator('.market-card').count(),3);
    await page.getByRole('button',{name:'UI 皮肤',exact:true}).click();
    assert.equal(await page.locator('.market-card').count(),4);
    const originalTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
    await page.locator('[data-package-id="midnight-orbit"]').getByRole('button',{name:'预览',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
    await page.getByRole('button',{name:'取消预览',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),originalTheme);
    await page.locator('[data-package-id="midnight-orbit"]').getByRole('button',{name:'预览',exact:true}).click();
    await page.getByRole('button',{name:'应用皮肤',exact:true}).click();
    await page.waitForFunction(()=>marketData.state.active_skin==='midnight-orbit'&&!skinPreview);
    await page.reload();
    await page.waitForFunction(()=>marketData?.state.active_skin==='midnight-orbit');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
    await page.getByRole('button',{name:'UI 皮肤',exact:true}).click();
    await page.screenshot({path:path.join(root,'work/marketplace-skins.png')});
    await page.getByRole('button',{name:'恢复原外观',exact:true}).click();
    await page.waitForFunction(()=>marketData.state.active_skin===null);
    await page.getByRole('button',{name:'插件',exact:true}).click();
    await page.locator('[data-package-id="focus-session"]').getByRole('button',{name:'安装并启用',exact:true}).click();
    await page.locator('.app-dialog .primary').click();
    await page.waitForFunction(()=>marketData.state.installed['plugin:focus-session']);
    await page.locator('[data-package-id="focus-session"]').getByRole('button',{name:'卸载',exact:true}).click();
    await page.locator('.app-dialog .primary').click();
    await page.waitForFunction(()=>!marketData.state.installed['plugin:focus-session']);
    await page.getByRole('searchbox',{name:'搜索插件与皮肤',exact:true}).fill('没有这个作品');
    assert.equal(await page.locator('.market-card').count(),0);
    await page.evaluate(()=>navigatePage('home'));
    await page.evaluate(async()=>{languageSelect.value='ja';await languageSelect.onchange();await navigatePage('marketplace');});
    await page.waitForFunction(()=>document.documentElement.lang.startsWith('ja'));
    await page.getByRole('button',{name:'UI テーマ',exact:true}).click();
    await page.waitForFunction(()=>destinationTabs.querySelector('.active')?.textContent==='UI テーマ');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'work/marketplace-mobile-ja.png')});
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(async()=>{languageSelect.value='zh-CN';await languageSelect.onchange();await navigatePage('home');});
    const adapterConfig=await page.evaluate(()=>{
      showSettings();selectSettingsTab('connection');expandProvider('',null,'new');
      adapterFields.vendor.value='anthropic';adapterFields.vendor.dispatchEvent(new Event('change'));
      adapterFields.cache_mode.value='1h';const result=configForm();closeProvider(true);return result;
    });
    assert.equal(adapterConfig.vendor,'anthropic');assert.equal(adapterConfig.api_protocol,'messages');assert.equal(adapterConfig.cache_mode,'1h');
    assert.equal(await page.locator('#reasoning-select option').count(),8);
    const violations = await page.evaluate(() => window.cspViolations);
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(violations, []);
    await page.screenshot({path: path.join(root, 'work/security-settings.png')});
    console.log(JSON.stringify({authenticated_boot: true, reload: true, math: true, code: true, audit_dialog: true, execution_recovery:true, page_errors: errors, csp_violations: violations}));
  } finally {
    if (browser) await browser.close();
    const fixtureFolder=path.resolve(root,'plugins',fixturePluginId);
    if(fixtureFolder.startsWith(path.resolve(root,'plugins')+path.sep)&&fs.existsSync(path.join(fixtureFolder,'manifest.json'))&&JSON.parse(fs.readFileSync(path.join(fixtureFolder,'manifest.json'),'utf8')).id===fixturePluginId)fs.rmSync(fixtureFolder,{recursive:true});
    server.kill();
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
    // This exact directory was created by mkdtemp for this test only.
    fs.rmSync(folder, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
