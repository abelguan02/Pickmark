import test from 'node:test';
import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {installThumbnailCache} from './thumbnail-fixture.js';
import {requestRecordsSignature} from '../extension/classification-request.js';
import {settingsSignature,defaults,dayKey,classificationContext} from '../extension/core.js';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
const local={},session={},updates=[],created=[];
let failure=null,failAfter=0;
let tabs=[{id:1,windowId:9,url:'https://example.com/a',title:'One'},{id:2,windowId:9,url:'https://example.com/a',title:'Duplicate'},{id:3,windowId:9,url:'https://secret.com/a',title:'Secret',incognito:true}];
function storage(data){return{async get(keys){return Object.fromEntries((keys===null?Object.keys(data):Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},async set(value){
 if(data===local&&(failure||failAfter>0&&!--failAfter))throw new Error(failure||'QUOTA_BYTES quota exceeded');
 const merged={...data,...value};
 const bytes=Object.entries(merged).reduce((sum,[key,item])=>sum+Buffer.byteLength(key)+Buffer.byteLength(JSON.stringify(item)),0);
 if(data===local&&bytes>10*1024*1024)throw new Error('QUOTA_BYTES quota exceeded');
 Object.assign(data,structuredClone(value));
},async getBytesInUse(keys){return storageBytes(data,keys);},async remove(keys){for(const key of keys)delete data[key];},async setAccessLevel(){}};}
const panelBehaviors=[];
globalThis.chrome={sidePanel:{async setPanelBehavior(value){panelBehaviors.push(value)}},storage:{local:storage(local),session:storage(session)},runtime:{id:'test',getURL:path=>`chrome-extension://test/${path}`,onInstalled:event(),onStartup:event(),onMessage:event()},tabs:{async query(){return structuredClone(tabs)},async update(id,patch){updates.push({id,patch})},async create(value){if(value.url==='https://failure.test/')throw new Error('test failure');created.push(value);const tab={id:100+created.length,windowId:9,...value};tabs.push(tab);return tab;},onCreated:event(),onRemoved:event(),onUpdated:event(),onActivated:event()},windows:{async update(id,patch){updates.push({window:id,patch})}}};
const maintenanceAlarms=[];
chrome.alarms={async clear(){return true;},async get(){return undefined;},async create(name,options){maintenanceAlarms.push({name,...options});},onAlarm:event()};
chrome.windows.onFocusChanged=event();chrome.windows.getLastFocused=async()=>({id:9,focused:true});
chrome.permissions={contains:async()=>true};
chrome.bookmarks={getTree:async()=>[{children:[{id:'b1',title:'Synthetic bookmark',url:'https://bookmark.test'}]}]};
installThumbnailCache(chrome,{migrated:true});
await import('../extension/background.js');
const send=input=>{const message=input.type==='settings'&&!Object.hasOwn(input,'expectedSettings')?{...input,expectedSettings:settingsSignature(local.config)}:input;return new Promise((resolve,reject)=>chrome.runtime.onMessage.listeners[0](message,{id:'test',url:'chrome-extension://test/dashboard.html'},response=>response.error?reject(new Error(response.error)):resolve(response.value)));};


test('near-quota startup remains readable and cleanup restores writes',async()=>{
 for(const k of Object.keys(local))delete local[k];
 local.config={...defaults(),recording:false};local.lastCleanupAt=Date.now();tabs=[{id:1,url:'https://manual.test'}];
 local.records=[{id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Human',manualGroup:true}];
 const metadata=Object.fromEntries(Array.from({length:20000},(_,i)=>[String(i),{url:'https://bookmark.test/'+String(i).padEnd(400,'x'),group:'Saved',manualGroup:true}]));
 local['pickmark-bookmarks-v1']={metadata};
 local['pickmark-thumbnails-v1']={padding:'x'.repeat(10000)};
 const target=10*1024*1024-128*1024-64;
 metadata['19999'].url+='x'.repeat(target-Buffer.byteLength(JSON.stringify(local)));
 const {writeLocal}=await import('../extension/storage-budget.js');
 await writeLocal({'pickmark-bookmarks-v1':local['pickmark-bookmarks-v1']});
 const bytes=Buffer.byteLength(JSON.stringify(local));assert.ok(bytes<10*1024*1024);
 const before=structuredClone(local);
 const result=await send({type:'get'});assert.equal(result.storageWarning,undefined);assert.equal(result.records[0].group,'Human');
 await send({type:'storageInfo'});await send({type:'cleanupPreview',mode:'all'});
 assert.deepEqual(local,before);
 assert.equal((await send({type:'getHistory'})).records[0].group,'Human');
 // Free synthetic cache without changing bookmark metadata or manual records.
 await send({type:'cleanup',mode:'cache'});
 assert.equal(local.records[0].group,'Human');assert.deepEqual(local['pickmark-bookmarks-v1'],before['pickmark-bookmarks-v1']);
 assert.equal((await send({type:'get'})).storageWarning,undefined);
});

test('browser quota rejection preserves data, keys and history while read entries remain available',async()=>{
 for(const k of Object.keys(local))delete local[k];
 local.config={...defaults(),recording:false};local.records=[{id:'old-human',day:'2020-01-01',url:tabs[0].url,title:'Human',group:'Human',manualGroup:true}];
 session.apiKey='synthetic-key';local.visits=[];
 const before=structuredClone(local);failure='QUOTA_BYTES quota exceeded';
 try{
  for(const type of ['get','getHistory']){const result=await send({type});assert.equal(result.storageWarning,true);assert.equal(result.records[0].id,'old-human');}
  await send({type:'storageInfo'});await send({type:'cleanupPreview',mode:'all'});
  await send({type:'getKey'});assert.equal(session.apiKey,'synthetic-key');
  await assert.rejects(send({type:'cleanup',mode:'all'}),/QUOTA_BYTES/);
  assert.deepEqual(local,before);
 }finally{failure=null;}
 await send({type:'cleanup',mode:'all'});
 assert.ok(!local.records.some(r=>r.id==='old-human'));
 failure='QUOTA_BYTES quota exceeded';
 try{assert.ok(!(await send({type:'get'})).records.some(r=>r.id==='old-human'));}finally{failure=null;}
});
test('unrelated read/write failures are not silently treated as storage pressure',async()=>{
 failure='Unexpected backend failure';try{await assert.rejects(send({type:'get'}),/Unexpected backend failure/);}finally{failure=null;}
});
test('fallback after successful cleanup and failed collection reads the fresh committed snapshot',async()=>{
 for(const k of Object.keys(local))delete local[k];delete session.apiKey;
 local.config=defaults();local.records=[{id:'expired',day:'2020-01-01',url:'https://expired.test',title:'Expired',group:'Old'},
 {id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Human',manualGroup:true}];
 // Maintenance commits; the following page collection is rejected.
 failAfter=2;
 try{
  const result=await send({type:'get'});assert.equal(result.storageWarning,true);
  assert.ok(!result.records.some(r=>r.id==='expired'));assert.ok(!local.records.some(r=>r.id==='expired'));
  assert.equal(result.records.find(r=>r.id==='human').group,'Human');
  assert.equal(result.config.historyRevision,local.config.historyRevision);assert.ok(local.config.historyRevision>0);
 }finally{failAfter=0;}
});
test('cache, old and all cleanup resume collecting pages without disturbing bookmarks',async t=>{
 let now=new Date('2026-10-13T12:00:00').getTime();t.mock.method(Date,'now',()=>now);
 for(const mode of ['cache','old','all']){
  for(const key of Object.keys(local))delete local[key];for(const key of Object.keys(session))delete session[key];
  tabs=[{id:1,windowId:9,url:'https://manual.test',title:'Human'}];
  local.config=defaults();local.lastCleanupAt=now;
  local.records=[{id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Human',manualGroup:true},
   {id:'history',day:dayKey(now-86400000),url:'https://history.test',domain:'history.test',title:'Pending history',group:'待整理',snapshotGroup:'待整理'}];
  const bookmark={metadata:{b1:{url:'https://bookmark.test',group:'Human bookmark',manualGroup:true}},rules:[],groups:['Human bookmark'],revision:1};
  local['pickmark-bookmarks-v1']=structuredClone(bookmark);local['pickmark-thumbnails-v1']={padding:'synthetic'};
  await send({type:'get'});now+=60000;
  const before=structuredClone(local);failure='QUOTA_BYTES quota exceeded';
  try{
   assert.equal((await send({type:'get'})).storageWarning,true);assert.deepEqual(local,before);
   assert.equal((await send({type:'bookmarks:get'})).rows[0].group,'Human bookmark');
   await assert.rejects(send({type:'bookmarks:patch',id:'b1',url:'https://bookmark.test',group:'Rejected',expectedRevision:1}),/QUOTA_BYTES/);
   assert.deepEqual(local,before);
  }finally{failure=null;}
  await send({type:'cleanup',mode,days:7});
  tabs.push({id:2,windowId:9,url:'https://new.test',title:'New after cleanup'});
  let result=await send({type:'get'});assert.equal(result.storageWarning,undefined);assert.equal(local.config.recording,true);
  assert.ok(local.records.some(r=>r.url==='https://new.test'));
  now+=60000;result=await send({type:'get'});
  assert.equal(local.visits,undefined);assert.equal(local.records.find(r=>r.id==='human').lastSeen,now);
  assert.equal(local.records.find(r=>r.id==='human').group,'Human');assert.equal(local.records.find(r=>r.id==='human').manualGroup,true);
  assert.deepEqual(local['pickmark-bookmarks-v1'],bookmark);
  if(mode==='all')assert.ok(!result.records.some(r=>r.id==='history'));
  else{
   const history=await send({type:'getHistory'});assert.ok(history.records.some(r=>r.id==='history'));
   local.config.rules=[{keyword:'history.test',group:'Recovered history'}];
   const applied=await send({type:'historyRules',day:dayKey(now-86400000),ids:['history'],expectedContext:classificationContext(local.config,'')});
   assert.equal(applied.matched,1);assert.equal(local.records.find(r=>r.id==='history').snapshotGroup,'Recovered history');
  }
 }
});

