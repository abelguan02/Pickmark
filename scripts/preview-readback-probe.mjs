// Localhost-only capture diagnosis in a disposable Chrome profile.
// Headed mode is deliberately opt-in and requires fresh user idle consent.
// No Playwright launch defaults, rendering switches, or personal-profile access.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const headed=process.argv.includes('--headed');
if(headed&&process.env.PICKMARK_FOREGROUND_AUTHORIZED!=='1')throw Error('Headed mode requires fresh user idle consent and PICKMARK_FOREGROUND_AUTHORIZED=1.');
const executable=process.env.CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pickmark-readback-probe-'));
const extension=path.join(temp,'extension');await fs.mkdir(extension);
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Pickmark local readback probe',version:'1.0',permissions:['tabs'],host_permissions:['<all_urls>'],background:{service_worker:'worker.js'},content_scripts:[{matches:['http://127.0.0.1/*'],js:['observe.js'],run_at:'document_idle'}]}));
await fs.writeFile(path.join(extension,'worker.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
await fs.writeFile(path.join(extension,'bridge.html'),'<!doctype html><title>Local capture probe</title>');
await fs.writeFile(path.join(extension,'observe.js'),`chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==='probe:observe'&&sender.id===chrome.runtime.id)reply({url:location.href,readyState:document.readyState,visibilityState:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus(),viewport:{width:innerWidth,height:innerHeight},screenPosition:{x:screenX,y:screenY}});
});`);
const colors=[[184,35,61],[31,91,178],[154,73,179]];
const server=http.createServer((req,res)=>{
 const color=Number(new URL(req.url,'http://localhost').searchParams.get('color')||0)%colors.length;
 res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
 res.end(`<!doctype html><html style="height:100%;background:rgb(${colors[color]})"><head><title>Local capture fixture ${color}</title></head><body><h1>Local readback probe</h1></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
// Extensions.loadUnpacked requires this explicit switch and the official CDP
// pipe transport. Only the new temporary profile has this capability enabled.
const args=[`--user-data-dir=${path.join(temp,'profile')}`,'--remote-debugging-pipe','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check',...(!headed?['--headless=new']:[]),'about:blank'];
const browser=spawn(executable,args,{stdio:['ignore','ignore','pipe','pipe','pipe']});
const budgetTimer=setTimeout(()=>{console.log(JSON.stringify({kind:'time-limit',headed,message:'Probe time budget reached; closing only its disposable Chrome process.'}));browser.kill('SIGTERM');},headed?170_000:540_000);
let serial=0,buffer=Buffer.alloc(0),stderr='',exitInfo;
const pending=new Map();
browser.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-6000);});
browser.on('exit',(code,signal)=>{exitInfo={code,signal};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Test Chrome exited: '+JSON.stringify(exitInfo)));}pending.clear();});
browser.stdio[4].on('data',chunk=>{
 buffer=Buffer.concat([buffer,chunk]);let end;
 while((end=buffer.indexOf(0))>=0){
  const text=buffer.subarray(0,end).toString();buffer=buffer.subarray(end+1);if(!text)continue;
  const message=JSON.parse(text),task=pending.get(message.id);if(!task)continue;
  pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);
 }
});
function cdp(method,params={},sessionId,timeout=25_000){
 return new Promise((resolve,reject)=>{
  if(exitInfo){reject(Error('Test Chrome already exited'));return;}
  const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP deadline: '+method));},timeout);
  pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
 });
}
async function until(fn,timeout=10_000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await delay(100);}throw Error('Local probe condition timed out');}
let sessionId;
async function evaluate(fn,arg){
 const response=await cdp('Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(arg)})`,awaitPromise:true,returnByValue:true},sessionId);
 if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
 return response.result.value;
}
try{
 const version=await cdp('Browser.getVersion');
 console.log(JSON.stringify({kind:'environment',headed,executable,version,flags:args}));
 let installed;
 try{installed=await cdp('Extensions.loadUnpacked',{path:extension});}
 catch(error){console.log(JSON.stringify({kind:'capability-limit',operation:'Extensions.loadUnpacked',error:error.message}));throw error;}
 const {targetId}=await cdp('Target.createTarget',{url:`chrome-extension://${installed.id}/bridge.html`});
 sessionId=(await cdp('Target.attachToTarget',{targetId,flatten:true})).sessionId;
 await until(()=>evaluate(()=>!!chrome.tabs));
 const screen=await evaluate(()=>({left:screen.availLeft||0,top:screen.availTop||0,width:screen.availWidth,height:screen.availHeight}));
 const ownerBounds={left:screen.left+10,top:screen.top+10,width:Math.min(1100,Math.floor(screen.width*.85)),height:Math.min(850,Math.floor(screen.height*.85))};
 const helperBounds={left:ownerBounds.left+30,top:ownerBounds.top+30,width:ownerBounds.width-60,height:ownerBounds.height-60};
 const partialLeft=Math.min(ownerBounds.left+Math.floor(ownerBounds.width*.6),screen.left+screen.width-helperBounds.width-10);
 const exposedWidth=partialLeft+helperBounds.width-ownerBounds.left-ownerBounds.width;
 if(exposedWidth<64)throw Error('Test screen is too small for a clearly exposed strip of page content');
 console.log(JSON.stringify({kind:'layout',screen,ownerBounds,helperBounds,partialLeft,exposedWidth}));
 const owner=await evaluate(({url,bounds})=>chrome.windows.create({url,focused:true,...bounds}),{url:`${base}/owner?color=0`,bounds:ownerBounds});
 let helper;const results=[];
 for(const mode of ['normal-focused','normal-unfocused-covered','normal-unfocused-partial',...(!headed?['minimized']:[])]){
  if(mode==='normal-unfocused-covered'){
   helper=await evaluate(({url,bounds})=>chrome.windows.create({url,focused:false,...bounds}),{url:`${base}/helper?color=1`,bounds:helperBounds});
   await evaluate(id=>chrome.windows.update(id,{focused:true}),owner.id);
  }
  if(mode==='normal-unfocused-partial')await evaluate(({id,left})=>chrome.windows.update(id,{left}),{id:helper.id,left:partialLeft});
  if(mode==='minimized')await evaluate(id=>chrome.windows.update(id,{state:'minimized'}),helper.id);
  const target=mode==='normal-focused'?owner:helper;
  for(let run=0;run<3;run++){
   const format=run===1?'png':'jpeg',url=`${base}/${mode}?color=${run}&run=${run}`;
   await evaluate(async({tabId,url})=>{await chrome.tabs.update(tabId,{muted:true});await chrome.tabs.update(tabId,{url});},{tabId:target.tabs[0].id,url});
   await until(()=>evaluate(async id=>(await chrome.tabs.get(id)).status==='complete',target.tabs[0].id));
   await delay(900);
   const observed=await evaluate(async({windowId,tabId})=>{
    const window=await chrome.windows.get(windowId),tab=await chrome.tabs.get(tabId);
    let document,documentError;try{document=await chrome.tabs.sendMessage(tabId,{type:'probe:observe'},{frameId:0});}catch(error){documentError=error.message;}
    return {window:{id:window.id,focused:window.focused,state:window.state,left:window.left,top:window.top,width:window.width,height:window.height},tab:{id:tab.id,status:tab.status,active:tab.active,url:tab.url},document,documentError};
   },{windowId:target.id,tabId:target.tabs[0].id});
   const capture=await evaluate(async({windowId,format})=>{
    const started=Date.now();let timer;
    try{
     const image=await Promise.race([chrome.tabs.captureVisibleTab(windowId,{format,...(format==='jpeg'?{quality:85}:{})}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Probe capture deadline after 20 seconds')),20_000);})]);
     const captureMs=Date.now()-started,bytes=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));
     const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/'+format})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
     const pixels=Array.from(ctx.getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height/2),1,1).data),size={width:bitmap.width,height:bitmap.height};bitmap.close();
     return {captureMs,totalMs:Date.now()-started,pixels,size,bytes:bytes.length};
    }catch(error){return {elapsedMs:Date.now()-started,error:{name:error.name,message:error.message}};}finally{clearTimeout(timer);}
   },{windowId:target.id,format});
   const after=await evaluate(async id=>{const w=await chrome.windows.get(id),windows=await chrome.windows.getAll();return {focused:w.focused,state:w.state,focusedWindowIds:windows.filter(item=>item.focused).map(item=>item.id)};},target.id);
   const result={mode,run:run+1,format,...observed,after,capture,correct:!!capture.pixels&&colors[run].every((value,index)=>Math.abs(value-capture.pixels[index])<8)};
   results.push(result);console.log(JSON.stringify(result));
  }
 }
 console.log(JSON.stringify({kind:'summary',browser:version.product,headed,total:results.length,correct:results.filter(result=>result.correct).length,readbackFailures:results.filter(result=>/image readback failed/i.test(result.capture.error?.message||'')).length,errors:results.filter(result=>result.capture.error).map(({mode,run,capture})=>({mode,run,...capture}))}));
}catch(error){
 console.log(JSON.stringify({kind:'probe-error',message:error.message,stderr}));process.exitCode=1;
}finally{
 clearTimeout(budgetTimer);
 try{if(!exitInfo)await cdp('Browser.close',{},undefined,3000).catch(()=>{});}finally{
  if(!exitInfo){browser.kill('SIGTERM');await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),delay(3000)]);}
  for(const task of pending.values())clearTimeout(task.timer);pending.clear();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});
 }
}
