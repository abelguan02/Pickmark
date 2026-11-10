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

import {organizeHistory} from '../extension/history-workflow.js';
import {organizeBookmarksAI} from '../extension/bookmark-ai-workflow.js';
import {organizeOpenTabs} from '../extension/organize-workflow.js';
const tick=()=>new Promise(r=>setImmediate(r));
test('late open-tab AI cannot restore a tab closed and cleared while the request waits',async tctx=>{
 for(const k of Object.keys(local))delete local[k];local.config=defaults();local.lastCleanupAt=Date.now();local.apiKeys={deepseek:'fake'};
 tabs=[{id:1,url:'https://manual.test',title:'Human'},{id:2,url:'https://pending.test',title:'Pending'}];
 local.records=tabs.map(t=>({id:t.id===1?'human':'pending',day:dayKey(),url:t.url,title:t.title,domain:new URL(t.url).hostname,group:t.id===1?'Human':'待整理',manualGroup:t.id===1}));
 let release;tctx.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({assignments:[{id:'pending',group:'Late'}],suggestedRules:[]})}}]})));}));
 const task=organizeOpenTabs({send});while(!release)await tick();tabs=tabs.filter(t=>t.id===1);await send({type:'cleanup',mode:'all'});release();assert.equal((await task).ai,0);assert.ok(!local.records.some(r=>r.id==='pending'));assert.equal(local.records.find(r=>r.id==='human').group,'Human');
});
test('late history AI never restores removed rows after old/all/automatic cleanup',async tctx=>{
 for(const mode of ['old','all','auto']){
  for(const k of Object.keys(local))delete local[k];
  local.config=defaults();local.lastCleanupAt=Date.now();local.apiKeys={deepseek:'fake'};
  const day=dayKey(Date.now()-(mode==='all'?1:10)*86400000);
  tabs=[{id:1,url:'https://manual.test'}];
  local.records=[{id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Human',manualGroup:true},{id:'pending',day,url:'https://pending.test',title:'Pending',domain:'pending.test',group:'待整理',snapshotGroup:'待整理'}];
  local['pickmark-bookmarks-v1']={metadata:{test:'untouched'}};
  let release;const mock=tctx.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({assignments:[{id:'pending',group:'Late'}],suggestedRules:[]})}}]})));}));
  const job=organizeHistory({send,day,ids:['pending']});while(!release)await tick();
  if(mode==='auto'){local.config.retentionDays=7;for(const handler of chrome.alarms.onAlarm.listeners)await handler({name:'data-maintenance'});}
  else await send({type:'cleanup',mode,days:7});
  release();const result=await job;assert.equal(result.ai,0);assert.equal(result.reason,'changed');
  assert.ok(!local.records.some(r=>r.id==='pending'));assert.equal(local.records.find(r=>r.id==='human').group,'Human');assert.deepEqual(local['pickmark-bookmarks-v1'],{metadata:{test:'untouched'}});
  mock.mock.restore();
 }
});
test('in-flight bookmark AI survives independent history cleanup',async tctx=>{
 for(const k of Object.keys(local))delete local[k];local.config=defaults();local.lastCleanupAt=Date.now();local.apiKeys={deepseek:'fake'};tabs=[];
 local.records=[{id:'past',day:dayKey(Date.now()-86400000),url:'https://past.test',group:'Saved'}];
 chrome.permissions={contains:async()=>true};chrome.bookmarks={getTree:async()=>[{children:[{id:'b1',title:'Synthetic',url:'https://bookmark.test'}]}]};
 let release;tctx.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({assignments:[{id:'b1',group:'Book AI'}],suggestedRules:[]})}}]})));}));
 const prepared=await send({type:'bookAI:prepare',ids:['b1']});
 const task=organizeBookmarksAI({send,prepared,token:'review'});while(!release)await tick();
 await send({type:'cleanup',mode:'all'});release();assert.equal((await task).applied,1);assert.deepEqual(local.records,[]);assert.equal(local['pickmark-bookmarks-v1'].metadata.b1.group,'Book AI');
});

