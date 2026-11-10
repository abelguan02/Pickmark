import test from 'node:test';
import assert from 'node:assert/strict';
import {thumbnailCache} from '../extension/thumbnail-cache.js';
import {THUMBNAIL_KEY,PREVIEW_BYTES,PREVIEW_ITEMS,planPreviewEntries} from '../extension/thumbnail-policy.js';
import {installThumbnailCache} from './thumbnail-fixture.js';

const image='data:image/jpeg;base64,YQ==',replacement='data:image/jpeg;base64,Yg==';
function fixture(legacy={},options){
 const local={config:{excluded:[]},[THUMBNAIL_KEY]:structuredClone(legacy)},events=[],control={removeFailure:null};
 const api={runtime:{sendMessage:async event=>{events.push(event);}},storage:{local:{
  get:async keys=>Object.fromEntries((keys===null?Object.keys(local):Array.isArray(keys)?keys:[keys]).filter(key=>Object.hasOwn(local,key)).map(key=>[key,structuredClone(local[key])])),
  set:async()=>assert.fail('new previews must not write chrome.storage.local'),
  remove:async keys=>{if(control.removeFailure)throw control.removeFailure;for(const key of keys)delete local[key];}
 }}};
 return {api,local,events,control,...installThumbnailCache(api,options)};
}

test('migration atomically stores blobs and preserves the old rollback snapshot without new local writes',async()=>{
 const url='https://page.test/',source='https://source.test/',at=Date.now();
 const f=fixture({[url]:{image,at,sources:[source]},'https://mail.google.com/':{image,at},'https://old.test/':{image,at:at-8*86400000}}),before=structuredClone(f.local);
 assert.equal(await f.cache.get(source),image);assert.deepEqual(f.local,before);
 assert.equal(f.db.state.migrated,true);assert.equal(f.db.state.images.size,1);
 assert.ok(f.db.state.images.get(url) instanceof Blob);assert.equal(f.db.state.images.get(url).size,1);
 await f.cache.put(url,replacement);
 assert.equal(await f.cache.get(source),replacement);assert.equal(f.local[THUMBNAIL_KEY][url].image,image);
 assert.ok(f.events.some(event=>event.type==='preview:cacheChanged'));
});

test('failed migration keeps both the legacy snapshot and the prior database unchanged and can be retried',async()=>{
 const url='https://page.test/',f=fixture({[url]:{image,at:Date.now()}}),beforeLocal=structuredClone(f.local),beforeDB=structuredClone(f.db.state);
 f.db.failure=Error('synthetic migration failure');
 await assert.rejects(f.cache.list(),/synthetic migration failure/);
 assert.deepEqual(f.local,beforeLocal);assert.deepEqual(f.db.state,beforeDB);assert.equal(f.events.length,0);
 f.db.failure=null;
 assert.equal(await f.cache.get(url),image);assert.equal(f.db.state.migrated,true);
 const restarted=thumbnailCache({...f.api},f.db);
 assert.equal(await restarted.get(url),image);assert.deepEqual(f.local,beforeLocal);
});

test('a migration that cannot fit does not block preview counting or explicit cache clearing',async()=>{
 const url='https://page.test/',f=fixture({[url]:{image,at:Date.now()}});
 f.db.beforeWrite=async patch=>{if(patch.put.some(item=>item.image))throw new DOMException('Preview images cannot fit','QuotaExceededError');};
 await assert.rejects(f.cache.list(),error=>error.code==='STORAGE_CAPACITY');
 assert.equal(f.db.state.migrated,false);assert.ok(f.local[THUMBNAIL_KEY][url]);
 assert.equal(await f.cache.countForClear(),1);
 await f.cache.clear();
 assert.equal(f.local[THUMBNAIL_KEY],undefined);assert.equal(f.db.state.entries.size,0);assert.equal(f.db.state.images.size,0);assert.equal(f.db.state.migrated,true);
 assert.equal(await thumbnailCache({...f.api},f.db).get(url),null);
});

test('cleanup counting deduplicates old and new URLs without migrating or reading blobs',async()=>{
 const at=Date.now(),first='https://first.test/',second='https://second.test/',third='https://third.test/';
 const f=fixture({[first]:{image,at},[second]:{image,at}},{entries:[first,third].map(url=>({url,at,sources:[],imageBytes:1,bytes:100}))});
 f.db.beforeWrite=async()=>assert.fail('counting must not write');f.db.images=async()=>assert.fail('counting must not read image blobs');
 assert.equal(await f.cache.countForClear(),3);assert.equal(f.db.state.migrated,false);
});

test('migration never overwrites a newer image already committed before an interrupted migration',async()=>{
 const url='https://page.test/',now=Date.now(),f=fixture({[url]:{image,at:now-1000}},{migrated:true});
 await f.cache.put(url,replacement,{at:now});f.db.state.migrated=false;
 const restarted=thumbnailCache({...f.api},f.db);
 assert.equal(await restarted.get(url),replacement);assert.equal(f.db.state.entries.get(url).at,now);assert.equal(f.db.state.migrated,true);
});

test('clear removes both stores and prevents legacy resurrection after restart even if old-snapshot removal fails',async()=>{
 const url='https://page.test/',f=fixture({[url]:{image,at:Date.now()}});
 assert.equal(await f.cache.get(url),image);
 f.control.removeFailure=Error('synthetic local removal failure');
 await assert.rejects(f.cache.clear(),/local removal failure/);
 assert.equal(f.db.state.entries.size,0);assert.equal(f.db.state.images.size,0);assert.equal(f.db.state.migrated,true);
 assert.ok(f.local[THUMBNAIL_KEY][url]);
 const restarted=thumbnailCache({...f.api},f.db);
 assert.equal(await restarted.get(url),null);
 f.control.removeFailure=null;await restarted.clear();
 assert.equal(f.local[THUMBNAIL_KEY],undefined);assert.equal(await thumbnailCache({...f.api},f.db).get(url),null);
});

test('clear waits for an earlier pending transaction and no late image survives restart',async()=>{
 const url='https://page.test/',f=fixture({}, {migrated:true});let release,started;
 const gate=new Promise(resolve=>release=resolve),writing=new Promise(resolve=>started=resolve);
 f.db.beforeWrite=async patch=>{if(patch.put.length){started();await gate;}};
 const capture=f.cache.put(url,image);await writing;
 const clear=f.cache.clear();release();await Promise.all([capture,clear]);
 assert.equal(f.db.state.entries.size,0);assert.equal(f.db.state.images.size,0);
 assert.equal(await thumbnailCache({...f.api},f.db).get(url),null);
});

test('metadata usage and lookup only read image blobs for the requested target URLs',async()=>{
 const f=fixture({}, {migrated:true}),first='https://first.test/',second='https://second.test/',alias='https://alias.test/';
 await f.cache.put(first,image,{sources:[alias]});await f.cache.put(second,replacement);
 const requests=[],readImages=f.db.images;f.db.images=async urls=>{requests.push(urls);return readImages(urls);};
 const list=await f.cache.list(),usage=await f.cache.usage();
 assert.equal(list[first].image,undefined);assert.deepEqual(requests,[]);
 assert.equal(usage.maxBytes,50_000_000);assert.equal(usage.maxItems,500);assert.equal(usage.count,2);
 const entry=f.db.state.entries.get(first),{bytes,...metadata}=entry;
 assert.equal(bytes,f.db.state.images.get(first).size+Buffer.byteLength(JSON.stringify(metadata)));
 assert.equal(usage.bytes,[...f.db.state.entries.values()].reduce((sum,entry)=>sum+entry.bytes,0));
 assert.deepEqual(await f.cache.lookup([first,alias,'https://missing.test/']),{[first]:image,[alias]:image});
 assert.deepEqual(requests,[[first]]);
});

test('expiry and exclusion pruning deletes image blobs and reaccounts filtered redirect metadata',async()=>{
 const f=fixture({}, {migrated:true}),url='https://keep.test/',excluded='excluded.test';
 await f.cache.put(url,image,{sources:['https://excluded.test/start','https://alias.test/']});
 await f.cache.put('https://old.test/',image,{at:Date.now()-8*86400000});
 await f.cache.put('https://excluded.test/',image);
 const usage=await f.cache.usage([excluded]),entry=f.db.state.entries.get(url);
 assert.deepEqual([...f.db.state.images.keys()],[url]);assert.equal(usage.count,1);
 assert.deepEqual(entry.sources,['https://alias.test/']);
 const {bytes,...metadata}=entry;assert.equal(bytes,1+Buffer.byteLength(JSON.stringify(metadata)));assert.equal(usage.bytes,bytes);
});

test('the 50 MB and 500 image policy preserves current-list images and rejects an oversized incoming image',()=>{
 const at=Date.now(),row=(url,bytes,age=0)=>({url,at:at-age,sources:[],imageBytes:bytes-100,bytes});
 const old=row('https://kept.test/',PREVIEW_BYTES-100,1),incoming=row('https://new.test/',100);
 assert.equal(planPreviewEntries([old],incoming).reduce((sum,entry)=>sum+entry.bytes,0),50_000_000);
 assert.deepEqual(planPreviewEntries([old],{...incoming,bytes:101}).map(entry=>entry.url),[incoming.url]);
 assert.throws(()=>planPreviewEntries([old],{...incoming,bytes:101},{preserveUrls:[old.url]}),error=>error.code==='PREVIEW_LIMIT');
 assert.throws(()=>planPreviewEntries([],{...incoming,bytes:PREVIEW_BYTES+1}),error=>error.code==='CAPTURE_TOO_LARGE');
 const entries=Array.from({length:PREVIEW_ITEMS},(_,i)=>row('https://saved.test/'+i,200,i+1));
 const kept=planPreviewEntries(entries,incoming);assert.equal(kept.length,500);assert.ok(kept.some(entry=>entry.url===incoming.url));assert.ok(!kept.some(entry=>entry.url===entries.at(-1).url));
 assert.throws(()=>planPreviewEntries(entries,incoming,{preserveUrls:entries.map(entry=>entry.url)}),error=>error.code==='PREVIEW_LIMIT');
});
