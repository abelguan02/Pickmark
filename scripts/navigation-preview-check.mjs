// Isolated demo with synthetic bookmark rows and delayed local reads.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4196';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await context.route('**/offset-ui.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('this.api=api;','this.api=api;window.navigationReview=this;')});});
 await context.route('**/dashboard.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace("if(message.type==='get')return", "if(message.type==='get'&&window.holdNavigation)await new Promise(resolve=>window.releaseNavigation=resolve);if(message.type==='get')return")});});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/dashboard.html');await page.locator('.item').first().waitFor();
 await page.evaluate(()=>{const ui=navigationReview;ui.book={rows:ui.api.state().records.slice(0,8).map((r,i)=>({...r,id:'synthetic-book-'+i,folder:'Examples'})),groups:[],rules:[],icons:{}};});
 const view=()=>page.locator('body').getAttribute('data-mono-view');
 async function navigate(name){await page.evaluate(name=>navigationReview.navigate(name),name);await page.waitForFunction(name=>document.body.dataset.monoView===name,name);}
 async function hold(){await page.evaluate(()=>{window.holdNavigation=true;window.releaseNavigation=null;});}
 async function release(){await page.evaluate(()=>{window.holdNavigation=false;window.releaseNavigation();});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
 async function settle(){await page.waitForFunction(()=>!navigationReview.navigationAnimation||navigationReview.navigationAnimation.playState==='finished');}
 // A pending settings read must neither blank the old panel nor reopen it
 // after the user has chosen another destination.
 await navigate('manage');await hold();await page.locator('#settings').click();
 await page.waitForFunction(()=>!!window.releaseNavigation);
 assert.equal(await page.locator('#workspaces-dialog').isVisible(),true,'Keep the current panel visible while settings load');
 assert.equal(await view(),'manage');
 await page.locator('[data-mode=bookmarks]').click();await release();
 assert.equal(await page.evaluate(()=>navigationReview.mode),'bookmarks');
 assert.notEqual(await view(),'settings','A stale settings read cannot take over a newer destination');
 // Returning from bookmark management to tab management must not show the
 // ordinary list between the two panels, including with a delayed read.
 await navigate('manage');await hold();await page.locator('[data-classification-source=tabs]').click();
 await page.waitForFunction(()=>!!window.releaseNavigation);
 assert.equal(await view(),'manage');assert.equal(await page.locator('#mono-panel').isVisible(),true);
 assert.ok((await page.locator('#mono-panel').innerText()).trim());
 await release();await page.waitForFunction(()=>navigationReview.mode==='tabs'&&navigationReview.panel==='manage');
 let cases=0;
 for(const lang of ['zh','en'])for(const theme of ['light','dark'])for(const width of [390,800,801,1280]){
  await page.setViewportSize({width,height:900});
  await page.locator('#language-'+lang).evaluate(e=>e.click());await page.evaluate(value=>atlasColorMode.set(value),theme);
  for(const mode of ['tabs','bookmarks']){
   await page.locator(`[data-mode=${mode}]`).click();await settle();
   await navigate('settings');await settle();
   await page.evaluate(()=>scrollTo(0,400));
   await page.locator(`[data-mode=${mode==='tabs'?'bookmarks':'tabs'}]`).click();await settle();
   assert.notEqual(await view(),'settings');assert.equal(await page.evaluate(()=>scrollY),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.locator('[data-mode=tabs]').click();await navigate('workspace');await settle();
  await page.evaluate(()=>{
   navigationReview.navigate('history');
   window.firstNavigationAnimation=navigationReview.navigationAnimation;
   navigationReview.navigate('workspace');
  });
  assert.equal(await page.evaluate(()=>firstNavigationAnimation.playState),'idle','Rapid switching cancels the older animation');
  const timing=await page.evaluate(()=>navigationReview.navigationAnimation.effect.getTiming());assert.equal(timing.duration,160);
  await settle();await page.evaluate(()=>navigationReview.api.render());
  assert.equal(await page.evaluate(()=>document.querySelector('#workspace').getAnimations().length),0,'A data refresh does not replay navigation motion');
  await page.emulateMedia({reducedMotion:'reduce'});await navigate('history');
  assert.equal(await page.evaluate(()=>document.querySelector('#workspace').getAnimations().length),0);
  await page.emulateMedia({reducedMotion:'no-preference'});cases++;
 }
 // Global status errors must not be presented as an unconfigured feature.
 // Mock only the UI status response; no browser permissions or personal data.
 await navigate('workspace');
 await page.evaluate(()=>{
  const ui=navigationReview;window.originalPreviewAPI={extension:ui.api.extension,send:ui.api.send};
  ui.api.extension=true;window.mockPreviewStatus={requested:true,authorized:false,recording:true,enabled:false};
  ui.api.send=async message=>{if(message.type==='preview:status'&&!message.url){if(window.failPreviewStatus)throw Error('Synthetic read failure');return mockPreviewStatus;}return originalPreviewAPI.send(message);};
 });
 await page.evaluate(()=>navigationReview.syncAutoPreview());
 assert.match(await page.locator('.preview-notice span').innerText(),/need permission/);
 await page.evaluate(()=>{mockPreviewStatus.authorized=true;mockPreviewStatus.recording=false;return navigationReview.syncAutoPreview();});
 assert.match(await page.locator('.preview-notice span').innerText(),/paused/);
 await page.evaluate(()=>{window.failPreviewStatus=true;return navigationReview.syncAutoPreview();});
 assert.match(await page.locator('.preview-notice span').innerText(),/Could not read/);
 assert.equal(await page.locator('.preview-notice button').innerText(),'Retry');
 await page.evaluate(()=>{window.failPreviewStatus=false;mockPreviewStatus.recording=true;mockPreviewStatus.enabled=true;});
 await page.locator('.preview-notice button').click();await page.locator('.preview-notice').waitFor({state:'hidden'});
 await page.evaluate(()=>{Object.assign(navigationReview.api,originalPreviewAPI);navigationReview.autoPreviewStatus=null;navigationReview.api.render();});
 assert.deepEqual(errors,[]);
 console.log(`PASS ${cases} navigation language/theme/width cases: delayed settings, stale navigation, management source switch, scroll reset, rapid switching, no repeated refresh animation and reduced motion.`);
}finally{await browser.close();}
