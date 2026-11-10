import test from 'node:test';
import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {installThumbnailCache} from './thumbnail-fixture.js';
import {requestRecordsSignature} from '../extension/classification-request.js';
import {settingsSignature,defaults,dayKey,classificationContext} from '../extension/core.js';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
const local={},session={},updates=[],created=[];
let failure=null,failAfter=0,failSettings=false;
const writes=[];
let tabs=[{id:1,windowId:9,url:'https://example.com/a',title:'One'},{id:2,windowId:9,url:'https://example.com/a',title:'Duplicate'},{id:3,windowId:9,url:'https://secret.com/a',title:'Secret',incognito:true}];
function storage(data){return{async get(keys){return Object.fromEntries((keys===null?Object.keys(data):Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},async set(value){
 if(data===local){writes.push(structuredClone(value));if(failSettings&&value.config&&value.records)throw new Error('QUOTA_BYTES quota exceeded');}
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
chrome.idle={setDetectionInterval(){},async queryState(){return 'active';},onStateChanged:event()};
chrome.windows.onFocusChanged=event();chrome.windows.getLastFocused=async()=>({id:9,focused:true});
chrome.permissions={contains:async()=>true};
chrome.bookmarks={getTree:async()=>[{children:[{id:'b1',title:'Synthetic bookmark',url:'https://bookmark.test'}]}]};
const {db:previewDB,cache:previewCache}=installThumbnailCache(chrome,{migrated:true});
await import('../extension/background.js');
const send=input=>{const message=input.type==='settings'&&!Object.hasOwn(input,'expectedSettings')?{...input,expectedSettings:settingsSignature(local.config)}:input;return new Promise((resolve,reject)=>chrome.runtime.onMessage.listeners[0](message,{id:'test',url:'chrome-extension://test/dashboard.html'},response=>response.error?reject(new Error(response.error)):resolve(response.value)));};



test('failed local clear preserves both stores and successful clear preserves open manual state',async()=>{
 const previous=structuredClone(local),oldTabs=structuredClone(tabs);
 try{
  local.config=defaults();local.lastCleanupAt=Date.now();tabs=[{id:1,url:'https://manual.test',title:'Human'}];
  local.records=[{id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Human',manualGroup:true},{id:'old',day:dayKey(Date.now()-86400000),url:'https://old.test',group:'Old'}];
  local['pickmark-thumbnails-v1']={synthetic:{image:'synthetic'}};
  local['pickmark-bookmarks-v1']={metadata:{b1:{url:'https://bookmark.test',group:'Bookmark human',manualGroup:true}},revision:1};
  local.apiKeys={deepseek:'synthetic-only'};
  await previewCache.put('https://manual.test/','data:image/jpeg;base64,YQ==');const previewBefore=structuredClone(previewDB.state);
  const before=structuredClone(local);failSettings=true;
  await assert.rejects(send({type:'clear'}),/QUOTA/);assert.deepEqual(local,before);assert.deepEqual(previewDB.state,previewBefore);
  failSettings=false;writes.length=0;await send({type:'clear'});
  assert.equal(writes.length,1);assert.equal(local.config.recording,false);
  assert.equal(local.records.length,1);assert.equal(local.records[0].group,'Human');assert.equal(local.records[0].manualGroup,true);
  assert.equal(local.visits,undefined);assert.equal(local['pickmark-thumbnails-v1'],undefined);assert.equal(previewDB.state.images.size,0);
  assert.deepEqual(local.apiKeys,before.apiKeys);assert.deepEqual(local['pickmark-bookmarks-v1'],before['pickmark-bookmarks-v1']);
 }finally{failSettings=false;for(const k of Object.keys(local))delete local[k];Object.assign(local,previous);tabs=oldTabs;}
});
test('review: rejected settings save must preserve bookmark manual classifications',async()=>{
 local.config=defaults();local.lastCleanupAt=Date.now();
 tabs=[{id:1,url:'https://manual.test',title:'Human'}];
 local.records=[{id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Human',manualGroup:true}];
 local['pickmark-bookmarks-v1']={metadata:{b1:{url:'https://bookmark.test',group:'Human bookmark',manualGroup:true}},revision:1};
 await previewCache.put('https://bookmark.test/','data:image/jpeg;base64,YQ==');const previewBefore=structuredClone(previewDB.state);
 const before=structuredClone(local);
 failSettings=true;
 await assert.rejects(send({type:'settings',value:{...local.config,excluded:['bookmark.test']}}),/QUOTA_BYTES/);
 failSettings=false;
 assert.deepEqual(local,before);
 assert.deepEqual(local.config.excluded,before.config.excluded);
 assert.deepEqual(local.records,before.records);
 assert.deepEqual(previewDB.state,previewBefore);
 console.log(JSON.stringify({settingsExcluded:local.config.excluded,bookmarksBefore:before['pickmark-bookmarks-v1'],bookmarksAfter:local['pickmark-bookmarks-v1']}));
 assert.deepEqual(local['pickmark-bookmarks-v1'],before['pickmark-bookmarks-v1']);
});


test('settings commit all associated data once and reject stale panel without writes',async()=>{
 for(const k of Object.keys(local))delete local[k];
 local.config=defaults();local.lastCleanupAt=Date.now();local.records=[{id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Human',manualGroup:true},{id:'old',day:'2020-01-01',url:'https://old.test',group:'待整理'}];
 local['pickmark-bookmarks-v1']={metadata:{b1:{url:'https://bookmark.test',group:'Human bookmark',manualGroup:true}},revision:1};
 const before=settingsSignature(local.config);writes.length=0;
 await send({type:'settings',expectedSettings:before,value:{...local.config,excluded:['bookmark.test'],retentionDays:7}});
 assert.equal(writes.length,1);assert.ok(writes[0].config&&writes[0].records&&writes[0]['pickmark-thumbnails-v1']&&writes[0]['pickmark-bookmarks-v1']);
 assert.equal(local.records.find(r=>r.id==='human').group,'Human');assert.ok(!local.records.some(r=>r.id==='old'));
 assert.equal(local['pickmark-bookmarks-v1'].revision,2);assert.ok(local.config.historyRevision>0);
 const snapshot=structuredClone(local);writes.length=0;
 await assert.rejects(send({type:'settings',expectedSettings:before,value:{...local.config,excluded:[]}}),/其他窗口|another/);
 assert.deepEqual(local,snapshot);assert.equal(writes.length,0);
});
test('forget returns committed settings baseline and rejects stale edit sessions',async()=>{
 const base=settingsSignature(local.config);
 const result=await send({type:'key',provider:'deepseek',value:'',expectedSettings:base});
 assert.equal(result.settingsSignature,settingsSignature(local.config));
 assert.notEqual(result.settingsSignature,base);
 assert.equal(local.apiKeys.deepseek,'');
 await send({type:'settings',expectedSettings:result.settingsSignature,apiKey:'replacement-synthetic',value:{...local.config}});
 assert.equal(local.apiKeys.deepseek,'replacement-synthetic');
 const before=structuredClone(local);writes.length=0;
 await assert.rejects(send({type:'key',provider:'deepseek',value:'',expectedSettings:base}),/其他窗口|another/);
 assert.deepEqual(local,before);assert.equal(writes.length,0);
});
test('another panel changing settings after forget invalidates its returned baseline',async()=>{
 const originalConfig=structuredClone(local.config);
 try{
 const result=await send({type:'key',provider:'openai',value:'',expectedSettings:settingsSignature(local.config)});
 await send({type:'settings',expectedSettings:result.settingsSignature,apiKey:'other-panel-synthetic',value:{...local.config,provider:'gemini',model:'synthetic-gemini'}});
 const before=structuredClone(local);writes.length=0;
 await assert.rejects(send({type:'settings',expectedSettings:result.settingsSignature,apiKey:'stale-replacement',value:{...local.config,provider:'openai'}}),/其他窗口|another/);
 assert.deepEqual(local,before);assert.equal(writes.length,0);assert.equal(local.apiKeys.openai,'');
 }finally{local.config=originalConfig;}
});
test('guarded forget failure keeps keys and baseline; retry commits legacy tombstone once',async()=>{
 const before=structuredClone(local),legacy=structuredClone(session);
 try{
  session.apiKeys={openai:'old-session-key'};session.apiKey='legacy-deepseek';
  const base=settingsSignature(local.config),snapshot=structuredClone(local);
  failure='QUOTA_BYTES quota exceeded';writes.length=0;
  await assert.rejects(send({type:'key',provider:'openai',value:'',expectedSettings:base}),/QUOTA/);
  assert.deepEqual(local,snapshot);assert.equal(settingsSignature(local.config),base);assert.equal(writes.length,1);
  failure=null;writes.length=0;
  const result=await send({type:'key',provider:'openai',value:'',expectedSettings:base});
  assert.equal(writes.length,1);assert.equal(result.settingsSignature,settingsSignature(local.config));assert.equal(local.apiKeys.openai,'');
  assert.equal(await send({type:'getKey',provider:'openai'}),'');
 }finally{failure=null;for(const k of Object.keys(local))delete local[k];Object.assign(local,before);for(const k of Object.keys(session))delete session[k];Object.assign(session,legacy);}
});
test('concurrent panel settings use one shared baseline; only one can commit',async()=>{
 const baseline=settingsSignature(local.config),base=structuredClone(local.config);writes.length=0;
 const results=await Promise.allSettled([7,14].map(retentionDays=>send({type:'settings',expectedSettings:baseline,value:{...base,retentionDays}})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal(writes.length,1);assert.equal(local.config.retentionDays,7);
 assert.equal(local.records.find(r=>r.id==='human').group,'Human');
});
test('capacity protection rejects the entire settings transaction without touching local data',async()=>{
 local.padding='x'.repeat(10*1024*1024-128*1024);
 local['pickmark-bookmarks-v1']={metadata:{b1:{url:'https://bookmark.test',group:'Human bookmark',manualGroup:true}},revision:3};
 const before=structuredClone(local);writes.length=0;
 await assert.rejects(send({type:'settings',value:{...local.config,excluded:['bookmark.test']}}),/空间不足/);
 assert.deepEqual(local,before);assert.equal(writes.length,0);delete local.padding;
});
test('key participates in the same settings write; blank preserves keys across providers',async()=>{
 local.apiKeys={deepseek:'synthetic-old',openai:'synthetic-other'};writes.length=0;
 await send({type:'settings',apiKey:' synthetic-new ',value:{...local.config,excluded:[]}});
 assert.equal(writes.length,1);assert.equal(writes[0].apiKeys.deepseek,'synthetic-new');assert.equal(local.apiKeys.openai,'synthetic-other');
 await send({type:'settings',apiKey:'  ',value:{...local.config}});assert.equal(local.apiKeys.deepseek,'synthetic-new');
 const before=structuredClone(local);failSettings=true;
 try{await assert.rejects(send({type:'settings',apiKey:'rejected',value:{...local.config,excluded:['bookmark.test']}}),/QUOTA_BYTES/);}finally{failSettings=false;}
 assert.deepEqual(local,before);
 await assert.rejects(send({type:'settings',apiKey:'x'.repeat(10*1024*1024),value:{...local.config,excluded:['bookmark.test']}}),/空间不足/);assert.deepEqual(local,before);
});
test('simultaneous key-only form saves reject the stale panel',async()=>{
 const expectedSettings=settingsSignature(local.config),value=structuredClone(local.config);writes.length=0;
 const results=await Promise.allSettled(['first','second'].map(apiKey=>send({type:'settings',expectedSettings,apiKey,value})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(writes.length,1);assert.equal(local.apiKeys.deepseek,'first');
 const baseline=settingsSignature(local.config);await send({type:'key',provider:'deepseek',value:''});
 await assert.rejects(send({type:'settings',expectedSettings:baseline,apiKey:'stale',value}),/其他窗口|another/);assert.equal(local.apiKeys.deepseek,'');
});
test('blank key keeps legacy session credentials without a separate migration write',async()=>{
 delete local.apiKeys;session.apiKeys={deepseek:'legacy-synthetic',openai:'legacy-other'};writes.length=0;
 await send({type:'settings',apiKey:'',value:{...local.config}});
 assert.equal(writes.length,1);assert.equal(local.apiKeys.deepseek,'legacy-synthetic');assert.equal(local.apiKeys.openai,'legacy-other');
 delete session.apiKeys;
});
test('switching among all providers preserves blank keys and isolates replacement keys',async()=>{
 const {PROVIDERS}=await import('../extension/providers.js');
 local.apiKeys=Object.fromEntries(PROVIDERS.map(p=>[p.id,'saved-'+p.id]));
 session.apiKeys=Object.fromEntries(PROVIDERS.map(p=>[p.id,'stale-'+p.id]));
 for(const provider of PROVIDERS){
  const keys=structuredClone(local.apiKeys);
  await send({type:'settings',apiKey:' \n ',value:{...local.config,provider:provider.id,model:provider.model}});
  assert.deepEqual(local.apiKeys,keys);
  await send({type:'settings',apiKey:'replacement-'+provider.id,value:{...local.config}});
  assert.deepEqual(local.apiKeys,{...keys,[provider.id]:'replacement-'+provider.id});
  assert.equal(local.records.find(r=>r.id==='human').group,'Human');
 }
 const provider=local.config.provider;
 await send({type:'key',provider,value:''});session.apiKeys={[provider]:'stale-should-not-return'};
 await send({type:'settings',apiKey:'',value:{...local.config}});assert.equal(local.apiKeys[provider],'');
 delete session.apiKeys;
});
test('failed key transaction does not consume the settings version and can be retried safely',async()=>{
 const expectedSettings=settingsSignature(local.config),value={...local.config},before=structuredClone(local);
 failSettings=true;
 try{await assert.rejects(send({type:'settings',expectedSettings,apiKey:'retry-key',value}),/QUOTA_BYTES/);}finally{failSettings=false;}
 assert.deepEqual(local,before);assert.equal(settingsSignature(local.config),expectedSettings);
 await send({type:'settings',expectedSettings,apiKey:'retry-key',value});assert.equal(local.apiKeys[value.provider],'retry-key');
 assert.notEqual(settingsSignature(local.config),expectedSettings);
 const committed=structuredClone(local);
 await assert.rejects(send({type:'settings',apiKey:42,value}),/Invalid API key/);
 await assert.rejects(send({type:'settings',apiKey:'unused',value:{...value,provider:'unsupported'}}));
 assert.deepEqual(local,committed);
});
test('provider switches, replacements and forget across panels preserve isolation in every order, including quota failures',async()=>{
 for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]])for(const full of [false,true]){
  for(const key of Object.keys(local))delete local[key];for(const key of Object.keys(session))delete session[key];
  local.config=defaults();local.lastCleanupAt=Date.now();local.apiKeys={deepseek:'D',openai:'O',gemini:'G'};
  local.records=[{id:'human',day:dayKey(),url:tabs[0].url,title:'Human',group:'Human',manualGroup:true}];
  local['pickmark-bookmarks-v1']={metadata:{b1:{url:'https://bookmark.test',group:'Human bookmark',manualGroup:true}},revision:1};
  const baseline=settingsSignature(local.config),value=structuredClone(local.config),before=structuredClone(local);
  const messages=[{type:'settings',expectedSettings:baseline,apiKey:'new-O',value:{...value,provider:'openai',model:'synthetic-openai'}},{type:'settings',expectedSettings:baseline,apiKey:'new-G',value:{...value,provider:'gemini',model:'synthetic-gemini'}},{type:'key',provider:'openai',value:''}];
  failure=full?'QUOTA_BYTES quota exceeded':null;
  let results;try{results=await Promise.allSettled(order.map(i=>send(messages[i])));}finally{failure=null;}
  if(full){assert.ok(results.every(r=>r.status==='rejected'));assert.deepEqual(local,before);await send(messages[2]);}
  assert.equal(local.apiKeys.deepseek,'D');assert.equal(local.apiKeys.openai,'');
  assert.ok(['G','new-G'].includes(local.apiKeys.gemini));assert.equal(local.records[0].group,'Human');
  assert.deepEqual(local['pickmark-bookmarks-v1'].metadata,before['pickmark-bookmarks-v1'].metadata);
  session.apiKeys={openai:'stale-O'};
  await send({type:'settings',apiKey:' ',value:{...local.config,provider:'openai',model:'synthetic-openai'}});
  assert.equal(local.apiKeys.openai,'');assert.equal(local.apiKeys.deepseek,'D');
 }
 delete session.apiKeys;
});

