import test from 'node:test';import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {flattenBookmarks,classifyBookmarks,handleBookmarks,BOOKMARK_KEY} from '../extension/bookmarks.js';
import {UNGROUPED} from '../extension/core.js';
const tree=[{children:[{id:'folder',title:'Original',children:[{id:'1',url:'https://example.test/a',title:'Alpha',parentId:'folder'},{id:'2',url:'https://example.test/a',title:'Duplicate',parentId:'folder'},{id:'3',url:'javascript:alert(1)',title:'Unsafe'}]}]}];
test('bookmarks preserve duplicate entries and folder paths, reject unsafe URLs and stale metadata',()=>{
 const rows=flattenBookmarks(tree,{'1':{url:'https://other.test',group:'Stale',manualGroup:true}});
 assert.equal(rows.length,2);assert.equal(rows[0].folder,'Original');assert.equal(rows[0].group,UNGROUPED);assert.notEqual(rows[0].id,rows[1].id);
 assert.equal(flattenBookmarks(tree,{},['example.test']).length,0);
});
test('bookmark classification keeps manual and existing classifications',()=>{
 const rows=[{id:'1',title:'Alpha',domain:'example.test',group:UNGROUPED,manualGroup:true},{id:'2',title:'Alpha',domain:'example.test',group:'Existing'},{id:'3',title:'Alpha',domain:'example.test',group:UNGROUPED}];
 const result=classifyBookmarks(rows,[{keyword:'alpha',group:'Matched'}]);assert.equal(result[0].group,UNGROUPED);assert.equal(result[1].group,'Existing');assert.equal(result[2].group,'Matched');
});
test('bookmark access requires permission; writes only independent metadata and rejects stale edits',async()=>{
 let allowed=false,reads=0;const storage={};const api={permissions:{contains:async()=>allowed},bookmarks:{getTree:async()=>{reads++;return structuredClone(tree);}},storage:{local:{get:async()=>storage,getBytesInUse:async keys=>storageBytes(storage,keys),set:async v=>Object.assign(storage,v)}}};
 await assert.rejects(handleBookmarks({type:'bookmarks:get'},api));assert.equal(reads,0);
 allowed=true;await handleBookmarks({type:'bookmarks:patch',expectedRevision:0,id:'1',url:'https://example.test/a',group:'Manual'},api);
 assert.equal(storage[BOOKMARK_KEY].metadata['1'].manualGroup,true);assert.deepEqual(Object.keys(storage),[BOOKMARK_KEY]);
 await assert.rejects(handleBookmarks({type:'bookmarks:patch',expectedRevision:0,id:'1',url:'https://changed.test',group:'Wrong'},api));
 const result=await handleBookmarks({type:'bookmarks:get'},api);assert.equal(result.rows[0].group,'Manual');assert.equal(result.rows[0].folder,'Original');assert.equal(tree[0].children[0].children[0].title,'Alpha');
});
