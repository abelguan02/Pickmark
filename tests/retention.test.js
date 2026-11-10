import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,dayKey,retainRecords,classificationContext} from '../extension/core.js';
import {cleanupSnapshot} from '../extension/cleanup.js';
const now=new Date(2026,9,14,12).getTime();
const row=(age,id='r'+age)=>({id,day:dayKey(new Date(2026,9,14-age,12)),url:'https://test.example/'+id,title:id,group:'Human',manualGroup:true});
test('retention uses calendar days and defaults to 30 with exact inclusive boundary',()=>{
 for(const days of [7,14,30]){const config={...defaults(),retentionDays:days};const records=[row(days),row(days-1)];assert.deepEqual(retainRecords(records,config,now).map(r=>r.id),['r'+(days-1)]);}
 assert.equal(defaults().retentionDays,30);
});
test('cleanup carries open manual state before removing old history and never touches bookmarks',()=>{
 const old=row(100),closed=row(80),book={metadata:{saved:true}};const source={config:defaults(),records:[old,closed],visits:[old,closed],bookmarks:book};
 const patch=cleanupSnapshot(source,[{url:old.url}],{now,mode:'all'});assert.equal(patch.records.length,1);assert.equal(patch.records[0].group,'Human');assert.equal(patch.records[0].manualGroup,true);assert.equal(patch.records[0].day,dayKey(now));assert.notEqual(patch.records[0].id,old.id);assert.equal(patch.bookmarks,undefined);assert.deepEqual(source.bookmarks,book);assert.equal(patch.config.recording,true);assert.notEqual(classificationContext(patch.config),classificationContext(source.config));
});
test('7-day manual cleanup keeps recent closed history and protected current tabs',()=>{
 const source={config:defaults(),records:[row(20),row(6),row(0)],visits:[row(20),row(6)]};const p=cleanupSnapshot(source,[],{now,mode:'old',days:7});assert.deepEqual(p.records.map(r=>r.id),['r6','r0']);
});
test('maintenance handles paused recording without adding unknown tabs',()=>{
 const source={config:{...defaults(),recording:false,retentionDays:7},records:[row(80)],visits:[]};const p=cleanupSnapshot(source,[{url:row(80).url},{url:'https://unknown.example'}],{now});assert.equal(p.records.length,1);assert.equal(p.config.recording,false);
});
test('manual current classification survives the historical count budget',()=>{
 const current=row(0,'human'),history=Array.from({length:10000},(_,i)=>({...row(1,String(i)),manualGroup:false}));
 const kept=retainRecords([current,...history],defaults(),now);assert.equal(kept.length,5000);assert.ok(kept.some(r=>r.id==='human'&&r.manualGroup));
});
