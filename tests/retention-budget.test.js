import test from 'node:test';
import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {retainRecords,defaults,dayKey} from '../extension/core.js';
import {writeLocal} from '../extension/storage-budget.js';

test('long classified titles stay within the page budget and preserve newest records',()=>{
 const title='研究😀'.repeat(400),day=dayKey();
 const records=Array.from({length:5000},(_,i)=>({id:String(i),day,url:`https://example.com/${i}`,title,aiTitle:title,group:'Research'}));
 const kept=retainRecords(records,defaults());
 assert.ok(Buffer.byteLength(JSON.stringify(kept))<=4*1024*1024);
 assert.equal(kept.at(-1).id,'4999');
 assert.ok(kept.length>0&&kept.length<records.length);
 assert.equal(kept.at(-1).aiTitle,kept.at(-1).title);
});

test('one oversized URL cannot discard all other retained pages',()=>{
 const day=dayKey(),small={id:'small',day,url:'https://example.com/',title:'Keep me'};
 const kept=retainRecords([small,{...small,id:'oversized',url:'https://example.com/'+ 'x'.repeat(5*1024*1024)}],defaults());
 assert.deepEqual(kept.map(r=>r.id),['small']);
});

test('every write budgets page history and preserves unrelated local data',async()=>{
 const page=i=>({id:i,title:'😀'.repeat(500),aiTitle:'😀'.repeat(500)});
 const data={records:Array.from({length:1500},(_,i)=>page(i)),apiKeys:{deepseek:'test-key'},config:{savedPreference:'x'.repeat(3*1024*1024)}};
 let writes=0;
 globalThis.chrome={storage:{local:{async get(){return structuredClone(data);},async getBytesInUse(keys){return storageBytes(data,keys);},async set(patch){
  const merged={...data,...patch};
  assert.ok(Object.entries(merged).reduce((sum,[key,value])=>sum+Buffer.byteLength(key)+Buffer.byteLength(JSON.stringify(value)),0)<10*1024*1024);
  Object.assign(data,structuredClone(patch));writes++;
 }}}};
 const result=await writeLocal({lastCleanupAt:123});
 assert.equal(writes,1);assert.equal(data.apiKeys.deepseek,'test-key');
 assert.equal(data.config.savedPreference.length,3*1024*1024);
 assert.equal(data.records.at(-1).id,1499);
 assert.ok(data.records.length<1500);
 assert.equal(result.lastCleanupAt,123);
});
