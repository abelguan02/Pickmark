// Disposable localhost pages and Chrome profile only. Headed mode needs idle consent.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const headed=process.argv.includes('--headed');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'pickmark-preview-probe-'));
const extension=path.join(root,'extension');
await fs.mkdir(extension);
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Pickmark local screenshot probe',version:'1.0',permissions:['tabs'],host_permissions:['<all_urls>'],background:{service_worker:'worker.js'}}));
await fs.writeFile(path.join(extension,'worker.js'),'globalThis.focusEvents=[];chrome.windows.onFocusChanged.addListener(id=>focusEvents.push(id));');
const colors=[[184,35,61],[31,91,178],[154,73,179],[217,116,29]];
const server=http.createServer((req,res)=>{
 const index=Number(new URL(req.url,'http://localhost').searchParams.get('color')||0);
 res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
 res.end(`<!doctype html><html style="background:rgb(${colors[index%colors.length]});height:100%"><head><title>Local preview probe ${index}</title></head><body><h1>Pickmark screenshot test ${index}</h1><p>This is a synthetic local test page.</p></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let context;
try{
 context=await chromium.launchPersistentContext(path.join(root,'profile'),{
  ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),
  headless:!headed,
  ignoreDefaultArgs:['--disable-extensions','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],
  args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 const owner=await worker.evaluate(async url=>chrome.windows.create({url,focused:true,left:100,top:100,width:1100,height:850}),`${base}/owner?color=0`);
 await worker.evaluate(()=>{focusEvents.length=0;});
 const helper=await worker.evaluate(async url=>chrome.windows.create({url,focused:false,left:130,top:130,width:900,height:650}),`${base}/helper?color=1`);
 const tabId=helper.tabs[0].id;
 const results=[];
 for(const mode of ['covered','minimized']){
  if(mode==='minimized')await worker.evaluate(id=>chrome.windows.update(id,{state:'minimized'}),helper.id);
  for(let i=0;i<6;i++){
   const index=i%colors.length;
   await worker.evaluate(async ({id,url})=>{
    await chrome.tabs.update(id,{muted:true});
    await chrome.tabs.update(id,{url});
    const deadline=Date.now()+10000;
    while((await chrome.tabs.get(id)).status!=='complete'){
     if(Date.now()>deadline)throw Error('Local page timed out');
     await new Promise(resolve=>setTimeout(resolve,100));
    }
    await new Promise(resolve=>setTimeout(resolve,700));
   },{id:tabId,url:`${base}/page?color=${index}&run=${i}`});
   const result=await worker.evaluate(async ({windowId,ownerId})=>{
    const focused=(await chrome.windows.getAll()).filter(w=>w.focused).map(w=>w.id);
    let pixels,error;
    try{
     let timer;
     const data=await Promise.race([chrome.tabs.captureVisibleTab(windowId,{format:'png'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Capture timed out')),3000);})]).finally(()=>clearTimeout(timer));
     const bitmap=await createImageBitmap(await (await fetch(data)).blob());
     const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
     pixels=Array.from(ctx.getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height/2),1,1).data);
     bitmap.close();
    }catch(e){error=e.message;}
    return {pixels,error,focusKept:focused.length===1&&focused[0]===ownerId,focusEvents:[...focusEvents]};
   },{windowId:helper.id,ownerId:owner.id});
   const correct=!!result.pixels&&colors[index].every((v,j)=>Math.abs(v-result.pixels[j])<8);
   results.push({mode,run:i+1,correct,...result});
   console.log(JSON.stringify(results.at(-1)));
   if(mode==='minimized'&&!correct)break;
  }
 }
 const covered=results.filter(r=>r.mode==='covered');
 assert.ok(covered.every(r=>r.correct&&r.focusKept&&!r.focusEvents.includes(helper.id)),'Covered background window must capture current pixels and retain owner focus');
 console.log(`PASS ${headed?'headed':'headless'} covered window: ${covered.length}/${covered.length}; minimized: ${results.filter(r=>r.mode==='minimized'&&r.correct&&r.focusKept).length}/6`);
}finally{
 try{if(context)await context.close();}finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await fs.rm(root,{recursive:true,force:true});
 }
}
