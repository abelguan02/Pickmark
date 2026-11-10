import test from 'node:test';
import assert from 'node:assert/strict';
import {recordsChanged,withTabTargets} from '../extension/dashboard-sync.js';
test('cross-panel refresh ignores collection timestamps but keeps user and AI changes',()=>{
 const oldValue=[{id:'a',title:'Page',group:'研究',lastSeen:1}];
 assert.equal(recordsChanged({oldValue,newValue:[{...oldValue[0],lastSeen:2}]}),false);
 for(const patch of [{group:'学习'},{title:'New'},{aiTitle:'Page'},{manualGroup:true},{activations:1},{snapshotGroup:'旧项目'}])
  assert.equal(recordsChanged({oldValue,newValue:[{...oldValue[0],...patch}]}),true);
 assert.equal(recordsChanged({oldValue,newValue:[]}),true);
 assert.equal(recordsChanged({newValue:oldValue}),true);
});
test('rendered rows retain a concrete tab target matching the collected title',()=>{
 const records=[{id:'record',url:'https://same.test/',title:'Second'}];
 const tabs=[{id:1,url:records[0].url,title:'First'},{id:2,url:records[0].url,title:'Second'},{id:3,url:records[0].url,title:''},{id:4,url:records[0].url,title:'Private',incognito:true}];
 const rows=withTabTargets(records,tabs);
 assert.equal(rows[0].tabId,2);tabs.splice(1,1);
 assert.equal(rows[0].tabId,2);assert.equal(withTabTargets(records,tabs)[0].tabId,1);
 assert.equal(Object.hasOwn(records[0],'tabId'),false);
});
