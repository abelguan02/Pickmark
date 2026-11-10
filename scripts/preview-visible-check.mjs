// Production extension integration in the installed Chrome, headless by default.
// Uses a new profile and localhost fixtures; retains default occlusion/rendering.
// --headed requires fresh user idle consent and explicit environment opt-in.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const executable=process.env.CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const headed=process.argv.includes('--headed');
if(headed&&process.env.PICKMARK_FOREGROUND_AUTHORIZED!=='1')throw Error('Headed mode requires fresh user idle consent and PICKMARK_FOREGROUND_AUTHORIZED=1.');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pickmark-visible-check-')),extension=path.join(temp,'extension');
await fs.cp(path.resolve('extension'),extension,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json')));
const shippedManifest=structuredClone(manifest);
manifest.host_permissions.push('<all_urls>');
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
await fs.writeFile(path.join(extension,'visible-test-bridge.html'),'<!doctype html><title>Local visible preview regression</title>');
const colors=[[184,35,61],[31,91,178],[154,73,179]],requests=[],timers=new Set();
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
 const render=()=>{res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(`<!doctype html><html style="height:100%;background:rgb(${colors[Number(url.searchParams.get('color')||0)]})"><title>Local visible fixture</title><h1>Synthetic preview page</h1></html>`);};
 const waitMs=url.pathname==='/cover-second'?1500:url.pathname==='/cancel-slow'?30_000:0;
 if(waitMs){const timer=setTimeout(()=>{timers.delete(timer);render();},waitMs);timers.add(timer);res.on('close',()=>{clearTimeout(timer);timers.delete(timer);});}else render();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const args=[`--user-data-dir=${path.join(temp,'profile')}`,'--remote-debugging-pipe','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check',...(!headed?['--headless=new']:[]),'about:blank'];
const browser=spawn(executable,args,{stdio:['ignore','ignore','pipe','pipe','pipe']});
let serial=0,buffer=Buffer.alloc(0),stderr='',exited=false,sessionId;
const pending=new Map(),budget=setTimeout(()=>browser.kill('SIGTERM'),170_000);
browser.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
browser.on('exit',()=>{exited=true;for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Disposable Chrome exited'));}pending.clear();});
browser.stdio[4].on('data',chunk=>{
 buffer=Buffer.concat([buffer,chunk]);let end;
 while((end=buffer.indexOf(0))>=0){const text=buffer.subarray(0,end).toString();buffer=buffer.subarray(end+1);if(!text)continue;const message=JSON.parse(text),task=pending.get(message.id);if(!task)continue;pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}
});
function cdp(method,params={},targetSession,timeout=25_000){return new Promise((resolve,reject)=>{if(exited){reject(Error('Disposable Chrome is closed'));return;}const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP deadline: '+method));},timeout);pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...(targetSession?{sessionId:targetSession}:{})})+'\0');});}
async function evaluate(fn,arg){const response=await cdp('Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(arg)})`,awaitPromise:true,returnByValue:true},sessionId);if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result.value;}
async function until(fn,timeout=20_000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await delay(50);}throw Error('Visible preview condition timed out');}
const rectangle=window=>({left:window.left,top:window.top,width:window.width,height:window.height,state:window.state});
try{
 const version=await cdp('Browser.getVersion');console.log('Browser '+version.product+'; '+(headed?'headed':'headless')+' with default occlusion/rendering');
 const {id}=await cdp('Extensions.loadUnpacked',{path:extension});
 const {targetId}=await cdp('Target.createTarget',{url:`chrome-extension://${id}/visible-test-bridge.html`});
 sessionId=(await cdp('Target.attachToTarget',{targetId,flatten:true})).sessionId;
 await until(()=>evaluate(()=>!!chrome.tabs));
 assert.equal(shippedManifest.content_scripts,undefined);assert.ok(!shippedManifest.permissions.includes('idle'));assert.ok(shippedManifest.permissions.includes('scripting'));
 assert.ok(shippedManifest.permissions.includes('debugger'));
 await evaluate(()=>{globalThis.previewFocusEvents=[];globalThis.previewActiveEvents=[];chrome.windows.onFocusChanged.addListener(windowId=>previewFocusEvents.push(windowId));chrome.tabs.onActivated.addListener(event=>previewActiveEvents.push(event));});
 const message=input=>evaluate(async input=>{const reply=await chrome.runtime.sendMessage(input);if(reply.error)throw Error(reply.error);return reply.value;},input);
 const owner=await evaluate(()=>chrome.windows.getCurrent()),windowId=owner.id;
 const before=await message({type:'getHistory'}),ownerBefore=rectangle(owner);
 const activeBefore=await evaluate(async id=>(await chrome.tabs.query({windowId:id,active:true}))[0].id,windowId);
 const start=urls=>message({type:'preview:batchStart',urls,windowId});
 const done=()=>until(async()=>{const job=await message({type:'preview:batchStatus'});return job.state!=='running'?job:null;});
 const scope=()=>evaluate(async()=> (await chrome.storage.session.get('pickmark-preview-window-v1'))['pickmark-preview-window-v1']);
 const assertClean=async()=>{
  await until(async()=>!await scope(),3000);
  assert.deepEqual((await evaluate(()=>chrome.windows.getAll())).map(w=>w.id),[windowId]);
  assert.equal((await evaluate(()=>chrome.debugger.getTargets())).filter(t=>t.attached&&t.tabId!==undefined&&t.id!==targetId).length,0,'Only the test bridge may retain its CDP connection');
 };
 const pixels=url=>evaluate(async url=>{
  const {value:image,error}=await chrome.runtime.sendMessage({type:'thumbnail:get',url});if(error)throw Error(error);if(!image)return null;
  const bytes=Uint8Array.from(atob(image.split(',')[1]),value=>value.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const result=Array.from(ctx.getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height/2),1,1).data);bitmap.close();return result;
 },url);
 const urls=colors.map((_,i)=>base+'/background-'+i+'?color='+i);
 await evaluate(()=>{previewFocusEvents.length=0;previewActiveEvents.length=0;});
 await start(urls);const firstScope=await until(scope);
 assert.equal(firstScope.kind,'tab');assert.equal(firstScope.windowId,windowId);
 const hidden=await evaluate(id=>chrome.tabs.get(id),firstScope.tabId);assert.equal(hidden.active,false);
 const first=await done();assert.equal(first.saved,3);assert.equal(first.failed,0);await assertClean();
 for(let i=0;i<colors.length;i++){const pixel=await pixels(urls[i]);assert.ok(colors[i].every((v,j)=>Math.abs(v-pixel[j])<8),JSON.stringify(pixel));}
 assert.deepEqual(rectangle(await evaluate(id=>chrome.windows.get(id),windowId)),ownerBefore);
 assert.equal(await evaluate(async id=>(await chrome.tabs.query({windowId:id,active:true}))[0].id,windowId),activeBefore);
 assert.deepEqual(await evaluate(()=>previewFocusEvents),[]);assert.deepEqual(await evaluate(()=>previewActiveEvents),[]);
 console.log('PASS production background capture: correct changing pixels, no focus/activation, unchanged owner, no attached temporary targets');

 await start([urls[0],base+'/cancel-first?color=1',base+'/cancel-slow?color=2',base+'/cancel-never']);
 await until(()=>requests.includes('/cancel-slow'));const cancelAt=Date.now();await message({type:'preview:batchCancel'});await assertClean();
 const cancelled=await message({type:'preview:batchStatus'});assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.saved,1);assert.equal(cancelled.skipReasons.cached,1);
 assert.ok(Date.now()-cancelAt<3000);assert.ok(!requests.includes('/cancel-never'));assert.equal((await message({type:'thumbnail:usage'})).count,4);
 const after=await message({type:'getHistory'});assert.deepEqual(after.records,before.records);assert.deepEqual(after.visits,before.visits);
 assert.deepEqual(rectangle(await evaluate(id=>chrome.windows.get(id),windowId)),ownerBefore);
 console.log('PASS cancellation preserves completed images and user tabs; temporary pages never enter Pickmark history');

 await start([base+'/detach-first',base+'/detach-never']);
 const detachScope=await until(scope);
 await until(()=>evaluate(async id=>(await chrome.debugger.getTargets()).some(t=>t.tabId===id&&t.attached),detachScope.tabId));
 await evaluate(id=>chrome.debugger.detach({tabId:id}),detachScope.tabId);
 const detached=await done();assert.equal(detached.state,'stopped');assert.equal(detached.reason,'debugger');await assertClean();
 assert.ok(!requests.includes('/detach-never'));assert.equal((await message({type:'thumbnail:usage'})).count,4);
 console.log('PASS debugger detachment cancels the job without late writes or further navigation');
 await message({type:'preview:auto',enabled:true});
 await until(()=>evaluate(()=>chrome.alarms.get('preview-checkpoint')));
 const settings=await message({type:'getHistory'});
 const signature=await evaluate(async config=>(await import('./core.js')).settingsSignature(config),settings.config);
 await message({type:'settings',expectedSettings:signature,value:{...settings.config,recording:false}});
 await until(async()=>!await evaluate(()=>chrome.alarms.get('preview-checkpoint')));
 assert.equal(await evaluate(async()=>Object.keys(await chrome.storage.local.get(['visits','activityCursor','trackingSince'])).length),0);
 console.log('PASS automatic preview owns its checkpoint alarm, pause clears it, and no retired activity data is collected');
 console.log(JSON.stringify({browser:version.product,headed,owner:ownerBefore,first,cancelled,detached,cache:await message({type:'thumbnail:usage'})}));
 if(!headed)console.log('Headless API focus/visibility checks do not replace a separately authorized real-desktop focus check.');
}catch(error){console.log(JSON.stringify({error:error.message,stderr}));process.exitCode=1;}
finally{
 clearTimeout(budget);try{if(!exited)await cdp('Browser.close',{},undefined,3000).catch(()=>{});}finally{
  if(!exited){browser.kill('SIGTERM');await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),delay(3000)]);}
  for(const task of pending.values())clearTimeout(task.timer);pending.clear();for(const timer of timers)clearTimeout(timer);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});
 }
}
