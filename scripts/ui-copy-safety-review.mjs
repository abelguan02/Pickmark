import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base='http://127.0.0.1:4196';
try{
 let cases=0;
 for(const lang of ['zh','en'])for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:theme==='dark'?390:1280,height:844}});
  await c.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
  const external=[];
  await c.route('**/*',r=>{if(r.request().url().startsWith(base+'/'))return r.continue();external.push(r.request().url());return r.abort();});
  // A rejected synthetic save exercises the UI error path without touching real storage.
  await c.route('**/dashboard.js*',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('async function send(message){',"async function send(message){if(message.type==='settings'&&window.reviewRejectSave)throw new Error('SIMULATED_SAVE_FAILURE');")});});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const previewBox=async()=>{
   await p.waitForFunction(()=>{const panel=document.querySelector('#inspector');return panel?.classList.contains('is-visible')&&panel.getAnimations().every(animation=>animation.playState==='finished');});
   return p.locator('#inspector').boundingBox();
  };
  await p.goto(base+'/dashboard.html');await p.locator('.item').first().waitFor();
  await p.locator('#language-'+lang).evaluate(e=>e.click());await p.evaluate(t=>window.atlasColorMode.set(t),theme);
  await p.locator('#settings').evaluate(e=>e.click());
  const form=p.locator('#settings-form');
  assert.match(await form.innerText(),lang==='zh'?/工作区可见时自动整理.*可能产生费用/:/while the workspace is visible.*fees/);
  await p.locator('.preview-capture-details summary').click();
  assert.match(await p.locator('[data-preview-details]').innerText(),lang==='zh'?/邮箱和排除网站不采集/:/Email and excluded sites are skipped/);
  assert.match(await p.locator('.setting-row').nth(1).innerText(),lang==='zh'?/授权.*只存本机.*不发送给 AI/:/permission.*local.*never sent to AI/is);
  await p.locator('#mono-auto-preview').click();assert.equal(await p.locator('#mono-auto-preview').getAttribute('aria-pressed'),'false','Demo cannot enable real capture');
  await p.locator('.ai-data summary').click();
  const privacy=await p.locator('.privacy-box').innerText();
  for(const re of lang==='zh'?[/标题、域名/,/不读取正文或发送完整网址/,/不再逐次询问/]:[/Titles, domains/,/page text and full URLs are not sent/,/without asking for each request/])assert.match(privacy,re);
  const before=await p.evaluate(()=>localStorage.getItem('atlas-demo'));
  for(const id of ['clear-preview-cache','clear-old-history','clear-data']){
   const prompt=p.waitForEvent('dialog').then(async d=>{const result={type:d.type(),message:d.message()};await d.dismiss();return result;});
   await p.locator('#'+id).click();const d=await prompt;
   assert.equal(d.type,'confirm');
   assert.match(d.message,id==='clear-preview-cache'?(lang==='zh'?/分类和记录不受影响/:/Classifications and history remain/):(lang==='zh'?/已删除日期无法回顾或补分类/:/Deleted history cannot be reviewed or classified/));
  }
  assert.equal(await p.evaluate(()=>localStorage.getItem('atlas-demo')),before,'Cancel cleanup leaves synthetic history unchanged');
  await p.locator('#ai-provider').selectOption('openai');await p.locator('#model-choice').selectOption('');
  await p.locator('#model').fill('review-model');await p.locator('#api-key').fill('synthetic-key-only');
  await p.locator('#idle-seconds').selectOption('600');await p.locator('#excluded').fill('private.example.invalid');
  const other=lang==='zh'?'en':'zh';await p.locator('#language-'+other).evaluate(e=>e.click());await p.locator('#language-'+lang).evaluate(e=>e.click());
  assert.equal(await p.locator('#model').inputValue(),'review-model');assert.equal(await p.locator('#api-key').inputValue(),'synthetic-key-only');
  assert.equal(await p.locator('#ai-provider').inputValue(),'openai');assert.equal(await p.locator('#idle-seconds').inputValue(),'600');
  assert.equal(await p.locator('#excluded').inputValue(),'private.example.invalid');
  await p.locator('#test-connection').click();assert.match(await p.locator('#connection-result').innerText(),lang==='zh'?/示例预览不保存 Key、不发送请求/:/preview does not save keys or send requests/i);
  await p.evaluate(()=>window.reviewRejectSave=true);await p.locator('#save-settings').click();
  await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('SIMULATED_SAVE_FAILURE'));
  assert.ok(await p.locator('#settings-dialog').isVisible());assert.equal(await p.locator('#api-key').inputValue(),'synthetic-key-only');
  await p.evaluate(()=>window.reviewRejectSave=false);await p.locator('#save-settings').click();
  await p.waitForFunction(()=>!document.querySelector('#settings-dialog').open);
  const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('atlas-demo')));
  assert.equal(saved.config.provider,'openai');assert.equal(saved.config.model,'review-model');assert.equal(saved.config.idleSeconds,600);
  assert.deepEqual(saved.config.excluded,['private.example.invalid']);assert.ok(!JSON.stringify(saved).includes('synthetic-key-only'),'Web preview must not store keys');
  await p.reload();await p.locator('.item').first().waitFor();await p.locator('#settings').evaluate(e=>e.click());
  assert.equal(await p.locator('#model').inputValue(),'review-model');assert.equal(await p.locator('#api-key').inputValue(),'');
  assert.equal(await p.locator('#excluded').inputValue(),'private.example.invalid');
  await p.locator('[data-pm-view=workspace]').first().evaluate(e=>e.click());
  for(const source of ['tabs','bookmarks']){
   if(source==='bookmarks'){await p.locator('[data-mode=bookmarks]').click();await p.locator('[data-pm=connect]').click();}
   assert.ok(await p.locator('#statusbar').isVisible(),'Row status returns after saving settings');
   await p.evaluate(()=>scrollTo(0,0));await p.mouse.move(1,1);const first=p.locator('.item').first();await first.hover();
   const firstPosition=await previewBox();
   const boundary=await first.evaluate(e=>Math.max(1,Math.floor(document.querySelector('#inspector .floating-art').getBoundingClientRect().height/e.getBoundingClientRect().height)));
   await p.locator('.item').nth(boundary).hover();
   const nextPosition=await previewBox();assert.ok(nextPosition.y>firstPosition.y+10,'Next group still moves down after save/reload');
   await first.hover();const backPosition=await previewBox();assert.ok(Math.abs(backPosition.y-firstPosition.y)<1,`Reverse traversal restores its group: ${lang}/${theme}/${source}`);
   assert.equal(await p.locator('#inspector').evaluate(e=>getComputedStyle(e).zIndex),'-1');
   assert.equal(await first.locator('.row-details').evaluate(e=>getComputedStyle(e,'::before').mixBlendMode),'difference');
  }
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);cases++;await c.close();
 }
 console.log(`PASS ${cases} safety/save/reload scenarios: required notices, cleanup cancel, language-preserved draft, failed-save recovery, demo key isolation and tab/bookmark groups after save`);
}finally{await browser.close();}
