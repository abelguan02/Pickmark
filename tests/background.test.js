import test from 'node:test';
import assert from 'node:assert/strict';
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
},async remove(keys){for(const key of keys)delete data[key];},async setAccessLevel(){}};}
const panelBehaviors=[];
globalThis.chrome={sidePanel:{async setPanelBehavior(value){panelBehaviors.push(value)}},storage:{local:storage(local),session:storage(session)},runtime:{id:'test',getURL:path=>`chrome-extension://test/${path}`,onInstalled:event(),onStartup:event(),onMessage:event()},tabs:{async query(){return structuredClone(tabs)},async update(id,patch){updates.push({id,patch})},async create(value){if(value.url==='https://failure.test/')throw new Error('test failure');created.push(value);const tab={id:100+created.length,windowId:9,...value};tabs.push(tab);return tab;},onCreated:event(),onRemoved:event(),onUpdated:event(),onActivated:event()},windows:{async update(id,patch){updates.push({window:id,patch})}}};
const maintenanceAlarms=[];
chrome.action={onClicked:event()};
chrome.alarms={async get(){return undefined;},async create(name,options){maintenanceAlarms.push({name,...options});},onAlarm:event()};
await import('../extension/background.js');
const send=input=>{const message=input.type==='settings'&&!Object.hasOwn(input,'expectedSettings')?{...input,expectedSettings:settingsSignature(local.config)}:input;return new Promise((resolve,reject)=>chrome.runtime.onMessage.listeners[0](message,{id:'test',url:'chrome-extension://test/dashboard.html'},response=>response.error?reject(new Error(response.error)):resolve(response.value)));};
test('preview status stays readable while a real manual capture holds the write queue',async()=>{
 const saved=structuredClone(local),beforeTabs=tabs,permissions=chrome.permissions,getWindow=chrome.windows.getLastFocused,getTab=chrome.tabs.get,captureTab=chrome.tabs.captureVisibleTab;
 let release,started=false;
 const held=new Promise(resolve=>release=resolve);
 try{
  local.config=defaults();local['pickmark-auto-preview-v1']=true;
  tabs=[{id:100,windowId:9,url:'https://preview-status.test/',active:true,status:'complete'}];
  chrome.permissions={contains:async()=>true};chrome.windows.getLastFocused=async()=>({id:9,focused:true});chrome.tabs.get=async()=>tabs[0];
  chrome.tabs.captureVisibleTab=async()=>{started=true;await held;return 'data:image/jpeg;base64,YQ==';};
  const capture=send({type:'thumbnail:capture',url:tabs[0].url});while(!started)await new Promise(resolve=>setImmediate(resolve));
  let deadline;
  try{
   const status=await Promise.race([send({type:'preview:status',url:tabs[0].url}),new Promise((resolve,reject)=>{deadline=setTimeout(()=>reject(Error('Status blocked behind capture')),200);})]);
   assert.equal(status.state,'generating');
  }finally{clearTimeout(deadline);release();await capture;}
  assert.equal((await send({type:'preview:status',url:tabs[0].url})).state,'saved');
 }finally{
  release();for(const key of Object.keys(local))delete local[key];Object.assign(local,saved);tabs=beforeTabs;
  chrome.permissions=permissions;chrome.windows.getLastFocused=getWindow;chrome.tabs.get=getTab;chrome.tabs.captureVisibleTab=captureTab;
 }
});
test('daily alarm removes expired data even if recording is paused',async()=>{
 const saved=structuredClone(local),beforeTabs=tabs;
 try{
  assert.deepEqual(maintenanceAlarms,[{name:'data-maintenance',periodInMinutes:1440}]);
  tabs=[];local.config={...defaults(),recording:false,retentionDays:7};local.lastCleanupAt=Date.now();local.records=[{id:'expired',day:dayKey(Date.now()-10*86400000),url:'https://synthetic.test'}];local.visits=[];
  for(const handler of chrome.alarms.onAlarm.listeners)await handler({name:'data-maintenance'});
  assert.deepEqual(local.records,[]);assert.equal(local.config.recording,false);assert.ok(local.lastCleanupAt);
 }finally{for(const k of Object.keys(local))delete local[k];Object.assign(local,saved);tabs=beforeTabs;}
});
test('cleanup is previewable, preserves current manual tabs and bookmarks, rejects late history writes',async()=>{
 const saved=structuredClone(local),beforeTabs=tabs;
 try{
  const old=dayKey(Date.now()-50*86400000),yesterday=dayKey(Date.now()-86400000);
  local.config=defaults();local.lastCleanupAt=Date.now();local.apiKeys={deepseek:'fake'};
  tabs=[{id:1,url:'https://open.test'}];
  local.records=[{id:'open',day:old,url:'https://open.test',title:'Open',group:'Human',manualGroup:true},{id:'closed',day:yesterday,url:'https://closed.test',title:'Closed',group:'待整理',snapshotGroup:'待整理'}];
  local.visits=[{day:yesterday,url:'https://closed.test'}];local['pickmark-bookmarks-v1']={metadata:{synthetic:'unchanged'}};
  const context=classificationContext(local.config,''),copy=structuredClone(local.records);
  const preview=await send({type:'cleanupPreview',mode:'all'});assert.equal(preview.records,2);assert.deepEqual(local.records,copy);
  await send({type:'cleanup',mode:'all'});assert.equal(local.records.length,1);assert.equal(local.records[0].group,'Human');assert.equal(local.records[0].manualGroup,true);assert.equal(local.records[0].day,dayKey());assert.deepEqual(local.visits,[]);assert.equal(local.config.recording,true);assert.deepEqual(local['pickmark-bookmarks-v1'],{metadata:{synthetic:'unchanged'}});
  const late=await send({type:'historyAssign',day:yesterday,expectedContext:context,assignments:[{id:'closed',baseTitle:'Closed',baseGroup:'待整理',baseSnapshot:'待整理',baseManual:false,group:'Late'}]});assert.equal(late.accepted,false);assert.equal(local.records.length,1);
  local['pickmark-thumbnails-v1']={'https://test':{image:'fake'}};const before=structuredClone(local.records);await send({type:'cleanup',mode:'cache'});assert.deepEqual(local.records,before);assert.deepEqual(local['pickmark-thumbnails-v1'],{});
 }finally{for(const k of Object.keys(local))delete local[k];Object.assign(local,saved);tabs=beforeTabs;}
});
test('startup maintenance carries old manual state and retention setting immediately removes expired history',async()=>{
 const saved=structuredClone(local),beforeTabs=tabs;
 try{
  local.config=defaults();local.lastCleanupAt=Date.now()-2*86400000;tabs=[{id:1,url:'https://open.test'}];
  local.records=[{id:'old-open',day:dayKey(Date.now()-70*86400000),url:tabs[0].url,title:'Open',group:'Manual',manualGroup:true},{id:'ten',day:dayKey(Date.now()-10*86400000),url:'https://closed.test',group:'Saved'}];local.visits=[];
  await send({type:'getHistory'});assert.equal(local.records.find(r=>r.url===tabs[0].url).manualGroup,true);assert.equal(local.records.length,2);
  await send({type:'settings',value:{...local.config,retentionDays:7}});assert.equal(local.config.retentionDays,7);assert.equal(local.records.length,1);assert.equal(local.records[0].group,'Manual');
  await assert.rejects(send({type:'settings',value:{...local.config,retentionDays:365}}));
 }finally{for(const k of Object.keys(local))delete local[k];Object.assign(local,saved);tabs=beforeTabs;}
});
test('serialized AI dispatch rechecks privacy and releases the queue during the network request',async tctx=>{
 const saved=structuredClone(local),savedTabs=tabs;
 try{
  const day=dayKey(Date.now()-86400000);
  local.config=defaults();local.apiKeys={deepseek:'test-key'};tabs=[];
  local.records=[{id:'dispatch',day,title:'Private page',domain:'private.test',url:'https://private.test/a',group:'待整理',snapshotGroup:'待整理'}];
  const state=await send({type:'getHistory'});
  const message={type:'classify',day,ids:['dispatch'],batchIds:['dispatch'],pendingIds:[],workspaceIds:[],expectedContext:classificationContext(state.config,state.preference),expectedRecords:requestRecordsSignature(state.records)};
  let calls=0,release,started;
  let heartbeat,heartbeatCleared=false;
  tctx.mock.method(globalThis,'setInterval',(fn,delay)=>{assert.equal(delay,20000);heartbeat=fn;return 123;});
  tctx.mock.method(globalThis,'clearInterval',id=>{assert.equal(id,123);heartbeatCleared=true;});
  const networkStarted=new Promise(resolve=>started=resolve);
  tctx.mock.method(globalThis,'fetch',async()=>{calls++;started();return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({assignments:[{id:'dispatch',group:'Research'}],suggestedRules:[]})}}]})));});});
  for(const mutate of [()=>{local.config.excluded=['private.test'];},()=>{local.config.recording=false;},()=>{local.records=[];},()=>{local.records[0].title='Changed';},()=>{local.apiKeys={};}]){
   local.config=structuredClone(state.config);local.records=structuredClone(state.records);local.apiKeys={deepseek:'test-key'};mutate();
   assert.ok(['changed','paused','no-key'].includes((await send(message)).reason));assert.equal(calls,0);
  }
  local.config=structuredClone(state.config);local.records=structuredClone(state.records);local.apiKeys={deepseek:'test-key'};
  const inFlight=send(message);await networkStarted;
  assert.equal(typeof heartbeat,'function');heartbeat();assert.equal(heartbeatCleared,false);
  // A delayed supplier must not prevent clear/pause from completing.
  try{await Promise.race([send({type:'clear'}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('queue blocked by network')),1000);timer.unref();})]);}
  finally{release();}
  assert.ok((await inFlight).plan);assert.equal(calls,1);assert.deepEqual(local.records,[]);assert.equal(local.config.recording,false);
  assert.equal(heartbeatCleared,true);
 }finally{for(const key of Object.keys(local))delete local[key];Object.assign(local,saved);tabs=savedTabs;}
});
test('history classification changes only selected unsorted snapshots without opening tabs',async()=>{
 const saved=structuredClone(local),savedTabs=tabs,savedCreated=created.length;
 try{
  const day=dayKey(Date.now()-86400000),title='Research paper';
  local.config=defaults();local.apiKeys={deepseek:'history-test-key'};local.visits=[{day,group:'待整理',url:'https://history.test/'}];tabs=[];
  const row={day,title,domain:'history.test',url:'https://history.test/',group:'待整理',snapshotGroup:'待整理'};
  local.records=[{...row,id:'pending'},{...row,id:'rule',title:'Guide'},{...row,id:'manual',manualGroup:true},{...row,id:'done',group:'Existing',snapshotGroup:'Existing'},{...row,id:'snapshot',snapshotGroup:'Saved'},{...row,id:'today',day:dayKey()},{...row,id:'outside'}];
  local.config.rules=[{keyword:'Guide',group:'Docs'}];
  const opened=created.length,state=await send({type:'getHistory'}),expectedContext=classificationContext(state.config,state.preference);
  const before=structuredClone(local.records),visits=structuredClone(local.visits);
  const result=await send({type:'historyRules',day,ids:['pending','rule','manual','done','snapshot','today'],expectedContext});
  assert.equal(result.matched,1);assert.equal(local.records.find(r=>r.id==='rule').snapshotGroup,'Docs');
  const assignments=before.filter(r=>r.id!=='outside').map(r=>({id:r.id,group:'Research',baseTitle:r.title,baseGroup:r.group,baseManual:!!r.manualGroup,baseSnapshot:r.snapshotGroup}));
  assert.equal((await send({type:'historyAssign',day,assignments,expectedContext})).applied,1);
  assert.equal(local.records.find(r=>r.id==='pending').snapshotGroup,'Research');
  for(const id of ['manual','done','snapshot','today','outside'])assert.deepEqual(local.records.find(r=>r.id===id),before.find(r=>r.id===id));
  assert.equal(created.length,opened);assert.deepEqual(local.visits,visits);
  const stale={id:'outside',group:'Late result',baseTitle:title,baseGroup:'待整理',baseManual:false,baseSnapshot:'待整理'};
  local.records.find(r=>r.id==='outside').manualGroup=true;
  assert.equal((await send({type:'historyAssign',day,assignments:[stale],expectedContext})).applied,0);
  local.records.find(r=>r.id==='outside').manualGroup=false;
  local.records.find(r=>r.id==='outside').title='Changed title';
  assert.equal((await send({type:'historyAssign',day,assignments:[stale],expectedContext})).applied,0);
  local.records.find(r=>r.id==='outside').title=title;
  assert.equal((await send({type:'historyAssign',day,assignments:[stale],expectedContext:'stale-context'})).accepted,false);
  local.config.recording=false;
  assert.equal((await send({type:'historyAssign',day,assignments:[stale],expectedContext})).accepted,false);
  local.config.recording=true;
  local.apiKeys={};
  assert.equal((await send({type:'historyAssign',day,assignments:[stale],expectedContext})).accepted,false);
  local.apiKeys={deepseek:'history-test-key'};
  assert.equal(local.records.find(r=>r.id==='outside').snapshotGroup,'待整理');
  const restore=await send({type:'restoreDay',day,ids:['pending']});assert.equal(restore.opened,1);
  assert.equal(local.records.find(r=>r.day===dayKey()&&r.url===row.url).group,'Research');
 }finally{for(const key of Object.keys(local))delete local[key];Object.assign(local,saved);tabs=savedTabs;created.length=savedCreated;}
});
test('worker can collect and classify long titles under an enforced storage quota',async()=>{
 const savedLocal=structuredClone(local),savedTabs=tabs;
 try{
  local.config=defaults();local.records=[];
  tabs=Array.from({length:5000},(_,i)=>({id:i,url:`https://large.test/${i}`,title:'x'.repeat(2200)}));
  let state=await send({type:'get'});
  assert.ok(state.records.length>0&&state.records.length<5000);
  await send({type:'assign',assignments:state.records.map(r=>({id:r.id,group:'Research'}))});
  state=await send({type:'get'});
  assert.ok(state.records.some(r=>r.aiTitle===r.title));
  assert.ok(Buffer.byteLength(JSON.stringify(local.records))<=4*1024*1024);
  assert.deepEqual(state.records,local.records);
  const classified=state.records.filter(r=>r.aiTitle===r.title).map(r=>r.id);
  state=await send({type:'get'});
  assert.deepEqual(state.records.filter(r=>r.aiTitle===r.title).map(r=>r.id),classified);
 }finally{for(const key of Object.keys(local))delete local[key];Object.assign(local,savedLocal);tabs=savedTabs;}
});
test('worker serializes edits, persists state, preserves tabs and enforces privacy',async()=>{
 let state=await send({type:'get'});assert.equal(state.records.length,1);assert.equal(state.tabs.length,2);
 const id=state.records[0].id;
 await Promise.all([send({type:'patch',id,value:{group:'手动工作区'}}),send({type:'rule',value:{keyword:'example',group:'研究'}})]);
 state=await send({type:'get'});assert.equal(state.records[0].group,'手动工作区');assert.equal(state.config.rules.length,1);
 await send({type:'jump',id});assert.equal(created.length,0);assert.deepEqual(updates.at(-1),{id:1,patch:{active:true}});
 tabs=[];await send({type:'get'});await send({type:'jump',id});assert.deepEqual(created.at(-1),{url:'https://example.com/a'});
 await send({type:'key',value:'secret-api-key'});assert.equal(local.apiKeys.deepseek,'secret-api-key');assert.ok(!JSON.stringify(session).includes('secret-api-key'));
 state=await send({type:'get'});assert.equal(state.hasKey,true);assert.ok(!JSON.stringify(state).includes('secret-api-key'));
 await send({type:'settings',value:{...state.config,excluded:['example.com']}});
 state=await send({type:'get'});assert.equal(state.records.length,0);
 await send({type:'assign',assignments:[{id,group:'late AI result'}]});assert.equal((await send({type:'get'})).records.length,0);
 await send({type:'clear'});assert.equal((await send({type:'get'})).config.recording,false);
 tabs=[{id:4,url:'https://newsite.com',title:'New'}];assert.equal((await send({type:'get'})).records.length,0);
});
test('worker ignores messages from webpage contexts',()=>{
 const result=chrome.runtime.onMessage.listeners[0]({type:'getKey'},{id:'test',url:'https://example.com'},()=>assert.fail('must not reply'));
 assert.equal(result,false);
});

test('worker persists rule edits and ordering without changing existing records',async()=>{
 const before=structuredClone(local.records);
 await send({type:'rule',value:{keyword:'video',group:'视频'}});
 let state=await send({type:'get'});
 const original=state.config.rules.find(r=>r.keyword==='video');
 await send({type:'reorderRules',expected:state.config.rules,keyword:original.keyword,target:state.config.rules[0].keyword});
 await send({type:'rule',base:original,value:{keyword:'video',group:'创作'}});
 state=await send({type:'get'});assert.deepEqual(state.config.rules[0],{keyword:'video',group:'创作'});
 await assert.rejects(send({type:'deleteRule',base:original}),/其他窗口/);
 assert.equal((await send({type:'get'})).config.rules.length,2);
 await send({type:'deleteRule',base:state.config.rules[0]});
 assert.deepEqual((await send({type:'get'})).config.rules,[{keyword:'example',group:'研究'}]);
 assert.deepEqual(local.records,before);
});

test('worker isolates provider credentials and remembers each provider model',async()=>{
 await send({type:'key',provider:'openai',value:'openai-test-key'});
 assert.equal(await send({type:'getKey',provider:'deepseek'}),'secret-api-key');
 assert.equal(await send({type:'getKey',provider:'openai'}),'openai-test-key');
 let state=await send({type:'get'});
 await send({type:'settings',value:{...state.config,provider:'openai',model:'gpt-4.1-mini'}});
 state=await send({type:'get'});assert.equal(state.hasKey,true);assert.equal(state.config.providerModels.deepseek,'deepseek-flash');
 await send({type:'key',provider:'openai',value:''});
 assert.equal((await send({type:'get'})).hasKey,false);
 assert.equal(await send({type:'getKey',provider:'deepseek'}),'secret-api-key');
 assert.ok(!JSON.stringify(local).includes('test-key'));
 await assert.rejects(send({type:'key',provider:'unknown',value:'secret'}),/不支持/);
});
test('worker persists rule drag order and workspace order',async()=>{
 await send({type:'rule',value:{keyword:'reading',group:'阅读'}});
 let state=await send({type:'get'});
 await send({type:'reorderRules',expected:state.config.rules,keyword:'reading',target:'example'});
 assert.equal((await send({type:'get'})).config.rules[0].keyword,'reading');
 await send({type:'reorderWorkspaces',source:'研究',target:'阅读'});
 state=await send({type:'get'});assert.deepEqual(state.config.workspaceOrder,['研究','阅读']);
});

test('worker saves workspace migration and rejects late AI assignments after management',async()=>{
 let state=await send({type:'get'});
 await send({type:'workspace',action:'create',name:'空白项目',expectedRevision:state.config.workspaceRevision});
 state=await send({type:'get'});assert.ok(state.config.workspaces.includes('空白项目'));
 await send({type:'workspace',action:'rename',name:'研究',target:'研究资料',expectedRevision:state.config.workspaceRevision});
 state=await send({type:'get'});assert.ok(state.config.rules.some(r=>r.group==='研究资料'));
 assert.equal(await send({type:'assign',assignments:[],workspaceRevision:0}),false);
 await send({type:'workspace',action:'delete',name:'研究资料',target:'待整理',expectedRevision:state.config.workspaceRevision});
 state=await send({type:'get'});assert.ok(!state.config.workspaces.includes('研究资料'));assert.ok(state.config.rules.some(r=>r.group==='待整理'));
});

test('toolbar keeps side panel optional and preferences are opt-in persistent',async()=>{
 assert.deepEqual(panelBehaviors,[{openPanelOnActionClick:false}]);
 assert.equal(chrome.action.onClicked.listeners.length,1);
 await send({type:'preference',value:'按项目分类',save:true});assert.equal(local.config.savedPreference,'按项目分类');
 await send({type:'preference',value:'仅本次偏好',save:false});assert.equal(local.config.savedPreference,'');assert.equal(local.config.savePreference,false);
 assert.ok(!JSON.stringify(local).includes('仅本次偏好'));assert.equal((await send({type:'get'})).preference,'仅本次偏好');
 delete session.classificationPreference;assert.equal((await send({type:'get'})).preference,'');
 await send({type:'preference',value:'保存偏好',save:true});delete session.classificationPreference;assert.equal((await send({type:'get'})).preference,'保存偏好');
});
test('toolbar listener opens and reuses the dashboard without changing saved data',async()=>{
 const saved=structuredClone(local),savedTabs=tabs;
 try{
  tabs=[];const handler=chrome.action.onClicked.listeners[0],before=created.length;
  await Promise.all([handler({windowId:9}),handler({windowId:9})]);
  assert.equal(created.length,before+1);assert.equal(created.at(-1).url,'chrome-extension://test/dashboard.html');
  assert.deepEqual(local,saved);
 }finally{tabs=savedTabs;}
});
test('restore a day deduplicates open URLs, retains groups, and reports retryable failures',async()=>{
 const {dayKey,defaults}=await import('../extension/core.js');const yesterday=dayKey(Date.now()-86400000);
 local.config=defaults();local.records=[
 {id:'old-open',day:yesterday,url:'https://already.test/',domain:'already.test',title:'Existing',group:'研究',snapshotGroup:'昨日项目',status:'待看'},
 {id:'old-closed',day:yesterday,url:'https://restore.test/',domain:'restore.test',title:'Closed',group:'修改后的名称',snapshotGroup:'昨日项目',snapshotStatus:'进行中',status:'待看'},
 {id:'fail',day:yesterday,url:'https://failure.test/',domain:'failure.test',title:'Failure',group:'研究',status:'待看'},
 {id:'bad',day:yesterday,url:'chrome://settings',domain:'settings',title:'Settings',group:'系统',status:'待看'}];
 tabs=[{id:20,windowId:9,url:'https://already.test/',title:'Existing'}];
 const request={type:'restoreDay',day:yesterday,ids:local.records.map(r=>r.id)};
 assert.deepEqual(await send(request),{opened:1,existing:1,failed:1});
 assert.deepEqual(created.at(-1),{url:'https://restore.test/',active:false});
 let state=await send({type:'get'});const restored=state.records.find(r=>r.day===state.today&&r.url==='https://restore.test/');
 assert.equal(restored.group,'昨日项目');assert.equal(Object.hasOwn(restored,'status'),false);assert.equal(restored.manualGroup,true);
 assert.deepEqual(await send(request),{opened:0,existing:2,failed:1});
 // Renaming a different current group must preserve an unrelated snapshot group.
 await send({type:'workspace',action:'rename',name:'修改后的名称',target:'现在的名称',expectedRevision:0});
 state=await send({type:'get'});assert.equal(state.records.find(r=>r.id==='old-closed').snapshotGroup,'昨日项目');
 await send({type:'settings',value:{...state.config,excluded:['restore.test']}});
 assert.ok(!(await send({type:'get'})).records.some(r=>r.url==='https://restore.test/'));
});
test('rule import validates before changing worker storage',async()=>{
 const before=structuredClone(local.config.rules);
 await assert.rejects(send({type:'importRules',backup:{type:'attention-atlas-rules',version:1,rules:[{keyword:'valid',group:'有效'},{keyword:'x',group:'无效'}]}}),/无效规则/);
 assert.deepEqual(local.config.rules,before);
});

test('paused recording still prunes expired records and removes obsolete configuration',async()=>{
 const {defaults,dayKey}=await import('../extension/core.js');
 local.config={...defaults(),recording:false,autoOrganize:false};
 local.records=[{id:'expired',day:'2000-01-01',url:'https://old.test/',group:'旧页面'},{id:'recent',day:dayKey(),url:'https://recent.test/',group:'近期',snapshotGroup:'原工作区',status:'待看',snapshotStatus:'进行中'}];
 const state=await send({type:'get'});
 assert.deepEqual(state.records.map(r=>r.id),['recent']);assert.equal(local.records.length,1);
 assert.equal(Object.hasOwn(local.config,'autoOrganize'),false);assert.equal(state.config.recording,false);
 assert.equal(Object.hasOwn(local.records[0],'status'),false);assert.equal(Object.hasOwn(local.records[0],'snapshotStatus'),false);assert.equal(local.records[0].snapshotGroup,'原工作区');
 await send({type:'patch',id:'recent',value:{status:'已处理'}});assert.equal(Object.hasOwn(local.records[0],'status'),false);
 assert.deepEqual(await send({type:'applyRules',ids:['recent']}),{matched:0});
});
test('Key replacement or forget and restore invalidates pending tab and history AI',async()=>{
 const saved=structuredClone(local),beforeTabs=tabs,oldSession=structuredClone(session);
 try{
  for(const restoreSameKey of [false,true]){
   local.config=defaults();local.lastCleanupAt=Date.now();local.apiKeys={deepseek:'synthetic-old'};
   delete session.classificationPreference;
   tabs=[{id:90,windowId:1,url:'https://race.test/',title:'Race'}];
   const historyDay=dayKey(Date.now()-86400000);
   local.records=[{id:'history',day:historyDay,url:'https://history.test',title:'History',domain:'history.test',group:'待整理',snapshotGroup:'待整理'},
    {id:'human',day:dayKey(),url:'https://human.test',title:'Human',group:'Human',snapshotGroup:'Human',manualGroup:true}];
   tabs.push({id:91,url:'https://human.test',title:'Human'});
   local['pickmark-bookmarks-v1']={metadata:{b1:{url:'https://bookmark.test',group:'Human bookmark',manualGroup:true}},revision:1};
   const state=await send({type:'get'}),r=state.records.find(r=>r.url==='https://race.test/');
   const context=classificationContext(state.config,state.preference);
   const open={type:'assign',expectedContext:context,assignments:[{id:r.id,group:'Old AI',baseTitle:r.title,baseGroup:r.group,baseManual:false}]};
   const history={type:'historyAssign',day:historyDay,expectedContext:context,assignments:[{id:'history',group:'Old AI',baseTitle:'History',baseGroup:'待整理',baseManual:false,baseSnapshot:'待整理'}]};
   if(restoreSameKey)await send({type:'key',provider:'deepseek',value:''});
   await send({type:'key',provider:'deepseek',value:restoreSameKey?'synthetic-old':'synthetic-new'});
   assert.equal(await send(open),false);
   assert.equal((await send(history)).accepted,false);
   assert.equal(local.records.find(row=>row.id===r.id).group,'待整理');
   assert.equal(local.records.find(r=>r.id==='history').group,'待整理');
   assert.equal(local.records.find(r=>r.id==='human').group,'Human');
   assert.equal(local['pickmark-bookmarks-v1'].metadata.b1.group,'Human bookmark');
   const fresh=await send({type:'getHistory'});
   history.expectedContext=classificationContext(fresh.config,fresh.preference);
   assert.equal((await send(history)).applied,1);
  }
 }finally{for(const k of Object.keys(local))delete local[k];Object.assign(local,saved);tabs=beforeTabs;for(const k of Object.keys(session))delete session[k];Object.assign(session,oldSession);}
});
test('worker rejects stale AI results at commit after preferences, pause or open tabs change',async()=>{
 const {defaults,dayKey,classificationContext}=await import('../extension/core.js');
 local.config=defaults();delete session.classificationPreference;
 tabs=[{id:90,windowId:1,url:'https://race.test/',title:'Race'}];local.records=[];
 let state=await send({type:'get'}),r=state.records[0];
 const assignment={id:r.id,group:'AI result',baseTitle:r.title,baseGroup:r.group,baseManual:false};
 const message={type:'assign',assignments:[assignment],expectedContext:classificationContext(state.config,state.preference)};
 await send({type:'preference',value:'新的偏好',save:false});
 assert.equal(await send(message),false);assert.equal(local.records[0].group,'待整理');
 state=await send({type:'get'});message.expectedContext=classificationContext(state.config,state.preference);
 await send({type:'settings',value:{...state.config,recording:false}});
 assert.equal(await send(message),false);assert.equal(local.records[0].group,'待整理');
 await send({type:'settings',value:{...state.config,recording:true}});tabs=[];
 await send(message);assert.equal(local.records[0].group,'待整理');
 tabs=[{id:90,windowId:1,url:r.url,title:r.title}];await send(message);assert.equal(local.records[0].group,'待整理');
 state=await send({type:'get'});message.expectedContext=classificationContext(state.config,state.preference);
 await send(message);assert.equal(local.records[0].group,'AI result');
});

 test('keys survive session reset, migrate old credentials and stay isolated by provider',async()=>{
  await send({type:'key',provider:'deepseek',value:'persistent-test-key'});
  await send({type:'key',provider:'openai',value:'other-test-key'});
  for(const key of Object.keys(session))delete session[key];
  assert.equal(await send({type:'getKey',provider:'deepseek'}),'persistent-test-key');
  assert.equal(await send({type:'getKey',provider:'openai'}),'other-test-key');
  session.apiKey='stale-key';session.apiKeys={anthropic:'migrated-test-key'};
  assert.equal(await send({type:'getKey',provider:'anthropic'}),'migrated-test-key');
  assert.equal(await send({type:'getKey',provider:'deepseek'}),'persistent-test-key');
  assert.equal(session.apiKey,undefined);assert.equal(session.apiKeys,undefined);
  await send({type:'key',provider:'deepseek',value:''});
  session.apiKey='stale-key';
  assert.equal(await send({type:'getKey',provider:'deepseek'}),'');
  assert.equal(await send({type:'getKey',provider:'openai'}),'other-test-key');
  const state=await send({type:'get'});
  assert.ok(!JSON.stringify(state).includes('test-key'));
 });

test('workspace rename and deletion migrate snapshots before restoring historical tabs',async()=>{
 const {defaults,dayKey}=await import('../extension/core.js');
 local.config=defaults();tabs=[];
 const day=dayKey(Date.now()-86400000);
 local.records=[
  {id:'snapshot',day,url:'https://snapshot.test/',domain:'snapshot.test',title:'Snapshot',group:'旧项目',snapshotGroup:'旧项目',status:'已处理',snapshotStatus:'进行中'},
  {id:'different',day,url:'https://different.test/',domain:'different.test',title:'Different',group:'其他项目',snapshotGroup:'旧项目',status:'待看',snapshotStatus:'已处理'}
 ];
 await send({type:'workspace',action:'rename',name:'旧项目',target:'新项目',expectedRevision:0});
 assert.deepEqual(local.records.map(r=>r.snapshotGroup),['新项目','新项目']);
 assert.equal(local.records[1].group,'其他项目');
 await send({type:'workspace',action:'delete',name:'新项目',target:'待整理',expectedRevision:1});
 assert.deepEqual(local.records.map(r=>r.snapshotGroup),['待整理','待整理']);
 assert.equal(local.records[1].group,'其他项目');
 await send({type:'restoreDay',day,ids:['snapshot','different']});
 const today=local.records.filter(r=>r.day===dayKey());
 assert.deepEqual(today.map(r=>r.group),['待整理','待整理']);
 assert.ok(today.every(r=>!Object.hasOwn(r,'status')&&!Object.hasOwn(r,'snapshotStatus')));
 assert.ok(today.every(r=>r.manualGroup));
});

test('title-only tab updates collect new metadata without a dashboard read',async()=>{
 const {defaults}=await import('../extension/core.js');local.config=defaults();local.records=[];
 tabs=[{id:91,windowId:1,url:'https://title.test/',title:'Before'}];
 await send({type:'get'});tabs[0].title='After';
 for(const listener of chrome.tabs.onUpdated.listeners)listener(91,{title:'After'},tabs[0]);
 // A non-collecting request waits for the worker queue without masking a missed event.
 await send({type:'getKey',provider:'deepseek'});
 assert.equal(local.records[0].title,'After');
});

test('worker errors use the requesting panel language without changing record storage',async()=>{
 await assert.rejects(send({type:'patch',id:'not-a-record',value:{},locale:'en'}),/record no longer exists/);
 await assert.rejects(send({type:'patch',id:'not-a-record',value:{},locale:'zh'}),/记录已不存在/);
});

test('stale settings cannot undo pause, exclusion or clear; unrelated rules do not conflict',async()=>{
 local.config=defaults();local.records=[];tabs=[];
 const baseline=settingsSignature(local.config);
 await send({type:'settings',expectedSettings:baseline,value:{...local.config,recording:false,excluded:['private.test']}});
 await assert.rejects(send({type:'settings',expectedSettings:baseline,value:{...defaults(),model:'changed'}}),/其他窗口/);
 assert.equal(local.config.recording,false);assert.deepEqual(local.config.excluded,['private.test']);
 const current=settingsSignature(local.config);
 await send({type:'rule',value:{keyword:'safe',group:'Safe'}});
 await send({type:'settings',expectedSettings:current,value:{...local.config,recording:true}});
 const beforeClear=settingsSignature(local.config);await send({type:'clear'});
 await assert.rejects(send({type:'settings',expectedSettings:beforeClear,value:{...local.config,recording:true}}),/其他窗口/);
 await assert.rejects(send({type:'settings',expectedSettings:undefined,value:defaults()}),/其他窗口/);
 assert.equal(local.config.recording,false);
});
test('review opens retained visits without daily records, reuses tabs and rejects missing or excluded visits',async()=>{
 local.config=defaults();local.records=[];tabs=[];
 const now=Date.now(),visit={visit:'review-visit',day:dayKey(now),url:'https://review.test/',domain:'review.test',start:now-1000,end:now};
 local.visits=[visit];
 const message={type:'jumpVisit',visit:visit.visit,day:visit.day,url:visit.url},before=created.length;
 await send(message);assert.equal(created.length,before+1);
 await send(message);assert.equal(created.length,before+1);assert.equal(updates.at(-1).patch.active,true);
 await assert.rejects(send({...message,url:'https://arbitrary.test/'}),/不存在/);
 local.config.excluded=['review.test'];await assert.rejects(send(message),/不存在/);
 local.config.excluded=[];local.visits=[{...visit,day:'2000-01-01'}];await assert.rejects(send({...message,day:'2000-01-01'}),/不存在/);
 local.visits=[];await assert.rejects(send(message),/不存在/);
});
