// Current production UI, synthetic demo data, isolated browser only.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4173';
try{
 const context=await browser.newContext({locale:'zh-CN',timezoneId:'America/New_York',viewport:{width:1400,height:1000}}),errors=[],network=[];
 await context.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():(network.push(route.request().url()),route.abort()));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/dashboard.html#review');await page.locator('.item').first().waitFor();
 assert.equal(await page.locator('body').getAttribute('data-mono-view'),'workspace','Retired hash opens the workspace');
 assert.equal(await page.locator('#daily-review,#review-dashboard,#review-metrics,#idle-seconds').count(),0);
 assert.equal(await page.locator('.nav-primary [data-pm-view]').count(),2);
 const title=await page.locator('.item-title').first().textContent();
 await page.locator('#language-en').evaluate(e=>e.click());
 assert.equal(await page.locator('html').getAttribute('lang'),'en-US');assert.equal(await page.locator('.item-title').first().textContent(),title);
 await page.locator('#settings').click();assert.equal(await page.locator('#save-settings').textContent(),'Save settings');
 const untranslated=await page.locator('#settings-dialog').evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),result=[];while(walker.nextNode())if(!walker.currentNode.parentElement.closest('#language-zh')&&/[\u3400-\u9fff]/.test(walker.currentNode.textContent))result.push(walker.currentNode.textContent.trim());return result;});
 assert.deepEqual(untranslated,[],'Static settings are fully translated');
 await page.locator('#model').evaluate(el=>{for(let node=el.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;});
 await page.locator('#model-choice').selectOption('');
 await page.locator('#model').fill('unsaved-model');
 const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(base+'/dashboard.html');await other.locator('.item').first().waitFor();
 await other.locator('#language-zh').evaluate(e=>e.click());await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
 assert.equal(await page.locator('#model').inputValue(),'unsaved-model');assert.equal(await page.locator('#save-settings').textContent(),'保存设置');
 assert.equal(await page.locator('label:has(#recording)').count(),1);
 for(const language of ['zh','en'])for(const theme of ['light','dark'])for(const width of [1400,390,320]){
  await page.locator('#language-'+language).evaluate(e=>e.click());await page.evaluate(theme=>atlasColorMode.set(theme),theme);await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${language}/${theme}/${width}`);
 }
 await page.setViewportSize({width:1400,height:1000});await page.locator('[data-mode=tabs]').click();
 await page.locator('[data-pm-view=history]').click();assert.equal(await page.locator('#day').isVisible(),true);assert.ok(await page.locator('#day').inputValue());assert.equal(await page.locator('#restore-day').isVisible(),true);
 await page.locator('[data-pm-view=workspace]').click();await page.screenshot({path:'/tmp/pickmark-021-workspace.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 console.log('PASS retired review hash fallback and absent panel/timing controls, page lists and resume date, English/Chinese settings, live cross-window language with unsaved edits, light/dark and widths 320–1400.');
}finally{await browser.close();}
