import test from 'node:test';
import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {installThumbnailCache} from './thumbnail-fixture.js';
import {previewBatchWorker} from '../extension/preview-batch.js';
import {PREVIEW_WINDOW_KEY,PREVIEW_JOB_KEY,userTabs} from '../extension/preview-session.js';
import {THUMBNAIL_KEY} from '../extension/thumbnails.js';

const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},fire(...args){for(const fn of this.listeners)fn(...args);}});
const owner={id:1,left:0,top:30,width:1100,height:850,state:'normal'};
const start=(f,request)=>f.worker.start({windowId:1,...request});
function fixture(options={}){
 const local={config:{excluded:[],recording:true},records:[],visits:[]},session={};
 const storage=data=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])])),set:async patch=>Object.assign(data,structuredClone(patch)),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete data[key];},getBytesInUse:async keys=>storageBytes(data,keys)});
 const state={allowed:true,created:[],removed:[],navigated:[],captures:0,focus:1,hold:null,owner:{...owner},windowUpdates:[],probes:[],queueErrors:[]};
 const tabs=[{id:1,windowId:1,url:'https://real.test/',active:true,status:'complete'}];
 const api={storage:{local:storage(local),session:storage(session)},runtime:{getURL:p=>'chrome-extension://test/'+p,sendMessage:async()=>{}},permissions:{contains:async()=>state.allowed,onRemoved:event()},
  tabs:{query:async query=>tabs.filter(t=>query.windowId===undefined||t.windowId===query.windowId).map(t=>({...t})),get:async id=>{const t=tabs.find(t=>t.id===id);if(!t)throw Error('No tab');return {...t};},update:async(id,patch)=>{const tab=tabs.find(t=>t.id===id);Object.assign(tab,patch);if(patch.url){assert.equal(session[PREVIEW_WINDOW_KEY]?.windowId,tab.windowId,'register before navigating');state.navigated.push(patch.url);}return {...tab};},captureVisibleTab:async id=>{assert.equal(id,2);assert.equal(state.focus,1);state.captures++;if(state.hold)await state.hold;return 'data:image/jpeg;base64,YQ==';}},
  windows:{create:async args=>{state.created.push(args);assert.equal(args.focused,false);const tab={id:2,windowId:2,url:args.url,active:true,status:'complete'};tabs.push(tab);return {id:2,tabs:[tab]};},getAll:async()=>[...new Set(tabs.map(t=>t.windowId))].map(id=>({id})),get:async id=>({id,state:'normal',focused:id===state.focus}),remove:async id=>{state.removed.push(id);for(let i=tabs.length-1;i>=0;i--)if(tabs[i].windowId===id)tabs.splice(i,1);api.windows.onRemoved.fire(id);},onRemoved:event(),onBoundsChanged:event()}};
 api.probeState=async(id,message,options)=>{state.probes.push({id,message,options});return {ready:true,url:tabs.find(tab=>tab.id===id).url,visible:true};};
 api.scripting={executeScript:async injection=>{assert.deepEqual(injection.target.frameIds,[0]);assert.equal(injection.injectImmediately,true);assert.equal(typeof injection.func,'function');return [{frameId:0,result:await api.probeState(injection.target.tabId,{type:'preview:documentReady'},{frameId:0})}];}};
 api.tabs.create=async args=>{state.created.push(args);assert.equal(args.active,false);const tab={id:2,windowId:args.windowId,url:args.url,active:false,status:'complete'};tabs.push(tab);return {...tab};};
 api.tabs.onRemoved=event();api.tabs.onActivated=event();api.tabs.onDetached=event();
 state.attached=false;
 api.tabs.remove=async id=>{state.removed.push(id);const i=tabs.findIndex(t=>t.id===id);if(i>=0)tabs.splice(i,1);state.attached=false;api.tabs.onRemoved.fire(id);api.debugger.onDetach.fire({tabId:id});};
 api.capture=async()=>{state.captures++;if(state.hold)await state.hold;return {data:'YQ=='};};
 api.debugger={attach:async({tabId})=>{assert.equal(tabId,2);state.attached=true;},sendCommand:async(target,method)=>{assert.equal(target.tabId,2);assert.equal(method,'Page.captureScreenshot');assert.equal(state.attached,true);return api.capture();},onDetach:event()};
 api.windows.get=async id=>id===1?{...state.owner,focused:id===state.focus}:{id,state:'normal',focused:id===state.focus};
 api.windows.update=async(id,patch)=>{state.windowUpdates.push({id,patch});return {id,...patch};};
 let queue=Promise.resolve();const serial=fn=>{const result=queue.then(fn);queue=result.catch(error=>state.queueErrors.push(error));return result;};
 const {db,cache}=installThumbnailCache(api);
 const worker=previewBatchWorker({api,serial,settleMs:0,pollMs:1,loadTimeoutMs:25,captureTimeoutMs:100,...options});
 return {api,local,session,state,tabs,worker,db,cache};
}
async function finished(worker){for(let i=0;i<200;i++){const status=await worker.status();if(status.state!=='running')return status;await new Promise(r=>setTimeout(r,2));}throw Error('Batch did not settle');}
function keepLoading(f,pendingUrl){
 const update=f.api.tabs.update;
 f.api.tabs.update=async(id,patch)=>{
  const result=await update(id,patch);
  if(patch.url){const tab=f.tabs.find(tab=>tab.id===id);tab.status='loading';if(pendingUrl)tab.pendingUrl=pendingUrl;return {...tab};}
  return result;
 };
}

test('a rendered main document can be captured while a slow subresource keeps the tab loading',async()=>{
 const f=fixture(),phases=[],set=f.api.storage.session.set;keepLoading(f);
 f.api.storage.session.set=async patch=>{if(patch[PREVIEW_JOB_KEY])phases.push(patch[PREVIEW_JOB_KEY].phase);return set(patch);};
 const probes=[];
 f.api.probeState=async(id,message,options)=>{probes.push({id,message,options});return {ready:true,url:f.tabs.find(tab=>tab.id===id).url,visible:true};};
 await start(f,{urls:['https://rendered.test/']});const result=await finished(f.worker);
 assert.equal(result.saved,1);assert.equal(result.failed,0);assert.equal(f.state.captures,1);
 assert.ok(probes.length>0);assert.ok(probes.every(({id,message,options})=>id===2&&message.type==='preview:documentReady'&&options?.frameId===0));
 assert.ok(phases.includes('loading'));assert.ok(phases.includes('capture'));assert.equal(result.phase,null);
 assert.ok(await f.cache.get('https://rendered.test/'));
});
test('complete tabs verify main-frame readiness and visibility before capture',async()=>{
 const f=fixture();
 await start(f,{urls:['https://complete.test/']});const result=await finished(f.worker);
 assert.equal(result.saved,1);assert.equal(result.failed,0);
 assert.ok(f.state.probes.length>=2);assert.ok(f.state.probes.every(({id,message,options})=>id===2&&message.type==='preview:documentReady'&&options?.frameId===0));
});
for(const state of ['normal','minimized','maximized','fullscreen']){
 test(`background capture leaves the ${state} owner unchanged`,async()=>{
  const f=fixture();f.state.owner={...owner,state};const before={...f.state.owner};
  await start(f,{urls:['https://new.test/']});const result=await finished(f.worker);
  assert.equal(result.saved,1);assert.deepEqual(f.state.created,[{windowId:1,url:'chrome-extension://test/preview-loading.html',active:false}]);
  assert.deepEqual(f.state.windowUpdates,[]);assert.deepEqual(f.state.owner,before);assert.equal(f.state.focus,1);
  assert.equal(f.state.attached,false);assert.equal(f.tabs[0].active,true);assert.equal(f.tabs.length,1);
 });
}
for(const windowId of [undefined,-1,1.5]){
 test(`invalid owner ${windowId} is rejected before creating a tab`,async()=>{
  const f=fixture();await assert.rejects(f.worker.start({urls:['https://new.test/'],windowId}));assert.equal(f.state.created.length,0);
 });
}
test('hidden documents can be captured',async()=>{
 const f=fixture();f.api.probeState=async id=>({ready:true,url:f.tabs.find(t=>t.id===id).url,visible:false});
 await start(f,{urls:['https://one.test/','https://two.test/']});assert.equal((await finished(f.worker)).saved,2);
});
test('attach failure cleans the temporary tab',async()=>{
 const f=fixture();f.api.debugger.attach=async()=>{throw Error('Another debugger is attached');};
 await start(f,{urls:['https://new.test/']});const result=await finished(f.worker);
 assert.equal(result.state,'error');assert.equal(result.reason,'debugger');assert.equal(f.tabs.length,1);assert.equal(f.state.captures,0);
});
test('a capture command detects a lost debugger even without a detach event',async()=>{
 const f=fixture();f.api.capture=async()=>{throw Error('Debugger is not attached to the tab with id: 2.');};
 await start(f,{urls:['https://first.test/','https://never.test/']});const result=await finished(f.worker);
 assert.equal(result.state,'stopped');assert.equal(result.reason,'debugger');
 assert.deepEqual(f.state.navigated,['https://first.test/']);assert.equal(f.tabs.length,1);assert.deepEqual(f.state.queueErrors,[]);
});
test('cancellation during attach closes the target after attach settles',async()=>{
 const f=fixture();let release,started=false;f.api.debugger.attach=()=>{started=true;return new Promise(resolve=>{release=resolve;});};
 await start(f,{urls:['https://never.test/']});while(!started)await new Promise(r=>setTimeout(r,1));
 const cancelled=f.worker.cancel();release();await cancelled;
 for(let i=0;i<50&&f.worker.running;i++)await new Promise(r=>setTimeout(r,1));
 assert.equal(f.worker.running,false);assert.equal(f.tabs.length,1);assert.deepEqual(f.state.navigated,[]);assert.deepEqual(f.state.queueErrors,[]);
});
for(const condition of ['not ready','changed URL']){
 test(`a queued page that becomes ${condition} fails before requesting screenshot pixels`,async()=>{
  let f,queueEntries=0;
  f=fixture({serial:async fn=>{queueEntries++;return fn();}});
  f.api.probeState=async id=>({ready:queueEntries<2||condition!=='not ready',url:queueEntries>=2&&condition==='changed URL'?'https://new-document.test/':f.tabs.find(tab=>tab.id===id).url,visible:true});
  await start(f,{urls:['https://queued.test/']});const result=await finished(f.worker);
  assert.equal(result.failed,1);assert.equal(result.failures[0].reason,'pageChanged');assert.equal(result.failures[0].stage,'capture');
  assert.equal(f.state.captures,0);assert.equal(f.db.state.images.size,0);assert.deepEqual(f.state.removed,[2]);
 });
}
test('stale hidden responses cannot classify a different document as covered',async()=>{
 const f=fixture();f.api.probeState=async()=>({ready:true,url:'https://stale.test/',visible:false});
 await start(f,{urls:['https://current.test/']});const result=await finished(f.worker);
 assert.equal(result.state,'complete');assert.equal(result.failed,1);assert.equal(result.failures[0].reason,'loadTimeout');assert.equal(f.state.captures,0);
});
test('a failed on-demand check reports a load failure without assuming visibility',async()=>{
 const f=fixture();f.api.probeState=async()=>{throw Error('Synthetic injection failure');};
 await start(f,{urls:['https://receiver.test/']});const result=await finished(f.worker);
 assert.equal(result.failed,1);assert.equal(result.failures[0].reason,'load');assert.equal(f.state.captures,0);
});
test('image readback failure stops after one diagnostic and preserves existing cached previews',async()=>{
 const f=fixture();f.local[THUMBNAIL_KEY]={'https://cached.test/':{image:'data:image/jpeg;base64,YQ==',at:Date.now()}};
 f.api.capture=async()=>{f.state.captures++;throw Error('Failed to capture tab: image readback failed.');};
 await start(f,{urls:['https://cached.test/','https://readback.test/','https://later.test/']});const result=await finished(f.worker);
 assert.equal(result.state,'stopped');assert.equal(result.reason,'readback');assert.equal(result.processed,1);assert.equal(result.failed,1);assert.equal(result.saved,0);
 assert.equal(result.failures.length,1);assert.equal(result.failures[0].reason,'capture');assert.equal(result.failures[0].stage,'capture');assert.ok(result.failures[0].elapsedMs>=0);assert.match(result.failures[0].detail,/image readback failed/i);
 assert.equal(f.state.captures,1);assert.deepEqual(f.state.navigated,['https://readback.test/']);assert.deepEqual(f.state.removed,[2]);assert.equal(result.phase,null);
 assert.ok(await f.cache.get('https://cached.test/'));assert.deepEqual([...f.db.state.images.keys()],['https://cached.test/']);
});
for(const condition of ['not ready','wrong URL','pending navigation']){
 test(`a loading tab with ${condition} cannot pass the document-ready boundary`,async()=>{
  const f=fixture();keepLoading(f,condition==='pending navigation'?'https://pending.test/':undefined);let probes=0;
  f.api.probeState=async(id,message,options)=>{
   probes++;assert.equal(options?.frameId,0);assert.equal(message.type,'preview:documentReady');
   return {ready:condition!=='not ready',url:condition==='wrong URL'?'https://stale.test/':f.tabs.find(tab=>tab.id===id).url,visible:true};
  };
  await start(f,{urls:['https://loading.test/']});const result=await finished(f.worker);
  assert.equal(result.saved,0);assert.equal(f.state.captures,0);assert.equal(f.db.state.images.size,0);
  assert.equal(result.failed,1);assert.equal(result.failures[0].reason,'loadTimeout');assert.equal(result.failures[0].stage,'loading');
  assert.ok(result.failures[0].elapsedMs>=0);assert.equal(typeof result.failures[0].detail,'string');assert.ok(result.failures[0].detail.length>0);assert.equal(result.phase,null);
  if(condition==='pending navigation')assert.equal(probes,0);else assert.ok(probes>0);
 });
}
test('a readiness probe error other than a missing receiver is reported as a load failure',async()=>{
 const f=fixture();keepLoading(f);let probes=0;
 f.api.probeState=async()=>{probes++;throw Error('synthetic probe backend failure');};
 await start(f,{urls:['https://probe.test/']});const result=await finished(f.worker);
 assert.equal(probes,1);assert.equal(result.failed,1);assert.equal(result.failures[0].reason,'load');assert.equal(result.failures[0].stage,'loading');
 assert.match(result.failures[0].detail,/synthetic probe backend failure/);assert.equal(f.state.captures,0);assert.equal(result.phase,null);
});
test('a nonresponding main-frame probe still expires at the page load deadline',async()=>{
 const f=fixture();keepLoading(f);let probes=0;
 f.api.probeState=()=>{probes++;return new Promise(()=>{});};
 try{
  await start(f,{urls:['https://hung-main-thread.test/']});const result=await finished(f.worker);
  assert.equal(probes,1);assert.equal(result.failed,1);assert.equal(result.failures[0].reason,'loadTimeout');assert.equal(result.failures[0].stage,'loading');
  assert.equal(result.phase,null);assert.equal(f.state.captures,0);assert.deepEqual(f.state.removed,[2]);
 }finally{await f.worker.cancel();}
});
test('cancelling an unanswered readiness probe releases the batch without waiting for the load deadline',async()=>{
 const f=fixture({loadTimeoutMs:1000});keepLoading(f);let probes=0;
 f.api.probeState=()=>{probes++;return new Promise(()=>{});};
 try{
  await start(f,{urls:['https://hung-main-thread.test/','https://next.test/']});
  for(let i=0;i<50&&!probes;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(probes,1);assert.equal((await f.worker.status()).phase,'loading');
  const cancelled=await f.worker.cancel();assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.phase,null);
  for(let i=0;i<50&&f.worker.running;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(f.worker.running,false);assert.equal(f.state.captures,0);assert.equal(f.db.state.images.size,0);assert.deepEqual(f.state.navigated,['https://hung-main-thread.test/']);
 }finally{await f.worker.cancel();}
});
for(const {reason,code,message} of [
 {reason:'captureTimeout',code:'CAPTURE_TIMEOUT',message:'Synthetic screenshot deadline'},
 {reason:'pageChanged',code:'PAGE_CHANGED',message:'Synthetic page changed'},
 {reason:'image',code:'CAPTURE_TOO_LARGE',message:'Synthetic image too large'},
 {reason:'capture',message:'Synthetic capture backend failure'}
]){
 test(`${reason} failures preserve capture-stage diagnostics`,async()=>{
  const f=fixture();f.api.capture=async()=>{throw Object.assign(Error(message),code?{code}:{});};
  await start(f,{urls:['https://capture.test/']});const result=await finished(f.worker),failure=result.failures[0];
  assert.equal(result.failed,1);assert.equal(result.saved,0);assert.equal(failure.reason,reason);assert.equal(failure.stage,'capture');
  assert.ok(failure.elapsedMs>=0);assert.match(failure.detail,new RegExp(message));assert.equal(result.phase,null);assert.equal(f.db.state.images.size,0);
 });
}
test('a non-quota cache write failure is diagnosed as storage in the save stage',async()=>{
 const f=fixture();await f.cache.list();f.db.beforeWrite=async()=>{throw Error('Synthetic save backend failure');};
 await start(f,{urls:['https://save.test/']});const result=await finished(f.worker),failure=result.failures[0];
 assert.equal(result.failed,1);assert.equal(result.saved,0);assert.equal(failure.reason,'storage');assert.equal(failure.stage,'save');
 assert.ok(failure.elapsedMs>=0);assert.match(failure.detail,/Synthetic save backend failure/);assert.equal(result.phase,null);assert.equal(f.db.state.images.size,0);
});
test('a navigation failure is diagnosed as load rather than capture',async()=>{
 const f=fixture(),update=f.api.tabs.update;
 f.api.tabs.update=async(id,patch)=>{if(patch.url)throw Error('Synthetic navigation backend failure');return update(id,patch);};
 await start(f,{urls:['https://navigate.test/']});const result=await finished(f.worker),failure=result.failures[0];
 assert.equal(failure.reason,'load');assert.equal(failure.stage,'loading');assert.match(failure.detail,/Synthetic navigation backend failure/);
 assert.ok(failure.elapsedMs>=0);assert.equal(result.phase,null);assert.equal(f.state.captures,0);
});
test('capture permission errors stop the batch before it visits any following URL',async()=>{
 const f=fixture();f.api.capture=async()=>{throw Error('Either the all_urls or activeTab permission is required.');};
 await start(f,{urls:['https://first.test/','https://second.test/']});const result=await finished(f.worker);
 assert.equal(result.state,'stopped');assert.equal(result.reason,'permission');assert.equal(result.phase,null);
 assert.deepEqual(f.state.navigated,['https://first.test/']);assert.equal(result.saved,0);assert.equal(f.db.state.images.size,0);
});

test('current scope skips cached/excluded pages, deduplicates and uses one unfocused muted temporary tab',async()=>{
 const f=fixture();f.local[THUMBNAIL_KEY]={'https://cached.test/':{image:'data:image/jpeg;base64,YQ==',at:Date.now()}};f.local.config.excluded=['blocked.test'];
 await start(f,{urls:['https://one.test/','https://one.test/','https://two.test/','https://cached.test/','https://mail.google.com/','https://blocked.test/']});
 const result=await finished(f.worker);
 assert.equal(result.state,'complete');assert.equal(result.saved,2);assert.equal(result.skipped,3);assert.equal(result.total,2);
 assert.deepEqual(result.skipReasons,{cached:1,email:1,excluded:1,unsupported:0});
 assert.deepEqual(f.state.navigated,['https://one.test/','https://two.test/']);assert.equal(f.state.created.length,1);assert.deepEqual(f.state.removed,[2]);
 assert.equal(f.session[PREVIEW_WINDOW_KEY],undefined);assert.deepEqual(f.local.records,[]);assert.deepEqual(f.local.visits,[]);
 assert.ok(f.local[THUMBNAIL_KEY]['https://cached.test/']);
 assert.deepEqual([...f.db.state.images.keys()].sort(),['https://cached.test/','https://one.test/','https://two.test/']);
 assert.deepEqual(Object.keys(f.local[THUMBNAIL_KEY]),['https://cached.test/']);
});
for(const [reason,destination] of [['email','https://mail.google.com/mail/'],['excluded','https://blocked.test/private']]){
 test(`a redirect to an ${reason} page is counted in its own skip reason without capturing`,async()=>{
  const f=fixture(),update=f.api.tabs.update;f.local.config.excluded=['blocked.test'];
  f.api.tabs.update=async(id,patch)=>{
   const result=await update(id,patch);
   if(patch.url){const tab=f.tabs.find(tab=>tab.id===id);tab.url=destination;return {...tab};}
   return result;
  };
  await start(f,{urls:['https://redirect.test/']});const result=await finished(f.worker);
  assert.equal(result.state,'complete');assert.equal(result.skipped,1);assert.equal(result.processed,1);assert.equal(result.saved,0);assert.equal(result.failed,0);
  assert.deepEqual(result.skipReasons,{cached:0,email:reason==='email'?1:0,excluded:reason==='excluded'?1:0,unsupported:0});
  assert.equal(f.state.captures,0);assert.equal(f.db.state.images.size,0);assert.deepEqual(f.state.removed,[2]);
 });
}
test('cancel responds while capture is pending and never saves its late image or loads another URL',async()=>{
 const f=fixture();let release;f.state.hold=new Promise(r=>release=r);
 await start(f,{urls:['https://one.test/','https://two.test/']});
 while(!f.state.captures)await new Promise(r=>setTimeout(r,1));
 await f.worker.cancel();assert.equal((await f.worker.status()).state,'cancelled');assert.deepEqual(f.state.removed,[2]);
 release();await new Promise(r=>setTimeout(r,10));
 assert.equal(f.db.state.images.size,0);assert.equal(f.local[THUMBNAIL_KEY],undefined);assert.deepEqual(f.state.navigated,['https://one.test/']);
});
test('permission denied never creates a window; cached-only batches do not visit sites',async()=>{
 const f=fixture();f.state.allowed=false;await assert.rejects(start(f,{urls:['https://one.test/']}));assert.equal(f.state.created.length,0);
 f.state.allowed=true;f.local[THUMBNAIL_KEY]={'https://cached.test/':{image:'data:image/jpeg;base64,YQ==',at:Date.now()}};
 await f.worker.start({urls:['https://cached.test/']});assert.equal((await finished(f.worker)).saved,0);assert.equal(f.state.created.length,0);
});
test('cancellation before the cache transaction commits prevents a late image',async()=>{
 const f=fixture();await f.cache.list();let release,started=false;const gate=new Promise(r=>release=r);
 f.db.beforeWrite=async()=>{started=true;await gate;};
 await start(f,{urls:['https://one.test/']});while(!started)await new Promise(r=>setTimeout(r,1));
 await f.worker.cancel();release();await new Promise(r=>setTimeout(r,10));
 assert.equal(f.db.state.images.size,0);assert.equal(f.local[THUMBNAIL_KEY],undefined);assert.equal((await f.worker.status()).saved,0);
});
test('a save already committed at cancellation is kept and counted',async()=>{
 const f=fixture();await f.cache.list();let release,started=false;const gate=new Promise(r=>release=r);
 f.db.afterCommit=async()=>{started=true;await gate;};
 await start(f,{urls:['https://one.test/','https://two.test/']});while(!started)await new Promise(r=>setTimeout(r,1));
 await f.worker.cancel();release();await new Promise(r=>setTimeout(r,10));
 const status=await f.worker.status();assert.equal(status.state,'cancelled');assert.equal(status.saved,1);assert.equal(status.processed,1);
 assert.ok(await f.cache.get('https://one.test/'));assert.equal(f.db.state.images.size,1);assert.deepEqual(f.state.navigated,['https://one.test/']);
});
for(const reason of ['closed','focused','debugger','changed']){
 test(`${reason} interrupts capture and prevents late writes`,async()=>{
  const f=fixture();let release;f.state.hold=new Promise(r=>release=r);
  await start(f,{urls:['https://one.test/','https://two.test/']});while(!f.state.captures)await new Promise(r=>setTimeout(r,1));
  if(reason==='closed')await f.api.tabs.remove(2);
  if(reason==='focused')f.api.tabs.onActivated.fire({tabId:2});
  if(reason==='changed')f.api.tabs.onDetached.fire(2);
  if(reason==='debugger')f.api.debugger.onDetach.fire({tabId:2});
  const result=await finished(f.worker);assert.equal(result.state,'cancelled');assert.equal(result.reason,reason);
  release();await new Promise(r=>setTimeout(r,5));assert.equal(f.db.state.images.size,0);assert.equal(f.tabs.length,1);
 });
}
test('temporary tab alone is excluded while its owner tabs remain',async()=>{
 const f=fixture();f.session[PREVIEW_WINDOW_KEY]={kind:'tab',windowId:1,tabId:2};f.tabs.push({id:2,windowId:1,url:'https://real.test/'});
 assert.deepEqual((await userTabs(f.api)).map(t=>t.id),[1]);
});
test('restart closes the background tab without closing its owner',async()=>{
 const f=fixture();await f.worker.status();f.session[PREVIEW_WINDOW_KEY]={kind:'tab',windowId:1,tabId:2};f.tabs.push({id:2,windowId:1,url:'https://one.test/'});
 f.session[PREVIEW_JOB_KEY]={state:'running',total:3,saved:1};
 const resumed=previewBatchWorker({api:f.api,serial:fn=>fn()});assert.equal((await resumed.status()).reason,'interrupted');
 assert.equal(f.tabs.length,1);assert.equal(f.tabs[0].id,1);assert.equal(f.session[PREVIEW_WINDOW_KEY],undefined);
});
test('temporary window is excluded from ordinary tab queries, including duplicate URLs',async()=>{
 const f=fixture();f.session[PREVIEW_WINDOW_KEY]={windowId:2,tabId:2};f.tabs.push({id:2,windowId:2,url:'https://real.test/'});
 assert.deepEqual((await userTabs(f.api)).map(t=>t.id),[1]);
});
test('an interrupted worker cleans its own window and retains cancellation progress on restart',async()=>{
 const f=fixture();await f.worker.status();f.session[PREVIEW_WINDOW_KEY]={windowId:2,tabId:2};f.tabs.push({id:2,windowId:2,url:'https://one.test/'});
 f.session[PREVIEW_JOB_KEY]={state:'running',total:3,saved:1,failed:0,processed:1,skipped:0};
 const resumed=previewBatchWorker({api:f.api,serial:fn=>fn()});const status=await resumed.status();
 assert.equal(status.state,'cancelled');assert.equal(status.reason,'interrupted');assert.equal(status.saved,1);assert.deepEqual(f.state.removed,[2]);assert.equal(f.session[PREVIEW_WINDOW_KEY],undefined);
});
