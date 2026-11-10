// Disposable localhost fixture and headless Chrome only; never uses a personal profile.
// --expect-load-failure reproduces the old complete-only loader. The default is
// the desired regression: save visible content while a subresource is pending.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const expectFailure=process.argv.includes('--expect-load-failure');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pickmark-loading-check-'));
const extension=path.join(temp,'extension');
await fs.cp(path.resolve('extension'),extension,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json')));
// Only this disposable copy has capture permission pre-granted.
manifest.host_permissions.push('<all_urls>');
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
await fs.writeFile(path.join(extension,'preview-test-bridge.html'),'<!doctype html><title>Local preview loading test</title>');
const color=[31,91,178],resourceDelayMs=30_000,timers=new Set(),resources=[];
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/pending-image'){
  const resource={started:Date.now(),closed:null,finished:false};resources.push(resource);
  res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.flushHeaders();
  const timer=setTimeout(()=>{timers.delete(timer);resource.finished=true;res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));},resourceDelayMs);
  timers.add(timer);res.on('close',()=>{resource.closed=Date.now();clearTimeout(timer);timers.delete(timer);});return;
 }
 res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
 res.end(`<!doctype html><html style="height:100%;background:rgb(${color})"><head><title>Rendered local page with pending image</title></head><body><h1 id="ready">Local content is already rendered</h1><img src="/pending-image" width="1" height="1" alt=""></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/rendered-but-loading`;
let context;
async function until(fn,timeout=25_000){
 const end=Date.now()+timeout;let last;
 while(Date.now()<end){last=await fn();if(last)return last;await new Promise(resolve=>setTimeout(resolve,100));}
 throw Error('Local preview loading check timed out');
}
try{
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{
  ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,
  ignoreDefaultArgs:['--disable-extensions','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],
  args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15_000});
 const bridge=await context.newPage();await bridge.goto(`chrome-extension://${new URL(worker.url()).hostname}/preview-test-bridge.html`);
 const message=input=>bridge.evaluate(async input=>{const reply=await chrome.runtime.sendMessage(input);if(reply.error)throw Error(reply.error);return reply.value;},input);
 const placement=await bridge.evaluate(async()=>({windowId:(await chrome.windows.getCurrent()).id}));
 const started=Date.now();await message({type:'preview:batchStart',urls:[url],...placement});
 const scope=await until(()=>worker.evaluate(async()=> (await chrome.storage.session.get('pickmark-preview-window-v1'))['pickmark-preview-window-v1']));
 const documentProbe=await until(()=>worker.evaluate(async ({tabId,url})=>{
  try{const [{result}]=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},injectImmediately:true,func:()=>({url:location.href,readyState:document.readyState,hasBody:!!document.body,mainFrame:window===top})});return result?.url===url&&result.readyState!=='loading'?result:null;}catch{return null;}
 },{tabId:scope.tabId,url}),8000);
 const productionReady=expectFailure?null:await bridge.evaluate(async tabId=>{const {previewDocumentState}=await import('./preview-document.js');const [{result}]=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:previewDocumentState,injectImmediately:true});return result;},scope.tabId);
 if(!expectFailure){assert.equal(productionReady.url,url);assert.equal(productionReady.ready,true,'The production main-frame readiness probe must respond independently of visibility');}
 const page=await until(()=>context.pages().find(page=>page.url()===url),3000);
 const rendered=await page.evaluate(()=>({title:document.title,heading:document.querySelector('#ready')?.getBoundingClientRect().height,background:getComputedStyle(document.documentElement).backgroundColor,readyState:document.readyState}));
 assert.ok(rendered.heading>0);assert.equal(rendered.background,`rgb(${color.join(', ')})`);
 assert.equal(documentProbe.readyState,'interactive');assert.equal(documentProbe.mainFrame,true);assert.equal(documentProbe.hasBody,true);
 const observed=await worker.evaluate(async scope=>({tab:await chrome.tabs.get(scope.tabId),window:await chrome.windows.get(scope.windowId)}),scope);
 assert.equal(observed.tab.status,'loading');assert.equal(observed.tab.active,false);
 assert.ok(resources.some(resource=>!resource.closed&&!resource.finished),'The image request should still be pending');
 // This call is independent of the batch loader and never stores the image.
 const screenshot=await worker.evaluate(async tabId=>{
  const started=Date.now(),shot=await chrome.debugger.sendCommand({tabId},'Page.captureScreenshot',{format:'png',fromSurface:true}),image='data:image/png;base64,'+shot.data;
  const bytes=Uint8Array.from(atob(image.split(',')[1]),value=>value.charCodeAt(0));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
  ctx.drawImage(bitmap,0,0);const pixels=Array.from(ctx.getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height/2),1,1).data);bitmap.close();
  return {pixels,elapsedMs:Date.now()-started};
 },scope.tabId);
 assert.ok(color.every((value,i)=>Math.abs(value-screenshot.pixels[i])<8),JSON.stringify(screenshot));
 const result=await until(async()=>{const state=await message({type:'preview:batchStatus'});return state.state!=='running'?state:null;});
 const elapsedMs=Date.now()-started,usage=await message({type:'thumbnail:usage'}),cached=await message({type:'thumbnail:get',url});
 const savedPixels=!cached?null:await worker.evaluate(async image=>{
  const bytes=Uint8Array.from(atob(image.split(',')[1]),value=>value.charCodeAt(0));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
  ctx.drawImage(bitmap,0,0);const pixels=Array.from(ctx.getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height/2),1,1).data);bitmap.close();return pixels;
 },cached);
 const evidence={elapsedMs,resourceDelayMs,tabStatus:observed.tab.status,documentProbe,productionReady,rendered,screenshot,result,usage,savedPixels};
 console.log(JSON.stringify(evidence));
 assert.equal(result.total,1);assert.equal(result.processed,1);
 if(expectFailure){
  assert.equal(result.failed,1);assert.equal(result.saved,0);assert.equal(usage.count,0);assert.equal(cached,null);
  assert.equal(result.failures[0].reason,'timeout');assert.ok(elapsedMs>=14_000&&elapsedMs<25_000,'Expected the unchanged 15-second page-load timeout');
  console.log('REPRODUCED: production batch timed out and saved zero previews although main content was rendered and the screenshot API returned correct pixels. This local mechanism does not establish the cause of the user’s failures.');
 }else{
  assert.equal(result.failed,0);assert.equal(result.saved,1);assert.equal(usage.count,1);assert.ok(cached?.startsWith('data:image/jpeg;base64,'));
  assert.ok(color.every((value,i)=>Math.abs(value-savedPixels[i])<8),JSON.stringify(savedPixels));
  assert.ok(elapsedMs<15_000,'Rendered content must be saved before the old load deadline');
  console.log('PASS: the production on-demand probe reports readiness and the batch saves correct pixels while a subresource remains pending.');
 }
}finally{
 try{if(context)await context.close();}finally{
  for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});
 }
}
