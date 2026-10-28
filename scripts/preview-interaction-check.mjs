// Real screenshots and navigation, exclusively in a disposable mock profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {defaults,dayKey} from '../extension/core.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
async function until(fn){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Preview state did not settle');}
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'pickmark-preview-ui-'));
fs.cpSync(root+'/extension',temp+'/extension',{recursive:true});
fs.writeFileSync(temp+'/extension/launcher-test.html','<!doctype html><title>Isolated launcher harness</title>');
const manifest=JSON.parse(fs.readFileSync(temp+'/extension/manifest.json'));
// Pregrant Chrome permissions only to synthetic pages in the disposable copy.
manifest.permissions.push('bookmarks');manifest.host_permissions.push('<all_urls>');
fs.writeFileSync(temp+'/extension/manifest.json',JSON.stringify(manifest));
const background=temp+'/extension/background.js';
fs.writeFileSync(background,fs.readFileSync(background,'utf8').replace('const previews=thumbnailWorker({api:chrome,serial});','const previews=thumbnailWorker({api:chrome,serial});globalThis.previewReviewSerial=serial;'));
// Classification has separate workflow coverage. Its scheduled full-page render
// must not interrupt this test's deliberately delayed preview response.
const dashboard=temp+'/extension/dashboard.js';
fs.writeFileSync(dashboard,fs.readFileSync(dashboard,'utf8').replace('function scheduleAuto(){','function scheduleAuto(){return;'));
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Preview fixture</title><style>body{background:#486cff;color:white;font:40px sans-serif;padding:50px}</style><h1>Local preview fixture</h1><p>Only simulated page content</p>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/visible`;
const context=await chromium.launchPersistentContext(temp+'/profile',{executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${temp}/extension`,`--disable-extensions-except=${temp}/extension`,'--disable-background-networking'],viewport:{width:1440,height:1000},locale:'zh-CN'});
try{
 await context.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await context.route('**/*',route=>{
  const requested=route.request().url();
  if(requested.startsWith('chrome-extension:')||requested.startsWith('data:')||requested.startsWith(`http://127.0.0.1:${server.address().port}/`))return route.continue();
  return route.abort();
 });
 let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');
 const origin='chrome-extension://'+new URL(worker.url()).hostname;
 // Exercise the toolbar's launcher against actual Chrome tabs, no personal profile.
 const harness=await context.newPage();await harness.goto(origin+'/launcher-test.html');
 await harness.evaluate(async()=>{const {dashboardLauncher}=await import(chrome.runtime.getURL('dashboard-launcher.js'));const open=dashboardLauncher(chrome);await Promise.all([open(),open()]);});
 let dashboards=(await context.pages()).filter(p=>p.url().startsWith(origin+'/dashboard.html'));
 await until(async()=>{dashboards=context.pages().filter(p=>p.url().startsWith(origin+'/dashboard.html'));return dashboards.length===1;});
 const launchPage=dashboards[0];await launchPage.goto(origin+'/dashboard.html#settings');
 await harness.evaluate(async()=>{const {dashboardLauncher}=await import(chrome.runtime.getURL('dashboard-launcher.js'));await dashboardLauncher(chrome)();});
 assert.equal(context.pages().filter(p=>p.url().startsWith(origin+'/dashboard.html')).length,1);
 assert.equal(launchPage.url(),origin+'/dashboard.html#settings');await launchPage.close();await harness.close();
 console.log('PASS full dashboard opens once, repeated clicks reuse its current view; side panel remains declared.');
 const target=await context.newPage();await target.goto(url);await target.locator('h1').waitFor();
 await worker.evaluate(async({config,url,day,yesterday})=>{
  await previewReviewSerial(async()=>{
  const folder=await chrome.bookmarks.create({title:'Synthetic only'}),bookmark=await chrome.bookmarks.create({parentId:folder.id,title:'Synthetic bookmark',url});
  await chrome.storage.local.set({config,lastCleanupAt:Date.now(),records:[{id:'current',day,url,domain:'127.0.0.1',title:'Preview fixture',group:'Human',snapshotGroup:'Human',manualGroup:true},{id:'history',day:yesterday,url:'https://history.test/mock',title:'Historical mock',domain:'history.test',group:'待整理',snapshotGroup:'待整理'}],
   'pickmark-bookmarks-v1':{metadata:{[bookmark.id]:{url,group:'Human bookmark',manualGroup:true}},groups:['Human bookmark'],rules:[],revision:1}});
  });
 },{config:{...defaults(),workspaces:['Human'],workspaceOrder:['Human']},url,day:dayKey(),yesterday:dayKey(Date.now()-86400000)});
 const ui=await context.newPage(),errors=[];ui.on('pageerror',e=>errors.push(e.message));await ui.goto(origin+'/dashboard.html');
 try{await ui.locator('[data-row=current]').waitFor();}catch(error){
  console.error('Synthetic preview fixture diagnostics',JSON.stringify({errors,body:(await ui.locator('body').innerText()).slice(0,2000),state:await worker.evaluate(async()=>({records:(await chrome.storage.local.get('records')).records,tabs:(await chrome.tabs.query({})).map(({url})=>url)}))}));throw error;
 }
 assert.equal(await ui.locator('[data-row=current] .row-group').isVisible(),false,'The redundant category column stays hidden');
 for(const selector of ['.row-origin','.row-stripes','.item-main','.row-details']){
  await ui.bringToFront();await ui.locator('[data-row=current] '+selector).click();
  await target.waitForFunction(()=>document.visibilityState==='visible');
  assert.equal(await worker.evaluate(async()=>(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0].url),url);
  assert.equal(await ui.locator('#mono-preview').evaluate(d=>d.open),false);
 }
 console.log('PASS list icon/site, transition stripes, title and visible row details all open the page once; hidden category stays hidden.');
 await ui.bringToFront();await ui.locator('[data-pm-layout=gallery]').click();
 await ui.locator('[data-row=current] .gallery-art').click();await target.waitForFunction(()=>document.visibilityState==='visible');
 assert.equal(await ui.locator('#mono-preview').evaluate(d=>d.open),false);
 await ui.bringToFront();await ui.locator('[data-row=current] [data-pm-actions]').click();await ui.locator('#mono-row-menu [data-pm-preview]').click();
 await ui.locator('#mono-preview[open]').waitFor();assert.equal(await ui.locator('#mono-capture').count(),0);
 await ui.locator('#mono-preview-open').click();await target.waitForFunction(()=>document.visibilityState==='visible');
 console.log('PASS gallery card opens page; preview is separate and has its own working Open action.');
 await ui.bringToFront();await ui.locator('#settings').click();await ui.locator('#mono-auto-preview').waitFor();
 // Declining the grant must not turn on automatic collection.
 await ui.evaluate(()=>{window.originalRequest=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=async()=>false;});
 await ui.locator('#mono-auto-preview').click();assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('pickmark-auto-preview-v1'))['pickmark-auto-preview-v1']),undefined);
 await ui.evaluate(()=>{chrome.permissions.request=window.originalRequest;});
 await ui.locator('#mono-auto-preview').click();await ui.waitForFunction(()=>document.querySelector('#mono-auto-preview').getAttribute('aria-pressed')==='true');
 await ui.locator('#brand').click();await target.bringToFront();
 await until(()=>ui.evaluate(async url=>!!(await chrome.storage.local.get('pickmark-thumbnails-v1'))['pickmark-thumbnails-v1']?.[url]?.image,url));
 assert.deepEqual(await worker.evaluate(async()=>Object.keys((await chrome.storage.local.get('pickmark-thumbnails-v1'))['pickmark-thumbnails-v1'])),[url]);
 await ui.bringToFront();await ui.locator('[data-pm-layout=gallery]').click();
 const cached=ui.locator('[data-row=current] .gallery-art img');await cached.waitFor();await cached.evaluate(img=>img.decode());
 assert.ok(await cached.evaluate(img=>img.naturalWidth>640&&img.naturalWidth<=1200&&img.naturalHeight<=750));
 console.log('PASS authorized actual visible-page capture is local, resized, and shown in gallery without opening its preview dialog.');
 await ui.locator('[data-pm-layout=list]').click();
 await until(async()=>{await ui.mouse.move(5,5);await ui.locator('[data-row=current] .row-origin').hover();try{await ui.locator('#inspector.is-visible img').waitFor({timeout:1000});return true;}catch{return false;}});
 assert.ok(await ui.locator('#inspector').evaluate(node=>Number(getComputedStyle(node).zIndex)<0));
 const cover=await ui.locator('#inspector').evaluate(node=>{const r=document.querySelector('[data-row=current] .row-details').getBoundingClientRect();node.style.pointerEvents='auto';const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);node.style.pointerEvents='';return node.contains(top);});
 assert.equal(cover,false,'OFFSET row labels intentionally paint across the hover preview');
 await ui.evaluate(()=>{window.previewChange=new Promise(resolve=>chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes['pickmark-thumbnails-v1'])resolve();}));window.savedSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async(m,...args)=>{const result=await window.savedSend(m,...args);if(m.type==='thumbnail:get')await new Promise(resolve=>setTimeout(resolve,150));return result;};});
 await worker.evaluate(async()=>{const data=await chrome.storage.local.get('pickmark-thumbnails-v1');for(const entry of Object.values(data['pickmark-thumbnails-v1']))entry.at=Date.now();await chrome.storage.local.set(data);});
 await ui.evaluate(()=>window.previewChange);
 await ui.locator('#inspector [data-preview-state=saved]').waitFor();
 await ui.locator('#inspector img').evaluate(img=>img.decode());
 await ui.locator('[data-row=current] [data-pm-actions]').click();await ui.locator('#mono-row-menu [data-pm-preview]').click();await ui.mouse.move(10,10);
 await ui.locator('#mono-preview img').waitFor();await ui.locator('#mono-preview img').evaluate(img=>img.decode());
 await ui.locator('[data-pm=close-preview]').click();await ui.evaluate(()=>{chrome.runtime.sendMessage=window.savedSend;});
 console.log('PASS delayed preview loading survives row mouse leave while the explicit dialog is open.');
 // Explicit update from a side-panel-shaped extension page keeps the web tab visible.
 const side=await context.newPage();await side.goto(origin+'/dashboard.html?surface=sidepanel');await side.locator('[data-row=current]').waitFor();
 await target.bringToFront();await side.evaluate(()=>{document.querySelector('[data-row=current] [data-pm-actions]').click();document.querySelector('#mono-row-menu [data-pm-preview]').click();});
 await side.waitForFunction(()=>!!document.querySelector('#mono-capture'));
 const beforeCaptureAt=await worker.evaluate(async url=>(await chrome.storage.local.get('pickmark-thumbnails-v1'))['pickmark-thumbnails-v1'][url].at,url);
 await side.evaluate(()=>document.querySelector('#mono-capture').click());
 await until(()=>side.evaluate(async({url,at})=>(await chrome.storage.local.get('pickmark-thumbnails-v1'))['pickmark-thumbnails-v1']?.[url]?.at>at,{url,at:beforeCaptureAt}));
 await side.close();await ui.bringToFront();
 await ui.locator('[data-mode=bookmarks]').click();await ui.locator('#mono-list .item').waitFor();
 const book=ui.locator('#mono-list .item').first();
 const [opened]=await Promise.all([context.waitForEvent('page'),book.locator('.row-stripes').click()]);await opened.waitForURL(url);await opened.close();
 await ui.bringToFront();await ui.locator('[data-pm-layout=gallery]').click();await ui.locator('.gallery-art img').waitFor();
 const [openedGrid]=await Promise.all([context.waitForEvent('page'),ui.locator('.gallery-open').first().click()]);await openedGrid.waitForURL(url);await openedGrid.close();
 await ui.bringToFront();await ui.locator('#settings').click();await ui.locator('#mono-auto-preview').click();
 await ui.waitForFunction(()=>document.querySelector('#mono-auto-preview').getAttribute('aria-pressed')==='false');
 await worker.evaluate(()=>chrome.storage.local.set({'pickmark-thumbnails-v1':{}}));
 await until(async()=>await ui.locator('#mono-list .gallery-art img').count()===0);
 const state=await worker.evaluate(async()=>chrome.storage.local.get(['records','pickmark-bookmarks-v1']));
 assert.equal(state.records.find(r=>r.id==='current').group,'Human');assert.equal(state.records.find(r=>r.id==='current').manualGroup,true);
 assert.equal(state.records.find(r=>r.id==='history').group,'待整理');assert.equal(Object.values(state['pickmark-bookmarks-v1'].metadata)[0].group,'Human bookmark');
 assert.deepEqual(errors,[]);
 console.log('PASS manual preview save, bookmark list/gallery navigation, shared cached images, disable/clear controls, manual/history/bookmark preservation; no real sites or personal profiles accessed.');
}finally{await context.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
