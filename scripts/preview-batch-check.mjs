// Full extension UI in a disposable headless profile; never touches personal data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pickmark-batch-check-'));
const extension=path.join(temp,'extension');await fs.cp(path.resolve('extension'),extension,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json')));
assert.deepEqual(manifest.optional_host_permissions,['<all_urls>']);
assert.ok(!manifest.permissions.includes('bookmarks'));
// Pre-grant only in this test copy. The shipped manifest stays optional;
// this run tests the authorized path, not Chrome's permission dialog.
manifest.host_permissions.push('<all_urls>');manifest.permissions.push('bookmarks');
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const requests=[],delays=new Set();
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
 const render=()=>{res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(`<!doctype html><html style="background:rgb(31,91,178);height:100%"><head><title>${url.pathname}</title></head><body><h1>Local preview fixture</h1></body></html>`);};
 if(url.pathname.startsWith('/slow')||url.pathname==='/never-ready'){const timer=setTimeout(()=>{delays.delete(timer);render();},url.pathname==='/never-ready'?30000:10000);delays.add(timer);}else render();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let context;
async function until(fn,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('Preview regression timed out');}
try{
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{
  ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,locale:'zh-CN',viewport:null,
  ignoreDefaultArgs:['--disable-extensions','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],
  args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000}),id=new URL(worker.url()).hostname;
 const first=await context.newPage();await first.goto(base+'/scope-a');const second=await context.newPage();await second.goto(base+'/scope-b');
 const dashboard=await context.newPage(),errors=[];dashboard.on('pageerror',e=>errors.push(e.message));
 await dashboard.setViewportSize({width:1280,height:900});
 await dashboard.goto(`chrome-extension://${id}/dashboard.html`);await dashboard.locator('#pickmark-guide [data-skip]').click();
 const message=input=>dashboard.evaluate(async input=>{if(input.type==='preview:batchStart'){const window=await chrome.windows.getCurrent();input={...input,windowId:window.id};}const r=await chrome.runtime.sendMessage(input);if(r.error)throw Error(r.error);return r.value;},input);
 await dashboard.locator('[data-pm="fill-previews"]').waitFor();
 await dashboard.locator('#mono-search-toggle').click();await dashboard.locator('#search').fill('scope-a');
 await until(async()=>await dashboard.locator('#mono-list .item').count()===1);
 await dashboard.locator('[data-pm="fill-previews"]').click();
 const firstJob=await until(async()=>{const s=await message({type:'preview:batchStatus'});return s.state==='complete'?s:null;});
 assert.equal(firstJob.saved,1);assert.equal(firstJob.total,1);
 assert.equal(requests.filter(p=>p==='/scope-a').length,2);assert.equal(requests.filter(p=>p==='/scope-b').length,1);
 assert.equal(first.isClosed(),false);assert.equal(second.isClosed(),false);
 const pixels=await dashboard.evaluate(async url=>{
  const {value:image,error}=await chrome.runtime.sendMessage({type:'thumbnail:get',url});if(error)throw Error(error);
  const bytes=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
  return Array.from(ctx.getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height/2),1,1).data);
 },base+'/scope-a');
 assert.ok([31,91,178].every((v,i)=>Math.abs(v-pixels[i])<8),JSON.stringify(pixels));
 const usage=await message({type:'thumbnail:usage'});assert.equal(usage.count,1);assert.equal(usage.maxBytes,50_000_000);assert.equal(usage.maxItems,500);assert.ok(usage.bytes>100);
 await until(async()=>/1 \/ 500/.test(await dashboard.locator('[data-cache-usage]').textContent()));
 await dashboard.locator('[data-pm="fill-previews"]').click();
 const cachedJob=await until(async()=>{const s=await message({type:'preview:batchStatus'});return s.state==='complete'&&s.total===0?s:null;});
 assert.equal(cachedJob.skipReasons.cached,1);
 await until(async()=>/已有预览 1/.test(await dashboard.locator('[data-batch-skips]').textContent()));
 assert.equal(requests.filter(p=>p==='/scope-a').length,2);
 await worker.evaluate(async base=>{
  const folder=await chrome.bookmarks.create({title:'Batch fixture'});
  for(let i=0;i<102;i++)await chrome.bookmarks.create({parentId:folder.id,title:`Bookmark ${String(i).padStart(3,'0')}`,url:`${base}/bookmark/${i}`});
 },base);
 await dashboard.locator('[data-mode="bookmarks"]').click();
 await until(async()=>await dashboard.locator('#mono-list .item').count()===100);
 await dashboard.locator('[data-pm-page="1"]').click();
 assert.equal(await dashboard.locator('#mono-list .item').count(),2);
 const before=await message({type:'get'}),beforeURLs=before.records.map(r=>r.url).sort();
 await dashboard.locator('[data-pm="fill-previews"]').click();
 const bookJob=await until(async()=>{const s=await message({type:'preview:batchStatus'});return s.state==='complete'&&s.total===2?s:null;});
 assert.equal(bookJob.saved,2);assert.deepEqual(requests.filter(p=>p.startsWith('/bookmark/')).sort(),['/bookmark/100','/bookmark/101']);
 const after=await message({type:'get'});assert.deepEqual(after.records.map(r=>r.url).sort(),beforeURLs);
 assert.equal(after.visits,undefined);assert.equal(after.tabs.length,2);
 await dashboard.locator('[data-pm-layout="gallery"]').click();
 await until(async()=>await dashboard.locator('#mono-list .cached-thumbnail').count()===2);
 await dashboard.locator('#mono-search-toggle').click();
 for(const img of await dashboard.locator('#mono-list .cached-thumbnail').all())await img.evaluate(n=>n.decode());
 await dashboard.screenshot({path:path.join(os.tmpdir(),'preview-batch-desktop.png'),fullPage:true,animations:'disabled'});
 await dashboard.locator('#settings').click();await dashboard.locator('#language-en').click();await dashboard.locator('[data-pm-view="folders"]').click();
 assert.ok(/50 MB.*500 images/.test(await dashboard.locator('[data-cache-usage]').textContent()));
 assert.equal(await dashboard.locator('[data-pm="fill-previews"]').textContent(),'Fill previews');
 await dashboard.setViewportSize({width:390,height:844});
 if(await dashboard.locator('#rail').evaluate(n=>n.classList.contains('open')))await dashboard.locator('#menu').click();
 await until(()=>dashboard.locator('#rail').evaluate(n=>n.getBoundingClientRect().right<=1));
 await dashboard.evaluate(()=>window.atlasColorMode.set('dark'));
 await dashboard.screenshot({path:path.resolve('docs/preview-batch-mobile.png'),fullPage:true,animations:'disabled'});
 assert.ok(await dashboard.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
 await dashboard.setViewportSize({width:1280,height:900});
 await dashboard.evaluate(()=>window.atlasColorMode.set('light'));
 await worker.evaluate(async base=>{await chrome.bookmarks.create({title:'Slow cancellation fixture',url:base+'/slow/cancel'});},base);
 await dashboard.locator('[data-pm="refresh"]').click();await dashboard.locator('#mono-search-toggle').click();await dashboard.locator('#search').fill('Slow cancellation');
 await until(async()=>await dashboard.locator('#mono-list .gallery-card').count()===1);
 await dashboard.locator('[data-pm="fill-previews"]').click();
 await until(()=>requests.includes('/slow/cancel'));
 assert.ok((await dashboard.locator('[data-batch-status]').textContent()).includes('0/1'));
 const during=await message({type:'get'});assert.deepEqual(during.records.map(r=>r.url).sort(),beforeURLs);assert.equal(during.tabs.length,2);
 const cancelAt=Date.now();await dashboard.locator('[data-batch-cancel]').click();
 await until(async()=>!(await worker.evaluate(async()=> (await chrome.storage.session.get('pickmark-preview-window-v1'))['pickmark-preview-window-v1'])),3000);
 assert.ok(Date.now()-cancelAt<3000);assert.equal((await message({type:'preview:batchStatus'})).state,'cancelled');
 assert.equal((await message({type:'thumbnail:get',url:base+'/slow/cancel'})),null);
 await dashboard.locator('#settings').click();
 await until(async()=>/3 \/ 500 images/.test(await dashboard.locator('[data-storage-stat="previews"]').textContent()));
 dashboard.once('dialog',dialog=>dialog.accept());await dashboard.locator('#clear-preview-cache').click();
 await until(async()=>/0 \/ 500 images/.test(await dashboard.locator('[data-storage-stat="previews"]').textContent()));
 assert.equal((await message({type:'thumbnail:usage'})).count,0);
 assert.equal(await message({type:'thumbnail:get',url:base+'/scope-a'}),null);
 assert.deepEqual((await message({type:'get'})).records.map(r=>r.url).sort(),beforeURLs);
 await dashboard.locator('[data-pm-view="folders"]').click();
 await message({type:'preview:batchStart',urls:[base+'/never-ready']});
 await until(async()=>/Loading page/.test(await dashboard.locator('[data-batch-note]').textContent()));
 const loadFailure=await until(async()=>{const s=await message({type:'preview:batchStatus'});return s.state==='complete'&&s.failed===1?s:null;});
 assert.equal(loadFailure.failures[0].reason,'loadTimeout');assert.ok(loadFailure.failures[0].elapsedMs>=15000);
 await dashboard.locator('[data-batch-failures] summary').click();
 assert.match(await dashboard.locator('[data-batch-failures]').textContent(),/Page document loading timed out/);
 // A delayed controlled capture failure checks that progress is not blocked by
 // the separate usage request waiting on the worker's write queue.
 await worker.evaluate(()=>{globalThis.originalCapture=chrome.debugger.sendCommand;chrome.debugger.sendCommand=(target,method,params)=>method==='Page.captureScreenshot'?new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(Error('Synthetic screenshot timeout'),{code:'CAPTURE_TIMEOUT'})),3000)):globalThis.originalCapture(target,method,params);});
 try{
  await message({type:'preview:batchStart',urls:[base+'/capture-failure']});
  await until(async()=>/Generating preview/.test(await dashboard.locator('[data-batch-note]').textContent()),2500);
  const captureFailure=await until(async()=>{const s=await message({type:'preview:batchStatus'});return s.state==='complete'&&s.failed===1?s:null;});
  assert.equal(captureFailure.failures[0].reason,'captureTimeout');
  await until(async()=>/Browser screenshot timed out/.test(await dashboard.locator('[data-batch-failures]').textContent()));
 }finally{await worker.evaluate(()=>{chrome.debugger.sendCommand=globalThis.originalCapture;delete globalThis.originalCapture;});}
 assert.equal((await message({type:'thumbnail:usage'})).count,0);
 assert.deepEqual((await message({type:'get'})).records.map(r=>r.url).sort(),beforeURLs);
 await dashboard.setViewportSize({width:390,height:844});
 assert.ok(await dashboard.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Failure details mobile overflow');
 assert.ok(await dashboard.locator('[data-batch-failures] summary').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)<=14),'Failure disclosure inherits oversized menu text');
 await dashboard.screenshot({path:path.resolve('docs/preview-failure-details.png'),fullPage:true,animations:'disabled'});
 assert.deepEqual(errors,[]);
 console.log('PASS list scope, real pixels, usage and skip reasons, responsive phases, distinct load/capture failures, mobile layout, cancellation, cache cleanup and unchanged records.');
}finally{
 try{if(context)await context.close();}finally{
  for(const timer of delays)clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});
 }
}
