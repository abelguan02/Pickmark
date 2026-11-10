import test from 'node:test';
import assert from 'node:assert/strict';
import {writeLocal,jsonBytes} from '../extension/storage-budget.js';
import {retainRecords,defaults,dayKey} from '../extension/core.js';
const localBudget=10*1024*1024-128*1024;
const storageBytes=data=>Object.entries(data).reduce((sum,[key,value])=>sum+Buffer.byteLength(key)+jsonBytes(value),0);
function fixture(){
 const manual={id:'manual',url:'https://open.test',day:'2020-01-01',title:'Human',group:'Human',manualGroup:true};
 const data={config:defaults(),records:[manual,...Array.from({length:3000},(_,i)=>({id:'h'+i,url:'https://closed.test/'+i,day:dayKey(),title:'x'.repeat(1500)}))],bookmarks:{saved:true},padding:'x'.repeat(5*1024*1024)};
 const selected=keys=>Object.fromEntries((keys===null?Object.keys(data):Array.isArray(keys)?keys:[keys]).filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]]));
 const api={tabs:{query:async()=>[{url:manual.url}]},storage:{local:{get:async keys=>structuredClone(selected(keys)),getBytesInUse:async keys=>storageBytes(selected(keys)),set:async patch=>Object.assign(data,structuredClone(patch))}}};
 return {manual,data,api};
}
test('all write payloads protect open manual state before maintenance',async()=>{
 for(const type of ['records','config','bookmark','thumbnail','keys']){
  const {manual,data,api}=fixture();const patches={records:{records:data.records},config:{config:{...data.config,retentionDays:7}},bookmark:{bookmarks:{saved:'updated'}},thumbnail:{thumbnails:{cached:true}},keys:{apiKeys:{deepseek:'fake'}}};
  await writeLocal(patches[type],api);assert.deepEqual(data.records.find(r=>r.id===manual.id),manual,type);assert.ok(data.records.length<3001,type);assert.ok(jsonBytes(data)<10*1024*1024,type);assert.ok(data.config.historyRevision>0,type);
 }
});
test('protected state may borrow the history budget and never gets silently truncated',async()=>{
 const {manual,data,api}=fixture();data.records=[{...manual,title:'x'.repeat(2800000)}];await writeLocal({trackingSince:1},api);assert.equal(data.records[0].title.length,2800000);
 data.padding='x'.repeat(9*1024*1024);const before=structuredClone(data);await assert.rejects(writeLocal({trackingSince:2},api),/空间不足/);assert.deepEqual(data,before);
});
test('upstream retention does not silently discard oversized current manual state',()=>{
 const manual={id:'manual',url:'https://open.test',day:dayKey(),manualGroup:true,title:'x'.repeat(5*1024*1024)};
 assert.deepEqual(retainRecords([manual],defaults()),[manual]);
});
test('explicit record deletion cannot recover old manual rows; revisions stay monotonic',async()=>{
 const {data,api}=fixture();data.config.historyRevision=5;await writeLocal({records:[],config:{...data.config,historyRevision:1}},api);assert.deepEqual(data.records,[]);assert.equal(data.config.historyRevision,5);assert.deepEqual(data.bookmarks,{saved:true});
});
test('storage backend failure leaves classifications and bookmarks unchanged',async()=>{
 const {data,api}=fixture(),before=structuredClone(data);
 api.storage.local.set=async()=>{throw Error('QUOTA_BYTES quota exceeded');};
 await assert.rejects(writeLocal({bookmarks:{saved:'replacement'}},api),/QUOTA_BYTES/);
 assert.deepEqual(data,before);
});
test('supplied histories are not reread and unrelated stored values are never fetched',async()=>{
 const {manual,data,api}=fixture(),get=api.storage.local.get,reads=[];
 data.thumbnails={image:'x'.repeat(1024*1024)};data.apiKeys={deepseek:'fake'};
 api.storage.local.get=async keys=>{reads.push(keys);assert.notEqual(keys,null);assert.ok(keys.every(key=>key==='config'));return get(keys);};
 const patch=await writeLocal({records:[manual]},api);
 assert.deepEqual(reads,[['config']]);assert.deepEqual(patch,{records:[manual]});
 assert.equal(data.thumbnails.image.length,1024*1024);assert.deepEqual(data.apiKeys,{deepseek:'fake'});
});
test('only missing histories and configuration are read when replacing a large non-history key',async()=>{
 const {manual,data,api}=fixture(),get=api.storage.local.get,reads=[];
 data.records=[manual];data.padding='x'.repeat(7*1024*1024);
 api.storage.local.get=async keys=>{reads.push(keys);assert.notEqual(keys,null);assert.ok(keys.every(key=>['config','records'].includes(key)));return get(keys);};
 const padding='y'.repeat(8*1024*1024),patch=await writeLocal({padding},api);
 assert.deepEqual(new Set(reads.flat()),new Set(['config','records']));
 assert.deepEqual(patch,{padding});assert.deepEqual(data.records,[manual]);
 assert.ok(storageBytes(data)<localBudget);
});
test('an oversized non-history payload is rejected before any storage mutation',async()=>{
 const {data,api}=fixture();data.records=[];data.visits=[];
 const before=structuredClone(data);let writes=0;
 api.storage.local.set=async()=>{writes++;};
 await assert.rejects(writeLocal({padding:'x'.repeat(10*1024*1024)},api),error=>error.code==='STORAGE_CAPACITY');
 assert.equal(writes,0);assert.deepEqual(data,before);
});
test('adding a history revision is included before fitting the final page history',async()=>{
 const {manual,data,api}=fixture();
 data.records=[manual,{id:'disposable',url:'https://closed.test',day:dayKey(),title:'x'.repeat(1000)}];
 data.padding='';
 data.padding='x'.repeat(localBudget-storageBytes({...data,records:[manual]})-32);
 const patch=await writeLocal({records:data.records},api);
 assert.deepEqual(data.records,[manual]);
 assert.equal(data.config.historyRevision,1);assert.ok(storageBytes(data)<=localBudget);
 assert.deepEqual(patch.records,data.records);
});
test('a revision digit increase cannot overrun the budget protecting manual rows',async()=>{
 const {manual,data,api}=fixture();data.config={historyRevision:9};
 data.records=[manual,{id:'disposable',url:'https://closed.test',day:dayKey()}];data.visits=[];data.padding='';
 data.padding='x'.repeat(localBudget-storageBytes({...data,records:[manual]}));
 const before=structuredClone(data);let writes=0;
 api.storage.local.set=async()=>{writes++;};
 await assert.rejects(writeLocal({records:data.records},api),error=>error.code==='STORAGE_CAPACITY');
 assert.equal(writes,0);assert.deepEqual(data,before);
});
