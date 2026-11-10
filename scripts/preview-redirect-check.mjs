// Actual redirects and screenshots, exclusively in an isolated local profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {defaults} from '../extension/core.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pickmark-preview-redirect-'));
const extension=path.join(temp,'extension');
fs.cpSync(path.resolve(import.meta.dirname,'../extension'),extension,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(extension+'/manifest.json','utf8'));
manifest.permissions.push('bookmarks');manifest.host_permissions.push('<all_urls>');
fs.writeFileSync(extension+'/manifest.json',JSON.stringify(manifest));
const background=extension+'/background.js';
fs.writeFileSync(background,fs.readFileSync(background,'utf8').replace('const previews=thumbnailWorker({api:chrome,serial});',`const previews=thumbnailWorker({api:chrome,serial});
globalThis.redirectReview={previews,serial,handleThumbnail,captures:0};
const originalCapture=chrome.tabs.captureVisibleTab.bind(chrome.tabs);
chrome.tabs.captureVisibleTab=(...args)=>{redirectReview.captures++;return originalCapture(...args);};`));
const dashboard=extension+'/dashboard.js';
fs.writeFileSync(dashboard,fs.readFileSync(dashboard,'utf8').replace('function scheduleAuto(){','function scheduleAuto(){return;'));
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store, max-age=0');
 if(['/entry','/second-entry'].includes(req.url)){res.writeHead(302,{Location:'/middle'});res.end();return;}
 if(req.url==='/middle'){res.writeHead(303,{Location:'/page?from=bookmark'});res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
 res.end('<title>Local preview fixture</title><style>body{background:#eef1f8;color:#161820;font:24px sans-serif;padding:40px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}article{height:140px;background:#356acc;color:white;padding:20px}article:nth-child(even){background:#1d2342}</style><h1>Local design collection</h1><p>Simulated content only</p><section>'+Array.from({length:12},(_,i)=>`<article>Study ${i+1}</article>`).join('')+'</section>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,source=base+'/entry',final=base+'/page?from=bookmark';
let context;
try{
 context=await chromium.launchPersistentContext(temp+'/profile',{executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--disable-background-networking'],viewport:{width:1280,height:900},locale:'zh-CN'});
 await context.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await context.route('**/*',route=>/^(chrome-extension:|data:)/.test(route.request().url())||route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const origin='chrome-extension://'+new URL(worker.url()).hostname;
 const bookmark=await worker.evaluate(async({source,config})=>redirectReview.serial(async()=>{
  const bookmark=await chrome.bookmarks.create({title:'Local collection',url:source});
  await chrome.storage.local.set({config,lastCleanupAt:Date.now(),'pickmark-auto-preview-v1':true,'pickmark-thumbnails-v1':{},'pickmark-bookmarks-v1':{metadata:{[bookmark.id]:{url:source,group:'Human bookmark',manualGroup:true}},groups:['Human bookmark'],rules:[],revision:1}});
  return bookmark;
 }),{source,config:{...defaults(),recording:true}});
 const ui=await context.newPage(),errors=[];ui.on('pageerror',error=>errors.push(error.message));
 await ui.goto(origin+'/dashboard.html');await ui.locator('[data-mode=bookmarks]').click();
 if(await ui.locator('[data-pm=connect]').isVisible())await ui.locator('[data-pm=connect]').click();
 await ui.locator(`[data-row="${bookmark.id}"]`).waitFor();
 const opened=context.waitForEvent('page');await ui.locator(`[data-row="${bookmark.id}"] .row-origin`).click();
 const target=await opened;await target.waitForURL(final);await target.bringToFront();
 async function waitForAssociation(url){
  const end=Date.now()+20000;
  while(Date.now()<end){
   if(await worker.evaluate(async({url,final})=>(await chrome.storage.local.get('pickmark-thumbnails-v1'))['pickmark-thumbnails-v1']?.[final]?.sources?.includes(url),{url,final}))return;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Observed redirect did not acquire a saved preview');
 }
 await waitForAssociation(source);
 const saved=await worker.evaluate(async({source,final})=>{
  const {handleThumbnail}=redirectReview;
  const config=(await chrome.storage.local.get('config')).config;
  return {status:await redirectReview.previews.status(source),images:await handleThumbnail({type:'thumbnail:lookup',urls:[source,final,final+'&other=1',final.replace('/page','/other')]},chrome,config),captures:redirectReview.captures,metadata:(await chrome.storage.local.get('pickmark-bookmarks-v1'))['pickmark-bookmarks-v1'].metadata};
 },{source,final});
 assert.equal(saved.status.state,'saved');assert.deepEqual(Object.keys(saved.images),[source,final]);assert.equal(saved.images[source],saved.images[final]);
 assert.equal(saved.metadata[bookmark.id].manualGroup,true);assert.equal(saved.metadata[bookmark.id].group,'Human bookmark');
 await ui.bringToFront();await ui.locator(`[data-row="${bookmark.id}"] .row-origin`).hover();
 await ui.locator('#inspector img').waitFor();await ui.locator('#inspector [data-preview-state=saved]').waitFor();
 await ui.locator('[data-pm-layout=gallery]').click();await ui.locator('.gallery-art img').first().waitFor();
 await ui.locator('.gallery-art [data-preview-state=saved]').first().waitFor();
 const second=base+'/second-entry';
 const next=context.waitForEvent('page');await worker.evaluate(url=>chrome.tabs.create({url}),second);
 const secondPage=await next;await secondPage.waitForURL(final);await secondPage.bringToFront();await waitForAssociation(second);
 assert.equal(await worker.evaluate(()=>redirectReview.captures),saved.captures,'A fresh cached final URL is linked without another screenshot');
 // A later normal navigation is not a redirect from either bookmark.
 await secondPage.goto(base+'/unrelated');await secondPage.bringToFront();
 await worker.evaluate(()=>redirectReview.serial(()=>redirectReview.previews.capture()));
 const sourceImage=await worker.evaluate(async source=>{
  const {handleThumbnail}=redirectReview;
  return handleThumbnail({type:'thumbnail:get',url:source},chrome,(await chrome.storage.local.get('config')).config);
 },second);
 assert.equal(sourceImage,saved.images[source]);
 assert.deepEqual(errors,[]);
 console.log('PASS local 302/303 bookmark opening → automatic screenshot → original URL in hover/gallery, cached-image reuse, distinct pages, subsequent navigation and preserved manual classification.');
}finally{
 await context?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});
}
