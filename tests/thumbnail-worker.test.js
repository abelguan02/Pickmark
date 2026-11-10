import test from 'node:test';
import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {installThumbnailCache} from './thumbnail-fixture.js';
import {thumbnailWorker} from '../extension/thumbnail-worker.js';
import {handleThumbnail,PREVIEW_AUTO_KEY,THUMBNAIL_KEY} from '../extension/thumbnails.js';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},fire(...args){this.listeners.forEach(fn=>fn(...args));}});
function fixture(options={}){
 const data={config:{recording:true,excluded:[]},[PREVIEW_AUTO_KEY]:false,records:[{id:'human',url:'https://visible.test/',day:'2026-10-14',group:'Human',manualGroup:true}],'pickmark-bookmarks-v1':{metadata:{human:{group:'Human bookmark',manualGroup:true}}}};
 const tab={id:1,windowId:1,active:true,status:'complete',url:'https://visible.test/',incognito:false};
 const state={allowed:false,focused:true,captures:0,fail:false,hold:null,notifications:[]};
  const api={storage:{onChanged:event(),local:{getBytesInUse:async keys=>storageBytes(data,keys),get:async()=>structuredClone(data),set:async value=>Object.assign(data,structuredClone(value)),remove:async keys=>{for(const key of keys)delete data[key];}}},
  permissions:{contains:async()=>state.allowed,onRemoved:event()},runtime:{onInstalled:event(),onStartup:event(),sendMessage:async message=>{state.notifications.push(message.url);}},
  windows:{getLastFocused:async()=>({id:1,focused:state.focused}),onFocusChanged:event()},
  tabs:{query:async()=>[structuredClone(tab)],get:async()=>structuredClone(tab),captureVisibleTab:async()=>{state.captures++;if(state.hold)await state.hold;return 'data:image/jpeg;base64,YQ==';},onCreated:event(),onRemoved:event(),onActivated:event(),onUpdated:event()}};
 state.alarms=new Map();api.alarms={onAlarm:event(),get:async name=>state.alarms.get(name),create:async(name,value)=>state.alarms.set(name,{name,...value}),clear:async name=>state.alarms.delete(name)};
 const {db,cache}=installThumbnailCache(api,{migrated:true});
 db.beforeWrite=async()=>{if(state.fail)throw new DOMException('QUOTA_BYTES quota exceeded','QuotaExceededError');};
 const worker=thumbnailWorker({api,serial:fn=>fn(),delayMs:100000,...options});worker.cancel();
 function redirect(source,final=tab.url){
  api.tabs.onCreated.fire({...tab,url:'',pendingUrl:source,status:'loading'});
  tab.url=final;tab.status='complete';
  api.tabs.onUpdated.fire(tab.id,{url:final,status:'complete'},structuredClone(tab));
  worker.cancel();
 }
 return {api,data,tab,state,worker,redirect,db,cache};
}
test('preview owns its minute alarm only with consent, permission and recording; activity alarms are ignored',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const f=fixture({delayMs:1}),settle=()=>new Promise(resolve=>setTimeout(resolve,8));await settle();
 assert.equal(f.state.alarms.size,0);
 f.data[PREVIEW_AUTO_KEY]=true;f.api.storage.onChanged.fire({[PREVIEW_AUTO_KEY]:{newValue:true}},'local');await settle();
 assert.equal(f.state.alarms.size,0);
 f.state.allowed=true;f.api.storage.onChanged.fire({[PREVIEW_AUTO_KEY]:{newValue:true}},'local');await settle();
 assert.deepEqual(f.state.alarms.get('preview-checkpoint'),{name:'preview-checkpoint',periodInMinutes:1});
 const captured=f.state.captures;f.api.alarms.onAlarm.fire({name:'activity-checkpoint'});await settle();assert.equal(f.state.captures,captured);
 now+=60000;await f.cache.clear();f.api.alarms.onAlarm.fire({name:'preview-checkpoint'});await settle();assert.ok(f.state.captures>captured);
 f.data.config.recording=false;f.api.storage.onChanged.fire({config:{oldValue:{recording:true},newValue:f.data.config}},'local');await settle();assert.equal(f.state.alarms.size,0);
 f.worker.cancel();
});
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
 assert.ok(await f.cache.get(f.tab.url));assert.equal(f.data[THUMBNAIL_KEY],undefined);await f.worker.capture();assert.equal(f.state.captures,1);
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
  release();await assert.rejects(task,/变化/);assert.equal(f.db.state.images.size,0);f.worker.cancel();
 }
});
for(const automatic of [true,false]){
 for(const otherWindow of [false,true]){
  for(const [change,info] of [['loading',{status:'loading'}],['navigation',{url:'https://background.test/next'}],['complete',{status:'complete'}]]){
   test(`${automatic?'automatic':'manual'} capture survives ${change} in ${otherWindow?'another window\'s active tab':'a background tab'}`,async()=>{
    const f=fixture();f.data[PREVIEW_AUTO_KEY]=automatic;f.state.allowed=true;
    let release;f.state.hold=new Promise(resolve=>release=resolve);
    const task=automatic?f.worker.capture():f.worker.captureFor({type:'thumbnail:capture',url:f.tab.url},f.data.config);
    try{
     while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
     const other={id:2,windowId:otherWindow?2:1,active:otherWindow,status:info.status||'complete',url:info.url||'https://background.test/',incognito:false};
     f.api.tabs.onUpdated.fire(other.id,info,other);
     await new Promise(resolve=>setImmediate(resolve));
     release();await assert.doesNotReject(task);
     assert.ok(await f.cache.get(f.tab.url));
     assert.equal((await f.worker.status(f.tab.url)).state,'saved');
    }finally{release();await task.catch(()=>{});f.worker.cancel();}
   });
  }
 }
 for(const [change,info] of [['loading',{status:'loading'}],['navigation',{url:'https://visible.test/next'}]]){
  test(`${automatic?'automatic':'manual'} capture discards its image when the target starts ${change}`,async()=>{
   const f=fixture();f.data[PREVIEW_AUTO_KEY]=automatic;f.state.allowed=true;
   let release;f.state.hold=new Promise(resolve=>release=resolve);
   const task=automatic?f.worker.capture():f.worker.captureFor({type:'thumbnail:capture',url:f.tab.url},f.data.config);
   try{
    while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
    f.api.tabs.onUpdated.fire(f.tab.id,info,{...f.tab,...info});
    await new Promise(resolve=>setImmediate(resolve));
    // A page that returned to the same URL still cannot validate the old image.
    release();await assert.rejects(task,error=>error.code==='PAGE_CHANGED');
    assert.equal(f.db.state.images.size,0);
   }finally{release();await task.catch(()=>{});f.worker.cancel();}
  });
 }
}
test('automatic preview capacity rejection preserves manual state and bookmark classifications',async()=>{
 const f=fixture();f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;f.state.fail=true;
 const before=structuredClone(f.data);await assert.rejects(f.worker.capture(),error=>error.code==='STORAGE_CAPACITY');assert.deepEqual(f.data,before);assert.equal(f.db.state.images.size,0);f.worker.cancel();
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
 await f.cache.clear();assert.equal((await f.worker.status(f.tab.url)).state,'pending');
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
 assert.equal(f.db.state.images.size,0);f.worker.cancel();
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
 let release,writing=false,settled=false;const held=new Promise(resolve=>release=resolve),beforeWrite=f.db.beforeWrite;
 f.db.beforeWrite=async patch=>{writing=true;await held;return beforeWrite(patch);};
 const task=f.worker.capture().finally(()=>{settled=true;});while(!writing)await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setTimeout(resolve,35));assert.equal(settled,false,'The serialized operation still owns its storage write');
 release();await task;assert.equal((await f.worker.status(f.tab.url)).state,'saved');f.worker.cancel();
});
for(const {name,recording,authorized} of [{name:'recording is paused',recording:false,authorized:true},{name:'only the manual activeTab grant is available',recording:true,authorized:false}]){
 test(`manual capture progress and storage failure remain visible when ${name}`,async()=>{
  const f=fixture();f.data[PREVIEW_AUTO_KEY]=true;f.data.config.recording=recording;f.state.allowed=authorized;f.state.fail=true;
  const before=structuredClone(f.data);let release;f.state.hold=new Promise(resolve=>release=resolve);
  const task=f.worker.captureFor({type:'thumbnail:capture',url:f.tab.url},f.data.config);
  while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
  try{assert.equal((await f.worker.status(f.tab.url)).state,'generating');}
  finally{release();await assert.rejects(task,error=>error.code==='STORAGE_CAPACITY');f.worker.cancel();}
  const failed=await f.worker.status(f.tab.url);assert.equal(failed.state,'error');assert.equal(failed.reason,'storage');
  assert.deepEqual(f.data,before);
 });
}
test('automatic progress still stops when recording is paused',async()=>{
 const f=fixture();f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
 let release;f.state.hold=new Promise(resolve=>release=resolve);
 const task=f.worker.capture();while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
 f.data.config.recording=false;
 f.api.storage.onChanged.fire({config:{oldValue:{recording:true,excluded:[]},newValue:{recording:false,excluded:[]}}},'local');
 assert.equal((await f.worker.status(f.tab.url)).reason,'paused');
 release();await assert.rejects(task,/变化/);assert.equal(f.db.state.images.size,0);f.worker.cancel();
});
test('an observed initial redirect shares the image and live status with the original bookmark, without domain guessing',async()=>{
 const f=fixture(),source='http://www.visible.test/start?entry=bookmark',final=f.tab.url;
 f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;f.redirect(source);
 let release;f.state.hold=new Promise(resolve=>release=resolve);
 const task=f.worker.capture();while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.worker.status(source)).state,'generating');
 assert.ok(f.state.notifications.includes(source));release();await task;
 assert.equal((await f.worker.status(source)).state,'saved');
 const image=await f.cache.get(final);
 assert.equal(await handleThumbnail({type:'thumbnail:get',url:source},f.api,f.data.config),image);
 assert.deepEqual(await handleThumbnail({type:'thumbnail:lookup',urls:[source,final,'https://visible.test/other','https://visible.test/?different=1']},f.api,f.data.config),{[source]:image,[final]:image});
 // A fresh worker must resolve the persisted association too.
 const restarted=thumbnailWorker({api:f.api,serial:fn=>fn(),delayMs:100000});restarted.cancel();
 assert.equal((await restarted.status(source)).state,'saved');
 assert.equal((await restarted.status('https://visible.test/other')).reason,'visit');
 await f.cache.clear();assert.equal((await restarted.status(source)).state,'pending');
 f.worker.cancel();
});
test('opening a redirect to a recently cached page links it without waiting for the refresh cooldown or duplicating its image',async()=>{
 const f=fixture(),source='https://link.test/bookmark';f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
 await f.worker.capture();assert.equal(f.state.captures,1);
 f.redirect(source);assert.equal((await f.worker.status(source)).state,'pending','Do not report Saved until original-URL image lookup can succeed');
 await f.worker.capture();assert.equal(f.state.captures,1);
 assert.deepEqual(f.db.state.entries.get(f.tab.url).sources,[source]);
 assert.equal(f.db.state.images.size,1);
 assert.equal((await f.worker.status(source)).state,'saved');f.worker.cancel();
});
test('later page navigation and private tabs cannot become bookmark redirect associations',async()=>{
 const f=fixture(),source='https://link.test/original';f.state.allowed=true;f.data[PREVIEW_AUTO_KEY]=true;
 f.redirect(source);f.tab.url='https://visible.test/unrelated';
 f.api.tabs.onUpdated.fire(f.tab.id,{url:f.tab.url,status:'loading'},structuredClone(f.tab));
 f.api.tabs.onUpdated.fire(f.tab.id,{status:'complete'},structuredClone(f.tab));f.worker.cancel();
 await f.worker.capture();assert.equal((await f.worker.status(source)).state,'pending');
 assert.deepEqual(f.db.state.entries.get(f.tab.url).sources,[]);
 f.tab.id=2;f.tab.incognito=true;f.redirect('https://private-link.test/');
 await f.worker.capture();assert.equal(f.state.captures,1);
 f.tab.incognito=false;await f.worker.captureFor({type:'thumbnail:capture',url:f.tab.url},f.data.config);
 assert.deepEqual(f.db.state.entries.get(f.tab.url).sources,[]);f.worker.cancel();
});
test('failure to save a new redirect association reports the storage error without losing the cached image',async()=>{
 const f=fixture(),source='https://link.test/new';f.data[PREVIEW_AUTO_KEY]=true;f.state.allowed=true;
 await f.worker.capture();const before=structuredClone(f.db.state);
 f.redirect(source);f.state.fail=true;await assert.rejects(f.worker.capture(),error=>error.code==='STORAGE_CAPACITY');
 assert.equal((await f.worker.status(source)).reason,'storage');assert.deepEqual(f.db.state,before);
 f.state.fail=false;await f.worker.capture();assert.equal((await f.worker.status(source)).state,'saved');
 assert.equal(f.state.captures,1);f.worker.cancel();
});
test('a currently visible original URL is captured directly even when a different tab previously redirected from it',async()=>{
 const f=fixture(),source='https://link.test/bookmark';f.redirect(source);
 // A second existing tab now displays the original URL without redirecting.
 f.tab.id=2;f.tab.url=source;
 await f.worker.captureFor({type:'thumbnail:capture',url:source},f.data.config);
 assert.ok(await f.cache.get(source));assert.equal(f.state.captures,1);
 assert.equal((await f.worker.status(source)).visible,true);f.worker.cancel();
});
test('redirect sources respect excluded domains and do not bypass screenshot consent',async()=>{
 const f=fixture(),source='https://excluded.test/bookmark';f.redirect(source);
 await f.worker.capture();assert.equal(f.db.state.images.size,0);
 f.state.allowed=true;f.data[PREVIEW_AUTO_KEY]=true;f.data.config.excluded=['excluded.test'];
 await f.worker.capture();assert.deepEqual(f.db.state.entries.get(f.tab.url).sources,[]);
 assert.equal((await f.worker.status(source)).reason,'excluded');
 assert.equal(await handleThumbnail({type:'thumbnail:lookup',urls:[source]},f.api,f.data.config).then(result=>Object.keys(result).length),0);
 await assert.rejects(f.worker.captureFor({type:'thumbnail:capture',url:source},f.data.config),/excluded/i);f.worker.cancel();
});
test('manual capture through a known redirect preserves progress and failure reasons when automatic capture is off',async()=>{
 const f=fixture(),source='https://link.test/bookmark';f.redirect(source);f.data.config.recording=false;
 f.state.fail=true;let release;f.state.hold=new Promise(resolve=>release=resolve);
 const task=f.worker.captureFor({type:'thumbnail:capture',url:source},f.data.config);
 while(!f.state.captures)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.worker.status(source)).state,'generating');release();await assert.rejects(task,error=>error.code==='STORAGE_CAPACITY');
 assert.equal((await f.worker.status(source)).reason,'storage');
 f.state.fail=false;f.state.hold=null;
 await f.worker.captureFor({type:'thumbnail:capture',url:source},f.data.config);
 assert.equal((await f.worker.status(source)).state,'saved');f.worker.cancel();
});
