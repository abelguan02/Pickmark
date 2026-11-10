import test from 'node:test';
import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {bookmarkAIService} from '../extension/bookmark-ai.js';
import {organizeBookmarksAI} from '../extension/bookmark-ai-workflow.js';
import {BOOKMARK_KEY,handleBookmarks} from '../extension/bookmarks.js';
function fixture(count=2,organize){
 const children=Array.from({length:count+2},(_,i)=>({id:String(i),title:'Test '+i,url:'https://example.test/'+i}));
 const store={[BOOKMARK_KEY]:{metadata:{[count]:{url:children[count].url,group:'Saved'},[count+1]:{url:children[count+1].url,group:'待整理',manualGroup:true}},rules:[],revision:0},records:[{group:'History'}]};
 const api={permissions:{contains:async()=>true},bookmarks:{getTree:async()=>[{children}]},storage:{local:{get:async()=>structuredClone(store),getBytesInUse:async keys=>storageBytes(store,keys),set:async v=>Object.assign(store,v)}}};
 const config={provider:'deepseek',model:'test',excluded:[]};
 let calls=[];const service=bookmarkAIService({api,readConfig:async()=>structuredClone(config),readKeys:async()=>({deepseek:'fake'}),serial:fn=>fn(),organize:async(...args)=>{calls.push(args);return organize?organize(...args):{assignments:args[0].map(r=>({id:r.id,group:'AI'}))};}});
 const send=async m=>{const result=await service(m);return result.pending??result;};
 const prepare=()=>send({type:'bookAI:prepare',ids:children.map(r=>r.id)});
 const run=async()=>organizeBookmarksAI({send,prepared:await prepare(),token:'test'});
 return {api,store,children,calls,send,prepare,run,config};
}
test('confirmation is read-only; batches preserve existing/manual and history',async()=>{
 const f=fixture(201),prepared=await f.prepare();assert.equal(f.calls.length,0);assert.equal(prepared.ai,201);assert.equal(prepared.preview.length,50);assert.equal(prepared.protected,2);
 assert.equal((await f.run()).applied,201);assert.deepEqual(f.calls.map(c=>c[0].length),[200,1]);assert.deepEqual(f.calls[0][8],{pending:[],workspaces:[]});
 assert.equal(f.store[BOOKMARK_KEY].metadata['201'].group,'Saved');assert.equal(f.store[BOOKMARK_KEY].metadata['202'].manualGroup,true);assert.deepEqual(f.store.records,[{group:'History'}]);
});
test('local rules are applied before AI and omitted from AI candidates',async()=>{
 const f=fixture();f.store[BOOKMARK_KEY].rules=[{keyword:'test 0',group:'Local'}];assert.equal((await f.prepare()).local,1);await f.run();assert.deepEqual(f.calls[0][0].map(r=>r.id),['1']);
});
test('changed confirmation is rejected before sending',async()=>{
 const f=fixture(),prepared=await f.prepare();f.children[0].title='Changed';await assert.rejects(organizeBookmarksAI({send:f.send,prepared,token:'t'}));assert.equal(f.calls.length,0);
});
test('manual changes during a slow response reject stale AI results',async()=>{
 let resolve;const f=fixture(1,()=>new Promise(r=>resolve=r));const task=f.run();while(!resolve)await new Promise(r=>setImmediate(r));
 await handleBookmarks({type:'bookmarks:patch',expectedRevision:1,id:'0',url:f.children[0].url,group:'Human'},f.api);resolve({assignments:[{id:'0',group:'AI'}]});await assert.rejects(task);assert.equal(f.store[BOOKMARK_KEY].metadata['0'].group,'Human');
});
test('cancelled late response cannot commit; fresh retry succeeds',async()=>{
 let resolve,first=true;const f=fixture(1,rows=>first?new Promise(r=>resolve=r):{assignments:rows.map(r=>({id:r.id,group:'Retried'}))});
 const task=f.run();while(!resolve)await new Promise(r=>setImmediate(r));await f.send({type:'bookAI:cancel',token:'test'});resolve({assignments:[{id:'0',group:'Late'}]});await assert.rejects(task);assert.equal(f.store[BOOKMARK_KEY].metadata['0'],undefined);first=false;assert.equal((await f.run()).applied,1);
});
test('forget and restore of the same Key invalidates confirmation and slow bookmark AI',async()=>{
 const before=fixture(1),prepared=await before.prepare();before.config.settingsRevision=2;
 await assert.rejects(organizeBookmarksAI({send:before.send,prepared,token:'stale'}),/变化|changed/);
 assert.equal(before.calls.length,0);
 let resolve;const f=fixture(1,()=>new Promise(r=>resolve=r));const task=f.run();
 while(!resolve)await new Promise(r=>setImmediate(r));
 f.config.settingsRevision=2;resolve({assignments:[{id:'0',group:'Stale'}]});
 await assert.rejects(task,/变化|changed/);assert.equal(f.store[BOOKMARK_KEY].metadata['0'],undefined);
 assert.equal(f.store[BOOKMARK_KEY].metadata['2'].manualGroup,true);
});
