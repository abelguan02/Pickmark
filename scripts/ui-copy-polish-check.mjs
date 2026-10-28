import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url))).version;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base='http://127.0.0.1:4196';
try{
 const c=await browser.newContext();
 await c.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await c.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/dashboard.html');await p.locator('.item').first().waitFor();
 let cases=0;
 for(const lang of ['zh','en'])for(const theme of ['light','dark'])for(const width of [320,700,1280]){
  await p.setViewportSize({width,height:844});await p.evaluate(t=>window.atlasColorMode.set(t),theme);
  await p.locator('#language-'+lang).evaluate(e=>e.click());
  await p.locator('#settings').evaluate(e=>e.click());
  assert.equal(await p.locator('#statusbar').isVisible(),false);
  assert.equal(await p.locator('#mono-about h3,#mono-about details,#mono-version').count(),0,'No duplicate inline About');
  assert.equal(await p.locator('#provider-endpoint').isVisible(),false);
  assert.match(await p.locator('#key-help').textContent(),lang==='en'?/No key configured/:/尚未配置/);
  assert.ok(await p.locator('#ai-provider').isVisible());
  await p.locator('#connection-details summary').click();
  assert.ok(await p.locator('#provider-endpoint').isVisible());
  assert.match(await p.locator('#model-help').innerText(),lang==='en'?/provider account/:/供应商账户/);
  await p.locator('#connection-details summary').click();
  const custom=p.locator('#model-choice');await custom.selectOption('');await p.locator('#model').fill('mock-model');
  assert.ok(await p.locator('#model').isVisible());
  const privacy=p.locator('.settings-disclosure.ai-data');await privacy.locator('summary').click();
  assert.match(await privacy.innerText(),lang==='en'?/titles.*domains/i:/标题、域名/);
  assert.match(await privacy.innerText(),lang==='en'?/Manual|manual/:/人工分类/);
  assert.match(await p.locator('#settings-form').innerText(),lang==='en'?/fees/:/费用/);
  if(lang==='en'){
   const copy=(await p.locator('#settings-form').innerText()).replaceAll('中文','');
   assert.equal(/[\u4e00-\u9fff]/.test(copy),false,'English settings contain no untranslated UI copy');
  }
  await privacy.locator('summary').click();
  assert.match(await p.locator('[data-cleanup=old]').innerText(),lang==='en'?/cannot be revisited/:/无法回顾/);
  await p.locator('#excluded').fill('example.invalid');
  await p.locator('#open-about-help').click();await p.waitForFunction(v=>document.querySelector('#pickmark-about [data-version]')?.textContent==='v'+v,version);
  assert.equal(await p.locator('#pickmark-about [data-version]').innerText(),'v'+version);await p.keyboard.press('Escape');
  assert.equal(await p.locator('#excluded').inputValue(),'example.invalid');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(100);
  if(width===320||width===1280)await p.screenshot({path:`/tmp/copy-polish-settings-${lang}-${theme}-${width}.png`,fullPage:true});
  await p.locator('[data-pm-view=manage]').first().evaluate(e=>e.click());
  assert.equal(await p.locator('#statusbar').isVisible(),false);
  assert.match(await p.locator('#workspace-create label').innerText(),lang==='en'?/category/i:/分类/);
  await p.locator('[data-pm-view=rules]').first().evaluate(e=>e.click());
  assert.equal(await p.locator('.rule-suggestions').isVisible(),false);
  assert.match(await p.locator('#rule-group').evaluate(e=>e.closest('label').textContent),lang==='en'?/Category/:/归入分类/);
  assert.match(await p.locator('#rule-group option').last().innerText(),lang==='en'?/New category/:/新建分类/);
  await p.locator('[data-pm-view=workspace]').first().evaluate(e=>e.click());
  assert.equal(await p.locator('#statusbar').isVisible(),true);
  await p.mouse.move(1,1);await p.locator('.item').first().hover();await p.waitForTimeout(900);
  assert.ok(await p.locator('#inspector .preview-state').isVisible());
  assert.equal(await p.locator('#inspector .placeholder-art strong,#inspector .placeholder-art .mono').count(),0);
  assert.equal(await p.locator('#inspector').evaluate(e=>getComputedStyle(e).zIndex),'-1');
  assert.match(await p.locator('#inspector .preview-state').innerText(),lang==='en'?/Awaiting visit/:/待浏览/);
  if(width===700)await p.screenshot({path:`/tmp/copy-polish-preview-${lang}-${theme}.png`});cases++;
 }
 // Bookmark classification terminology and panel status use the same source-independent UI.
 await p.locator('[data-mode=bookmarks]').click();await p.locator('[data-pm=connect]').click();
 await p.locator('[data-pm-view=manage]').first().evaluate(e=>e.click());assert.equal(await p.locator('#statusbar').isVisible(),false);
 await p.locator('[data-classification-source=tabs]').click();await p.locator('[data-classification-source=bookmarks]').click();
 assert.equal(await p.locator('[data-classification-source=bookmarks]').getAttribute('aria-pressed'),'true');
 assert.deepEqual(errors,[]);console.log(`PASS ${cases} language/theme/width cases, settings disclosures, custom models, preserved unsaved input, category terms, contextual status and compact previews`);
}finally{await browser.close();}
