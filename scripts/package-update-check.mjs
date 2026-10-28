// Test only in a disposable profile. No personal browser data is read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'..');
const executable=process.env.CHROMIUM_EXECUTABLE;
assert.ok(executable,'Set CHROMIUM_EXECUTABLE');
const version=JSON.parse(fs.readFileSync(root+'/extension/manifest.json')).version;
const archive=root+`/dist/Pickmark-${version}.zip`;
const baselineArchive=process.env.UPDATE_BASELINE_ARCHIVE||root+'/dist/Pickmark-0.1.8.zip';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pickmark-package-update-'));
const folder=temp+'/extension';fs.mkdirSync(folder);
execFileSync('unzip',['-q',baselineArchive,'-d',folder]);
const manifest=JSON.parse(fs.readFileSync(folder+'/manifest.json'));
const fromVersion=manifest.version;
assert.notEqual(fromVersion,version);assert.ok(!manifest.permissions.includes('bookmarks'));
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Synthetic manual page</title>Package update fixture');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const fixtureURL=`http://127.0.0.1:${server.address().port}/manual`;
const browser=spawn(executable,[`--user-data-dir=${temp}/profile`,'--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--load-extension=${folder}`,`--disable-extensions-except=${folder}`,'about:blank'],{stdio:'ignore',detached:true});
let ws,serial=0;const pending=new Map();
async function until(fn){const end=Date.now()+20000;while(Date.now()<end){const result=await fn();if(result)return result;await delay(100);}throw Error('Package update condition timed out');}
const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const identity=createHash('sha256').update(fs.realpathSync(folder)).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const origin='chrome-extension://'+identity;
async function panel(){
 const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
 await cdp('Network.enable',{},sessionId);
 await cdp('Network.setBlockedURLs',{urls:[origin+'/dashboard.js*']},sessionId);
 await cdp('Page.navigate',{url:origin+'/dashboard.html'},sessionId);
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
 await until(()=>evaluate('!!chrome.storage'));
 await evaluate(`window.send=async m=>{const r=await chrome.runtime.sendMessage({...m,locale:'zh'});if(r.error)throw Error(r.error);return r.value;};`);
 return evaluate;
}
try{
 await until(()=>fs.existsSync(temp+'/profile/DevToolsActivePort'));
 const [port,socket]=fs.readFileSync(temp+'/profile/DevToolsActivePort','utf8').trim().split('\n');
 ws=new WebSocket('ws://127.0.0.1:'+port+socket);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(!message.id)return;const task=pending.get(message.id);if(!task)return;pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);});
 await cdp('Target.createTarget',{url:fixtureURL});
 let run=await panel();
 await until(()=>run(`chrome.tabs.query({}).then(t=>t.some(x=>x.url===${JSON.stringify(fixtureURL)}&&x.status==='complete'))`));
 await run(`(async()=>{
  const {dayKey,settingsSignature}=await import('./core.js');const now=Date.now();
  // Drain startup work and pause through the production serialized settings
  // path before seeding. Direct config writes can race an initial collector.
  const initial=await send({type:'getHistory'});
  const config={...initial.config,recording:false,workspaces:['Human'],workspaceOrder:['Human'],workspaceIcons:{Human:'code'},rules:[{keyword:'history',group:'History'}]};
  await send({type:'settings',value:config,expectedSettings:settingsSignature(initial.config)});
  const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);
  await chrome.storage.local.set({lastCleanupAt:now,'pickmark-auto-preview-v1':true,'pickmark-thumbnails-v1':{[${JSON.stringify(fixtureURL)}]:{at:now,image:canvas.toDataURL('image/jpeg')}},records:[
   {id:'manual',day:dayKey(),url:${JSON.stringify(fixtureURL)},domain:'127.0.0.1',title:'Human',group:'Human',snapshotGroup:'Human',manualGroup:true},
   {id:'history',day:dayKey(now-86400000),url:'https://history.test',domain:'history.test',title:'History',group:'Saved history',snapshotGroup:'Saved history'},
   {id:'pending',day:dayKey(now-86400000),url:'https://pending.test',domain:'pending.test',title:'Pending',group:'待整理',snapshotGroup:'待整理'}
  ],visits:[{visit:'synthetic',day:dayKey(),url:${JSON.stringify(fixtureURL)},domain:'127.0.0.1',start:now-1000,end:now}],
  apiKeys:{deepseek:'synthetic-persistent',openai:''},'pickmark-bookmarks-v1':{metadata:{synthetic:{url:'https://bookmark.test',group:'Human bookmark',manualGroup:true}},groups:['Human bookmark'],rules:[{keyword:'book',group:'Human bookmark'}],revision:2}});
  await chrome.storage.session.set({apiKeys:{openai:'synthetic-stale-session'}});
  localStorage.setItem('atlas-language-v1','zh');
  await send({type:'getHistory'});
 })()`);
 assert.equal(await run('chrome.runtime.getManifest().version'),fromVersion);
 const before=await run("chrome.storage.local.get(['config','records','visits','apiKeys','pickmark-bookmarks-v1','pickmark-auto-preview-v1','pickmark-thumbnails-v1'])");
 const beforePermissions=await run('chrome.permissions.getAll()');
 assert.equal(before.config.recording,false);assert.equal(before.records.find(r=>r.id==='manual')?.manualGroup,true);
 assert.equal(before.apiKeys.openai,'');
 execFileSync('unzip',['-oq',archive,'-d',folder]);
 assert.equal(JSON.parse(fs.readFileSync(folder+'/manifest.json')).version,version);
 // Use the extension manager's reload operation, as the installation guide
 // instructs.
 const manager=await cdp('Target.createTarget',{url:'chrome://extensions/'});
 const managerSession=(await cdp('Target.attachToTarget',{targetId:manager.targetId,flatten:true})).sessionId;
 await until(async()=>{const result=await cdp('Runtime.evaluate',{expression:'!!chrome.developerPrivate?.reload',returnByValue:true},managerSession);return result.result.value;});
 const developerMode=await cdp('Runtime.evaluate',{expression:'new Promise(resolve=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},resolve))',awaitPromise:true,returnByValue:true},managerSession);
 if(developerMode.exceptionDetails)throw Error(developerMode.exceptionDetails.exception?.description||developerMode.exceptionDetails.text);
 const reload=await cdp('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>chrome.developerPrivate.reload(${JSON.stringify(identity)},{},()=>chrome.runtime.lastError?reject(Error(chrome.runtime.lastError.message)):resolve(true)))`,awaitPromise:true,returnByValue:true},managerSession);
 if(reload.exceptionDetails)throw Error(reload.exceptionDetails.exception?.description||reload.exceptionDetails.text);
 // The manager callback returns while the extension is still "reloading".
 // Opening its page during that interval produces a persistent error page.
 try{await until(async()=>{
  const info=await cdp('Runtime.evaluate',{expression:`new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},items=>resolve(items.some(item=>item.id===${JSON.stringify(identity)}&&item.state==='ENABLED'&&item.version===${JSON.stringify(version)}))))`,awaitPromise:true,returnByValue:true},managerSession);
  return info.result.value;
 });}catch(error){
  const status=await cdp('Runtime.evaluate',{expression:'new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},items=>resolve(items.map(({id,state,version,manifestErrors,disableReasons})=>({id,state,version,manifestErrors,disableReasons})))))',awaitPromise:true,returnByValue:true},managerSession);
  console.log('Temporary reload status',status.result.value);throw error;
 }
 let lastProbeError;
 try{await until(async()=>{try{run=await panel();return await run(`chrome.runtime.getManifest().version===${JSON.stringify(version)}`);}catch(error){lastProbeError=error.message;return false;}});}
 catch(error){console.log('Update panel failure:',lastProbeError);throw error;}
 assert.equal(await run('chrome.runtime.id'),identity);
 await run("send({type:'getHistory'})");
 const after=await run("chrome.storage.local.get(['config','records','visits','apiKeys','pickmark-bookmarks-v1','pickmark-auto-preview-v1','pickmark-thumbnails-v1'])");
 assert.deepEqual(after,before);
 assert.deepEqual(await run('chrome.permissions.getAll()'),beforePermissions);
 const preview=await run(`send({type:'preview:status',url:${JSON.stringify(fixtureURL)}})`);
 assert.equal(preview.state,'saved');assert.equal(preview.requested,true);
 assert.equal(await run("localStorage.getItem('atlas-language-v1')"),'zh');
 const history=await run("send({type:'getHistory'})");
 assert.equal(history.records.find(r=>r.id==='pending').group,'待整理');
 assert.equal(history.records.find(r=>r.id==='manual').manualGroup,true);
 assert.equal(history.hasKey,true);
 console.log('PASS actual packaged extension reload '+fromVersion+' -> '+version+': ID unchanged, local data and permissions identical; manual groups, bookmark metadata, history/rules, supplier Keys, language, preview preference and cached image retained; existing preview shows Saved.');
 const repaired=await run(`(async()=>{
  const {dayKey,settingsSignature}=await import('./core.js');
  const {organizeHistory}=await import('./history-workflow.js');
  const state=await send({type:'getHistory'});
  await send({type:'settings',expectedSettings:settingsSignature(state.config),value:{...state.config,recording:true}});
  await send({type:'rule',value:{keyword:'pending.test',group:'Recovered'}});
  const result=await organizeHistory({send,day:dayKey(Date.now()-86400000),ids:['history','pending'],allowAI:false});
  const after=await send({type:'getHistory'});
  return {result,pending:after.records.find(r=>r.id==='pending'),saved:after.records.find(r=>r.id==='history'),manual:after.records.find(r=>r.id==='manual'),bookmarks:(await chrome.storage.local.get('pickmark-bookmarks-v1'))['pickmark-bookmarks-v1']};
 })()`);
 assert.equal(repaired.result.local,1);assert.equal(repaired.result.ai,0);
 assert.equal(repaired.pending.group,'Recovered');assert.equal(repaired.saved.group,'Saved history');
 assert.equal(repaired.manual.manualGroup,true);assert.equal(repaired.manual.group,'Human');
 for(const field of ['metadata','groups','rules'])assert.deepEqual(repaired.bookmarks[field],before['pickmark-bookmarks-v1'][field]);
 console.log('PASS historical local-rule classification after update; existing/manual categories and bookmark metadata protected.');
 console.log('PASS release keeps bookmark/screenshot access optional; no personal data included.');
}finally{
 await cdp('Browser.close').catch(()=>{});ws?.close();
 if(browser.exitCode===null&&browser.signalCode===null){await delay(500);if(browser.exitCode===null&&browser.signalCode===null)process.kill(-browser.pid,'SIGTERM');}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await delay(500);fs.rmSync(temp,{recursive:true,force:true});
}
