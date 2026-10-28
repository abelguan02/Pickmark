import test from 'node:test';
import assert from 'node:assert/strict';
import {thumbnailWorker} from '../extension/thumbnail-worker.js';
import {PREVIEW_AUTO_KEY,THUMBNAIL_KEY} from '../extension/thumbnails.js';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},fire(...args){this.listeners.forEach(fn=>fn(...args));}});
function fixture(options={}){
 const data={config:{recording:true,excluded:[]},[PREVIEW_AUTO_KEY]:false,records:[{id:'human',url:'https://visible.test/',day:'2026-10-14',group:'Human',manualGroup:true}],'pickmark-bookmarks-v1':{metadata:{human:{group:'Human bookmark',manualGroup:true}}}};
 const tab={id:1,windowId:1,active:true,status:'complete',url:'https://visible.test/',incognito:false};
 const state={allowed:false,focused:true,captures:0,fail:false,hold:null};
 const api={storage:{onChanged:event(),local:{get:async()=>structuredClone(data),set:async value=>{if(state.fail)throw Error('QUOTA_BYTES quota exceeded');Object.assign(data,structuredClone(value));}}},
  permissions:{contains:async()=>state.allowed,onRemoved:event()},runtime:{onInstalled:event(),onStartup:event()},
  windows:{getLastFocused:async()=>({id:1,focused:state.focused}),onFocusChanged:event()},
  tabs:{query:async()=>[structuredClone(tab)],get:async()=>structuredClone(tab),captureVisibleTab:async()=>{state.captures++;if(state.hold)await state.hold;return 'data:image/jpeg;base64,YQ==';},onActivated:event(),onUpdated:event()}};
 const worker=thumbnailWorker({api,serial:fn=>fn(),delayMs:100000,...options});worker.cancel();
 return {api,data,tab,state,worker};
}
test('automatic previews require consent, permission, focus and an eligible loaded visible page',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 await f.worker.capture();assert.equal(f.state.captures,0);
 f.data[PREVIEW_AUTO_KEY]=true;await f.worker.capture();assert.equal(f.state.captures,0);
 f.state.allowed=true;
 for(const [field,value] of [['focused',false]]){f.state[field]=value;await f.worker.capture();assert.equal(f.state.captures,0);f.state[field]=true;}
 f.tab.incognito=true;await f.worker.capture();f.tab.incognito=false;
 f.tab.status='loading';await f.worker.capture();f.tab.status='complete';
 f.data.config.recording=false;await f.worker.capture();f.data.config.recording=true;
 f.tab.url='https://mail.google.com/mail/';await f.worker.capture();
 f.tab.url='chrome://settings';await f.worker.capture();
 f.tab.url='https://visible.test/';f.data.config.excluded=['visible.test'];await f.worker.capture();f.data.config.excluded=[];
 assert.equal(f.state.captures,0);
 await f.worker.capture();assert.equal(f.state.captures,1);
 assert.ok(f.data[THUMBNAIL_KEY][f.tab.url]);await f.worker.capture();assert.equal(f.state.captures,1);
 assert.deepEqual(f.data.records,before.records);assert.deepEqual(f.data['pickmark-bookmarks-v1'],before['pickmark-bookmarks-v1']);
 f.worker.cancel();
});
test('tab switch or permission revocation during capture prevents an old image from being stored',async()=>{
 for(const revoke of [false,true]){
  const f=fixture();f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
  let release;f.state.hold=new Promise(resolve=>release=resolve);
  const task=f.worker.capture();while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
  if(revoke){f.state.allowed=false;f.api.permissions.onRemoved.fire({origins:['<all_urls>']});}
  else f.api.tabs.onActivated.fire({tabId:2,windowId:1});
  // Even switching away and back to the same URL cannot validate the old image.
  release();await assert.rejects(task,/变化/);assert.equal(f.data[THUMBNAIL_KEY],undefined);f.worker.cancel();
 }
});
test('automatic preview capacity rejection preserves manual state and bookmark classifications',async()=>{
 const f=fixture();f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;f.state.fail=true;
 const before=structuredClone(f.data);await assert.rejects(f.worker.capture(),/QUOTA/);assert.deepEqual(f.data,before);f.worker.cancel();
});
test('preview states explain consent, authorization, pause, exclusions, loading and focus without capturing',async()=>{
 const f=fixture(),url=f.tab.url;
 assert.equal((await f.worker.status(url)).reason,'disabled');
 f.data[PREVIEW_AUTO_KEY]=true;assert.equal((await f.worker.status(url)).reason,'permission');
 f.state.allowed=true;f.data.config.recording=false;assert.equal((await f.worker.status(url)).reason,'paused');
 f.data.config.recording=true;f.tab.status='loading';const loading=await f.worker.status(url);assert.deepEqual([loading.state,loading.reason],['pending','loading']);
 f.tab.status='complete';f.state.focused=false;assert.equal((await f.worker.status(url)).reason,'foreground');
 f.state.focused=true;assert.equal((await f.worker.status('https://unvisited.test/')).reason,'visit');
 f.data.config.excluded=['visible.test'];assert.equal((await f.worker.status(url)).reason,'excluded');
 assert.equal((await f.worker.status('chrome://settings/')).reason,'unsupported');
 assert.equal(f.state.captures,0);f.worker.cancel();
});
test('real capture progress becomes saved only after storage succeeds, and clearing the cache removes saved status',async()=>{
 const f=fixture();f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
 let release;f.state.hold=new Promise(resolve=>release=resolve);
 const task=f.worker.capture();while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.worker.status(f.tab.url)).state,'generating');
 release();await task;
 const saved=await f.worker.status(f.tab.url);assert.equal(saved.state,'saved');assert.ok(saved.savedAt>0);
 f.data[THUMBNAIL_KEY]={};assert.equal((await f.worker.status(f.tab.url)).state,'pending');
 f.worker.cancel();
});
test('capture failure and quota failure are actionable; a successful manual retry clears the failure',async()=>{
 for(const quota of [false,true]){
  const f=fixture();f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
  const before=structuredClone(f.data),original=f.api.tabs.captureVisibleTab;
  if(quota)f.state.fail=true;else f.api.tabs.captureVisibleTab=async()=>{throw Error('synthetic capture failure');};
  await assert.rejects(f.worker.capture());
  const failed=await f.worker.status(f.tab.url);assert.equal(failed.state,'error');assert.equal(failed.reason,quota?'storage':'capture');
  assert.deepEqual(f.data,before);
  f.state.fail=false;f.api.tabs.captureVisibleTab=original;
  await f.worker.captureFor({type:'thumbnail:capture',url:f.tab.url},f.data.config);
  assert.equal((await f.worker.status(f.tab.url)).state,'saved');f.worker.cancel();
 }
});
test('a timed out capture stops displaying progress and cannot write a late screenshot',async()=>{
 const f=fixture({captureTimeoutMs:20});f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
 let release;f.state.hold=new Promise(resolve=>release=resolve);
 const task=f.worker.capture();
 await assert.rejects(task,error=>error.code==='CAPTURE_TIMEOUT');
 const status=await f.worker.status(f.tab.url);assert.equal(status.state,'error');assert.equal(status.reason,'timeout');
 release();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.data[THUMBNAIL_KEY],undefined);f.worker.cancel();
});
test('cancellation clears progress without converting a switch into a permanent failure',async()=>{
 const f=fixture();f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
 let release;f.state.hold=new Promise(resolve=>release=resolve);
 const task=f.worker.capture();while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
 f.worker.cancel();assert.equal((await f.worker.status(f.tab.url)).state,'pending');
 release();await assert.rejects(task,/变化/);
 assert.equal((await f.worker.status(f.tab.url)).state,'pending');f.worker.cancel();
});
test('the image deadline never releases a pending storage write into a later cleanup',async()=>{
 const f=fixture({captureTimeoutMs:20});f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
 let release,writing=false,settled=false;const held=new Promise(resolve=>release=resolve),save=f.api.storage.local.set;
 f.api.storage.local.set=async patch=>{writing=true;await held;return save(patch);};
 const task=f.worker.capture().finally(()=>{settled=true;});while(!writing)await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setTimeout(resolve,35));assert.equal(settled,false,'The serialized operation still owns its storage write');
 release();await task;assert.equal((await f.worker.status(f.tab.url)).state,'saved');f.worker.cancel();
});
