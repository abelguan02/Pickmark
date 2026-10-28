import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url))).version;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4196';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 const projectLinks={repo:'https://github.com/abelguan02/Pickmark',feedback:'https://github.com/abelguan02/Pickmark/issues'},external=[],opened=[];
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith(base+'/'))return route.continue();
  if(Object.values(projectLinks).includes(url)){opened.push(url);return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Mock GitHub destination</title>'});}
  external.push(url);return route.abort();
 });
 const p=await context.newPage(),errors=[];p.on('pageerror',error=>errors.push(error.message));
 await p.goto(base+'/dashboard.html');await p.locator('#top-help').waitFor();
 for(const language of ['zh','en'])for(const theme of ['light','dark'])for(const width of [320,390,838,1280]){
  await p.locator('#language-'+language).evaluate(e=>e.click());await p.evaluate(t=>atlasColorMode.set(t),theme);await p.setViewportSize({width,height:900});
  await p.locator('#top-help').click();await p.waitForFunction(()=>!document.querySelector('[data-version-copy]').disabled);
  const dialog=p.locator('#pickmark-about');
  assert.equal(await dialog.locator('[data-version]').textContent(),'v'+version);
  assert.equal(await dialog.locator('a').count(),2,'Only the configured project links');
  for(const [key,url] of Object.entries(projectLinks)){
   const link=dialog.locator(`[data-about-link=${key}]`);
   assert.equal(await link.getAttribute('href'),url);
   assert.equal(await link.getAttribute('target'),'_blank');
   assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
   assert.equal(await link.getAttribute('aria-disabled'),null);
   const popupPromise=p.waitForEvent('popup');
   if(key==='feedback'){await p.keyboard.press('2');await p.keyboard.press('Enter');}else await link.click();
   const popup=await popupPromise;await popup.waitForLoadState();
   assert.equal(popup.url(),url);
   assert.equal(await popup.evaluate(()=>window.opener===null),true,'New tab cannot control the dashboard');
   assert.equal(await popup.evaluate(()=>document.referrer),'','No dashboard referrer is sent');
   await popup.close();
   assert.equal(await dialog.evaluate(e=>e.open),true,'Opening links preserves the About dialog');
  }
  assert.equal(await dialog.locator('[data-update],[data-update-status],[data-reload],.about-update').count(),0,'Update area removed');
  const background=await dialog.evaluate(e=>getComputedStyle(e).backgroundColor);
  assert.equal(background,theme==='light'?'rgb(255, 255, 255)':'rgb(17, 17, 17)');
  assert.equal(await dialog.locator('.about-version').evaluate(e=>getComputedStyle(e).color),theme==='light'?'rgb(36, 90, 176)':'rgb(149, 189, 255)');
  assert.match(await dialog.locator('.about-cursor').evaluate(e=>getComputedStyle(e).backgroundImage),/linear-gradient/);
  assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false,'No horizontal overflow');
  assert.equal(await dialog.locator('.about-name').evaluate(e=>getComputedStyle(e).animationName),'none');
  const openedBeforeSupport=opened.length;
  await dialog.locator('[data-about-link=support]').click();assert.equal(await dialog.locator('#about-support-panel').isVisible(),true);
  assert.match(await dialog.locator('#about-support-panel').textContent(),language==='zh'?/二维码待配置/:/QR code not configured/);
  assert.equal(await dialog.locator('#about-support-panel a,#about-support-panel img,#about-support-panel canvas').count(),0);
  assert.equal(await dialog.locator('[data-about-link=support]').getAttribute('aria-expanded'),'true');
  assert.equal(opened.length,openedBeforeSupport,'Support does not navigate anywhere');
  await dialog.locator('[data-about-link=support]').click();
  if((width===1280&&language==='zh')||(width===320&&language==='en'))await p.screenshot({path:`/tmp/about-kit-${language}-${theme}-${width}.png`});
  await p.keyboard.press('1');assert.equal(await p.locator(':focus').getAttribute('data-about-link'),'repo');
  await p.keyboard.press('ArrowDown');assert.equal(await p.locator(':focus').getAttribute('data-about-link'),'feedback');
  await p.keyboard.press('Escape');assert.equal(await dialog.evaluate(e=>e.open),false);
 }
 await p.locator('#top-help').click();await p.locator('[data-guide]').click();assert.equal(await p.locator('#pickmark-guide').evaluate(e=>e.open),true);await p.locator('[data-skip]').click();
 // Clipboard is mocked so the regression never changes the user's clipboard.
 await p.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedVersion=text;}}});});
 await p.locator('#top-help').click();await p.waitForFunction(()=>!document.querySelector('[data-version-copy]').disabled);
 await p.emulateMedia({reducedMotion:'no-preference'});
 assert.equal(await p.locator('.about-cursor').evaluate(e=>getComputedStyle(e).animationName),'none','Gradient cursor stays static with animations enabled');
 await p.locator('[data-version-copy]').click();assert.equal(await p.evaluate(()=>copiedVersion),version);
 assert.match(await p.locator('[data-copy-status]').textContent(),/copied/);
 await p.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('Denied');};});
 await p.locator('[data-version-copy]').click();assert.match(await p.locator('[data-copy-status]').textContent(),/Could not copy/);
 await p.keyboard.press('Escape');
 await p.evaluate(()=>{chrome.runtime={id:'mock',getManifest:()=>({version:'9.8.7'}),requestUpdateCheck:()=>{throw Error('Removed update must not run');},reload:()=>{throw Error('Removed reload must not run');}};});
 await p.locator('#top-help').click();assert.equal(await p.locator('[data-version]').textContent(),'v9.8.7');
 await p.keyboard.press('u');assert.equal(await p.locator('[data-update]').count(),0);
 await p.keyboard.press('Escape');
 assert.equal(opened.length,32);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);console.log('PASS: 16 layout/theme/language cases, 32 mocked project-link openings by mouse/keyboard, isolated new tabs, QR placeholder, keyboard/Escape, guide, real version, copy success/failure, no unexpected network requests');
}finally{await browser.close();}
