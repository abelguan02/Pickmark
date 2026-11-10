// Installed Chrome, disposable profile, localhost icon fixture; no foreground.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pickmark-favicon-'));
const extension=path.join(temp,'extension');await fs.cp(path.resolve('extension'),extension,{recursive:true});
const requests=[];
const server=http.createServer((req,res)=>{
 requests.push(req.url);
 if(req.url==='/icon.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#ff0033"/><path d="M12 8L24 16L12 24Z" fill="white"/></svg>');}
 else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="icon" type="image/svg+xml" href="/icon.svg"><title>Local original icon</title>Local fixture');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const site=`http://127.0.0.1:${server.address().port}/site`;
const browser=spawn(process.env.CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
 `--user-data-dir=${temp}/profile`,'--headless=new','--remote-debugging-pipe','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'
],{stdio:['ignore','ignore','ignore','pipe','pipe']});
let next=0,buffer=Buffer.alloc(0),exited=false;const pending=new Map();
browser.on('exit',()=>{exited=true;for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Test Chrome exited'));}pending.clear();});
browser.stdio[4].on('data',chunk=>{
 buffer=Buffer.concat([buffer,chunk]);let end;
 while((end=buffer.indexOf(0))>=0){const raw=buffer.subarray(0,end).toString();buffer=buffer.subarray(end+1);if(!raw)continue;const message=JSON.parse(raw),task=pending.get(message.id);if(!task)continue;pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}
});
function cdp(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});}
async function evaluate(sessionId,fn,arg){const response=await cdp('Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(arg)})`,awaitPromise:true,returnByValue:true},sessionId);if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result.value;}
async function until(fn){const end=Date.now()+12000;while(Date.now()<end){const result=await fn();if(result)return result;await delay(100);}throw Error('Favicon condition timed out');}
async function page(url){const {targetId}=await cdp('Target.createTarget',{url});const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});return {targetId,sessionId};}
const budget=setTimeout(()=>browser.kill('SIGTERM'),60000);
try{
 const version=await cdp('Browser.getVersion');
 const {id}=await cdp('Extensions.loadUnpacked',{path:extension});
 const visited=await page(site);await until(()=>evaluate(visited.sessionId,()=>document.readyState==='complete'));
 await until(()=>requests.includes('/icon.svg'));await delay(600);
 const ui=await page(`chrome-extension://${id}/dashboard.html`);
 await until(()=>evaluate(ui.sessionId,()=>!!document.querySelector('#mono-list')));
 await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},ui.sessionId);
 await evaluate(ui.sessionId,()=>{document.querySelector('#pickmark-guide')?.close();});
 await evaluate(ui.sessionId,async site=>{
  const {FAV}=await import('./offset-icons.js');const scope=document.createElement('div');scope.id='favicon-fixture';
  scope.style.cssText='position:fixed;right:20px;top:90px;z-index:10000;padding:12px;background:var(--paper)';
  scope.innerHTML=FAV({url:site,domain:'www.youtube.com',title:'Local original icon'})+' <span>Original website icon</span>';document.body.append(scope);
 },site);
 await until(()=>evaluate(ui.sessionId,()=>{const img=document.querySelector('#favicon-fixture img');return img?.complete&&img.naturalWidth>0;}));
 const result=await evaluate(ui.sessionId,()=>{
  const img=document.querySelector('#favicon-fixture img'),canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,32,32);
  return {src:img.src,red:[...ctx.getImageData(5,16,1,1).data],white:[...ctx.getImageData(16,16,1,1).data],background:getComputedStyle(img.parentNode).backgroundColor};
 });
 assert.ok(result.src.startsWith(`chrome-extension://${id}/_favicon/`));
 assert.ok(result.red[0]>240&&result.red[1]<20&&result.red[2]<80,JSON.stringify(result));
 assert.ok(result.white.slice(0,3).every(value=>value>240),JSON.stringify(result));
 assert.equal(result.background,'rgba(0, 0, 0, 0)');
 // The row's text uses a difference blend effect. Original icon colors must
 // survive both resting and hovered rows instead of becoming complementary.
 await until(()=>evaluate(ui.sessionId,()=>{const img=document.querySelector('.item .site-favicon');return img?.complete&&img.naturalWidth>0;}));
 await delay(1000); // Let the initial serialized collector/UI refresh settle.
 for(const hovered of [false,true]){
  await evaluate(ui.sessionId,hovered=>document.querySelector('.item').classList.toggle('is-hovered',hovered),hovered);
  await delay(900);
  assert.equal(await evaluate(ui.sessionId,()=>document.querySelector('.item').classList.contains('is-hovered')),hovered,'The captured row must still be in the requested visual state');
  const rect=await evaluate(ui.sessionId,()=>{const r=document.querySelector('.item .site-favicon').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};});
  const screenshot=await cdp('Page.captureScreenshot',{format:'png',clip:rect},ui.sessionId);
  await fs.writeFile(`/tmp/pickmark-favicon-${hovered?'hover':'rest'}.png`,Buffer.from(screenshot.data,'base64'));
  const pixel=await evaluate(ui.sessionId,async data=>{
   const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
   const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const pixel=[...ctx.getImageData(3,9,1,1).data];bitmap.close();return pixel;
  },screenshot.data);
  assert.ok(pixel[0]>240&&pixel[1]<20&&pixel[2]<80,`Actual row icon changed color (hovered=${hovered}): ${pixel}`);
 }
 await cdp('Page.captureScreenshot',{format:'png'},ui.sessionId).then(result=>fs.writeFile('/tmp/pickmark-native-favicon.png',Buffer.from(result.data,'base64')));
 // The favicon remains available for a bookmark/history row after the tab closes.
 await cdp('Target.closeTarget',{targetId:visited.targetId});
 assert.equal(await evaluate(ui.sessionId,async site=>{const image=new Image();image.src=chrome.runtime.getURL('_favicon/')+'?pageUrl='+encodeURIComponent(site)+'&size=32';await image.decode();return image.naturalWidth;},site),32);
 const requestsBefore=requests.length;
 await evaluate(ui.sessionId,()=>{document.querySelector('#favicon-fixture img').src=chrome.runtime.getURL('missing-favicon-fixture.png');});
 await until(()=>evaluate(ui.sessionId,()=>!document.querySelector('#favicon-fixture img')));
 assert.equal(await evaluate(ui.sessionId,()=>getComputedStyle(document.querySelector('#favicon-fixture .fav')).color),'rgb(255, 255, 255)');
 assert.equal(requests.length,requestsBefore,'Showing cached icons or a letter fallback must not visit websites');
 await cdp('Page.captureScreenshot',{format:'png'},ui.sessionId).then(result=>fs.writeFile('/tmp/pickmark-favicon-check.png',Buffer.from(result.data,'base64')));
 console.log(`PASS ${version.product}: original red/play icon from Chrome cache, transparent badge background, cached icon after tab closes, production image-error letter fallback, no additional website visits.`);
}finally{
 clearTimeout(budget);if(!exited)await cdp('Browser.close').catch(()=>{});
 if(!exited){browser.kill('SIGTERM');await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),delay(2000)]);}
 for(const task of pending.values())clearTimeout(task.timer);pending.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});
}
