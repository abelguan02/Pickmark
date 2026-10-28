import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4196';
try{
 const context=await browser.newContext({locale:'zh-CN',viewport:{width:1100,height:844}});
 const network=[],errors=[];
 await context.route('**/*',r=>{if(r.request().url().startsWith(base+'/'))return r.continue();network.push(r.request().url());return r.abort();});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/dashboard.html');await p.locator('#pickmark-guide[open]').waitFor();
 await p.locator('#pickmark-guide [data-skip]').click();await p.reload();await p.locator('.item').first().waitFor();
 assert.equal(await p.locator('#pickmark-guide').evaluate(e=>e.open),false);
 await p.locator('#settings').click();await p.locator('#excluded').fill('example.invalid');await p.locator('#open-about-help').click();
 await p.locator('#pickmark-about [data-about-link=support]').click();
 assert.match(await p.locator('#pickmark-about').innerText(),/二维码待配置/);
 assert.equal(await p.locator('#pickmark-about a').count(),2);
 assert.equal(await p.locator('#about-support-panel a,#about-support-panel img').count(),0);
 for(const width of [1100,390,320])for(const theme of ['light','dark']){
  await p.setViewportSize({width,height:844});await p.evaluate(t=>window.atlasColorMode.set(t),theme);
  const box=await p.locator('#pickmark-about').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
  assert.equal(await p.locator('#pickmark-about').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  if(width===390)await p.screenshot({path:`/tmp/pickmark-about-${theme}.png`});
 }
 await p.locator('#pickmark-about [data-guide]').click();
 for(let i=0;i<3;i++)await p.locator('#pickmark-guide [data-next]').click();
 assert.equal(await p.locator('#pickmark-guide').evaluate(e=>e.open),false);
 assert.equal(await p.locator('#excluded').inputValue(),'example.invalid','Help preserves unsaved settings');
 await p.locator('#language-en').click();await p.locator('#open-about-help').click();assert.match(await p.locator('#pickmark-about').innerText(),/ABOUT & HELP/);
 await p.locator('#pickmark-about [data-guide]').click();assert.match(await p.locator('#guide-title').innerText(),/One workspace/);await p.keyboard.press('Escape');
 assert.equal(await p.locator('#pickmark-guide').evaluate(e=>e.open),false);
 await p.reload();await p.locator('.item').first().waitFor();assert.equal(await p.locator('#pickmark-guide').evaluate(e=>e.open),false);
 assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
 const fresh=await context.newPage();
 await fresh.addInitScript(()=>{localStorage.removeItem('pickmark-guide-v1');Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
 await fresh.goto(base+'/dashboard.html');await fresh.locator('#pickmark-guide [data-skip]').click();assert.equal(await fresh.locator('#pickmark-guide').evaluate(e=>e.open),false,'Storage failure cannot trap the user in onboarding');
 console.log('PASS first use, skip/reload, replay/complete/Escape, bilingual help, configured project links and unconfigured QR, light/dark narrow layouts, no external requests');
}finally{await browser.close();}
