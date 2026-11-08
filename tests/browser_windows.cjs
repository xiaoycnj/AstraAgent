const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
 const page=await browser.newPage({viewport:{width:560,height:350}});
 await page.goto(pathToFileURL(path.join(root,'web/assets/startup/update.html')).href);
 assert.equal(await page.locator('#close').isVisible(),false);
 async function fits(){assert.equal(await page.evaluate(()=>{const card=document.querySelector('.card').getBoundingClientRect();return [...document.querySelectorAll('h1,.tagline,footer')].every(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=card.bottom&&r.right<=card.right;})&&document.querySelector('footer').getBoundingClientRect().top>document.querySelector('.tagline').getBoundingClientRect().bottom;}),true);}
 await fits();
 await page.evaluate(()=>setUpdateFailure('更新服务暂时拒绝请求或已限流，请稍后重试。','HTTP Error 403: rate limit exceeded '+ 'details '.repeat(100)));
 assert.equal(await page.locator('progress').isVisible(),false);
 assert.equal(await page.locator('#close').isVisible(),true);
 await page.locator('summary').click();await fits();
 await page.setViewportSize({width:544,height:311});await fits();
 await page.screenshot({path:path.join(root,'work/update-layout-fixed.png')});
 await page.setContent('<button id="before">original focus</button>');
 await page.addStyleTag({path:path.join(root,'web/assets/css/dialogs.css')});
 await page.addScriptTag({path:path.join(root,'web/assets/js/dialogs.js')});
 page.on('dialog',()=>{throw new Error('Unexpected native dialog');});
 await page.locator('#before').focus();
 await page.evaluate(()=>{window.result=undefined;appConfirm('<img src=x onerror=alert(1)>').then(v=>window.result=v);});
 await page.locator('.app-dialog[open]').waitFor();assert.equal(await page.locator('.app-dialog img').count(),0);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.result===false);
 assert.equal(await page.locator('#before').evaluate(e=>e===document.activeElement),true);
 await page.evaluate(()=>{appPrompt('名称','旧名称').then(v=>window.result=v);});
 await page.locator('.app-dialog input').fill('新名称');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.result==='新名称');
 await page.evaluate(()=>{appConfirm('first').then(v=>window.first=v);appConfirm('second').then(v=>window.second=v);});
 await page.locator('.app-dialog .primary').click();await page.locator('.app-dialog p').filter({hasText:'second'}).waitFor();await page.locator('.app-dialog .secondary').click();await page.waitForFunction(()=>window.first===true&&window.second===false);
 console.log('Updater layout, error details, custom confirm/prompt, focus, Escape and queue passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
