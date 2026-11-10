import test from 'node:test';
import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {installThumbnailCache} from './thumbnail-fixture.js';
import {requestRecordsSignature} from '../extension/classification-request.js';
import {settingsSignature,defaults,dayKey,classificationContext} from '../extension/core.js';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
const local={},session={},updates=[],created=[];
let tabs=[{id:1,windowId:9,url:'https://example.com/a',title:'One'},{id:2,windowId:9,url:'https://example.com/a',title:'Duplicate'},{id:3,windowId:9,url:'https://secret.com/a',title:'Secret',incognito:true}];
function storage(data){return{async get(keys){return Object.fromEntries((keys===null?Object.keys(data):Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},async set(value){
 const merged={...data,...value};
 const bytes=Object.entries(merged).reduce((sum,[key,item])=>sum+Buffer.byteLength(key)+Buffer.byteLength(JSON.stringify(item)),0);
 if(data===local&&bytes>10*1024*1024)throw new Error('QUOTA_BYTES quota exceeded');
 Object.assign(data,structuredClone(value));
},async getBytesInUse(keys){return storageBytes(data,keys);},async remove(keys){for(const key of keys)delete data[key];},async setAccessLevel(){}};}
const panelBehaviors=[];
globalThis.chrome={sidePanel:{async setPanelBehavior(value){panelBehaviors.push(value)}},storage:{local:storage(local),session:storage(session)},runtime:{id:'test',getURL:path=>`chrome-extension://test/${path}`,onInstalled:event(),onStartup:event(),onMessage:event()},tabs:{async query(){return structuredClone(tabs)},async update(id,patch){updates.push({id,patch})},async create(value){if(value.url==='https://failure.test/')throw new Error('test failure');created.push(value);const tab={id:100+created.length,windowId:9,...value};tabs.push(tab);return tab;},onCreated:event(),onRemoved:event(),onUpdated:event(),onActivated:event()},windows:{async update(id,patch){updates.push({window:id,patch})}}};
const maintenanceAlarms=[];
chrome.alarms={async clear(){return true;},async get(){return undefined;},async create(name,options){maintenanceAlarms.push({name,...options});},onAlarm:event()};
installThumbnailCache(chrome,{migrated:true});
await import('../extension/background.js');
const send=input=>{const message=input.type==='settings'&&!Object.hasOwn(input,'expectedSettings')?{...input,expectedSettings:settingsSignature(local.config)}:input;return new Promise((resolve,reject)=>chrome.runtime.onMessage.listeners[0](message,{id:'test',url:'chrome-extension://test/dashboard.html'},response=>response.error?reject(new Error(response.error)):resolve(response.value)));};

test('quota trimming preserves current manual state after read-only prioritization',async()=>{
 local.config={...defaults(),recording:false};local.lastCleanupAt=Date.now();tabs=[{id:1,url:'https://manual.test'}];
 local.records=[{id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Protected human',manualGroup:true},...Array.from({length:4000},(_,i)=>({id:'h'+i,day:dayKey(Date.now()-86400000),url:'https://history.test/'+i,title:'x'.repeat(700),group:'Saved'}))];
 local['pickmark-bookmarks-v1']={metadata:Object.fromEntries(Array.from({length:18000},(_,i)=>[String(i),{url:'https://bookmarks.test/'+String(i).padEnd(50,'x'),group:'Category'.padEnd(35,'x'),manualGroup:true}]))};
 local['pickmark-thumbnails-v1']={'https://cache.test':{at:Date.now(),image:'data:image/jpeg;base64,'+'A'.repeat(1300000)}};
 const bytes=Buffer.byteLength(JSON.stringify(local));assert.ok(bytes<10*1024*1024);
 const before=await send({type:'getHistory'});assert.ok(before.records.some(r=>r.id==='human'));
 const bookmarks=JSON.stringify(local['pickmark-bookmarks-v1']);
 await send({type:'get'});
 const after=await send({type:'getHistory'});
 console.log(JSON.stringify({bytesBefore:bytes,manualPresentBefore:true,manualPresentAfter:after.records.some(r=>r.id==='human'),remaining:after.records.length,bookmarksUnchanged:JSON.stringify(local['pickmark-bookmarks-v1'])===bookmarks}));
 assert.equal(after.records.some(r=>r.id==='human'&&r.manualGroup&&r.group==='Protected human'),true);
 assert.equal(JSON.stringify(local['pickmark-bookmarks-v1']),bookmarks);
});
test('startup sampling protects old manual state before overdue maintenance runs',async()=>{
 for(const key of Object.keys(local))delete local[key];
 local.config={...defaults(),recording:false};local.lastCleanupAt=0;tabs=[{id:1,url:'https://startup.test'}];
 local.records=[{id:'old-human',day:dayKey(Date.now()-80*86400000),url:tabs[0].url,title:'Startup',group:'Startup human',manualGroup:true},...Array.from({length:4000},(_,i)=>({id:'h'+i,day:dayKey(Date.now()-86400000),url:'https://history.test/'+i,title:'x'.repeat(700),group:'Saved'}))];
 local.padding='x'.repeat(5*1024*1024);local['pickmark-bookmarks-v1']={metadata:{saved:'unchanged'}};
 await send({type:'get'});
 const current=local.records.find(r=>r.url===tabs[0].url);assert.equal(current.group,'Startup human');assert.equal(current.manualGroup,true);assert.equal(current.day,dayKey());assert.notEqual(current.id,'old-human');assert.deepEqual(local['pickmark-bookmarks-v1'],{metadata:{saved:'unchanged'}});
});
