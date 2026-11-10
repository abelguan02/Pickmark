import test from 'node:test';import assert from 'node:assert/strict';
import {storageBytes} from './storage-fixture.js';
import {installThumbnailCache} from './thumbnail-fixture.js';
import {retainThumbnails,handleThumbnail,THUMBNAIL_KEY} from '../extension/thumbnails.js';
test('batch capture preserves current-list images instead of evicting earlier results at capacity',async()=>{
 const local={},urls=Array.from({length:500},(_,i)=>'https://saved.test/'+i);
 const tab={id:2,windowId:2,active:true,url:'https://new.test/'};
 const api={storage:{local:{get:async()=>structuredClone(local),set:async()=>assert.fail('capacity failure must not write')}},tabs:{query:async()=>[tab],get:async()=>tab,captureVisibleTab:async()=> 'data:image/jpeg;base64,YQ=='}};
 const {db,cache}=installThumbnailCache(api,{migrated:true});
 for(const [i,url] of urls.entries())await cache.put(url,'data:image/jpeg;base64,YQ==',{at:Date.now()-i-1000});
 const before=structuredClone(db.state);
 await assert.rejects(handleThumbnail({type:'thumbnail:capture',url:tab.url},api,{excluded:[]},{targetTab:tab,preserveUrls:urls}),e=>e.code==='PREVIEW_LIMIT');
 assert.equal(db.state.images.size,500);assert.deepEqual(db.state,before);assert.equal(local[THUMBNAIL_KEY],undefined);
});
test('capture retains readable resolution and quality while bounding pixel size and releasing bitmap',async t=>{
 let dimensions,quality,captureQuality,closed=false;
 const before={bitmap:globalThis.createImageBitmap,canvas:globalThis.OffscreenCanvas};
 t.after(()=>{if(before.bitmap)globalThis.createImageBitmap=before.bitmap;else delete globalThis.createImageBitmap;if(before.canvas)globalThis.OffscreenCanvas=before.canvas;else delete globalThis.OffscreenCanvas;});
 globalThis.createImageBitmap=async()=>({width:2880,height:1800,close(){closed=true;}});
 globalThis.OffscreenCanvas=class {constructor(w,h){dimensions=[w,h];this.width=w;this.height=h;}getContext(){return {drawImage(){}};}async convertToBlob(options){quality=options.quality;return new Blob(['mock']);}};
 const tab={id:1,windowId:1,active:true,url:'https://page.test/'};
 const api={storage:{local:{get:async()=>({}),getBytesInUse:async keys=>storageBytes({},keys),set:async()=>{}}},tabs:{query:async()=>[tab],get:async()=>tab,captureVisibleTab:async(id,options)=>{captureQuality=options.quality;return 'data:image/jpeg;base64,YQ==';}}};
 installThumbnailCache(api,{migrated:true});
 await handleThumbnail({type:'thumbnail:capture',url:tab.url},api,{excluded:[]});
 assert.deepEqual(dimensions,[1200,750]);assert.ok(captureQuality>=80);assert.ok(quality>=0.8);assert.equal(closed,true);
});
test('legacy rollback snapshots retain the previous total byte budget',()=>{
 const cache=Object.fromEntries(Array.from({length:100},(_,i)=>['https://page.test/'+i,{at:Date.now()-i,image:'data:image/jpeg;base64,'+'YQ=='.repeat(25000)}]));
 const result=retainThumbnails(cache);assert.ok(Object.keys(result).length<100);assert.ok(Object.entries(result).reduce((n,[url,v])=>n+url.length+v.image.length,0)<=1_500_000);assert.ok(result['https://page.test/0']);
});
test('legacy snapshot retention excludes private domains, old and unsafe data and bounds cache',()=>{
 const now=Date.now(),v={at:now,image:'data:image/jpeg;base64,YQ=='};
 const cache={'https://excluded.test':v,'https://old.test':{...v,at:0},'javascript:alert(1)':v,'https://bad.test':{...v,image:'https://external.test/pixel'}};
 for(let i=0;i<150;i++)cache['https://test'+i+'.test']=v;
 const result=retainThumbnails(cache,['excluded.test'],now);assert.equal(Object.keys(result).length,100);assert.ok(!result['https://excluded.test']);assert.ok(!result['https://old.test']);assert.ok(!result['https://bad.test']);
});
test('preview lookup hydrates gallery without capturing or opening pages',async()=>{
 const image='data:image/jpeg;base64,YQ==',url='https://page.test/';
 const local={[THUMBNAIL_KEY]:{[url]:{image,at:Date.now()}}};
 const api={storage:{local:{get:async()=>local,getBytesInUse:async keys=>storageBytes(local,keys),set:async v=>Object.assign(local,v)}},tabs:{query:async()=>[],captureVisibleTab:()=>assert.fail('lookup must not capture')}};
 installThumbnailCache(api);
 assert.deepEqual(await handleThumbnail({type:'thumbnail:lookup',urls:[url,'https://unknown.test/']},api,{excluded:[]}),{[url]:image});
});
test('redirect metadata expires with the image, filters excluded sources and preserves exact URL distinctions',async()=>{
 const now=Date.now(),target='https://final.test/page',image='data:image/jpeg;base64,YQ==';
 const cache={[target]:{at:now,image,sources:['https://original.test/','https://mail.google.com/mail/','https://excluded.test/','not a url']}};
 const kept=retainThumbnails(cache,['excluded.test'],now);
 assert.deepEqual(kept[target].sources,['https://original.test/']);
 assert.deepEqual(retainThumbnails(cache,[],now+8*86400000),{});
 assert.deepEqual(retainThumbnails(cache,['final.test'],now),{});
 const api={storage:{local:{get:async()=>({[THUMBNAIL_KEY]:kept}),getBytesInUse:async keys=>storageBytes({[THUMBNAIL_KEY]:kept},keys)}}};
 installThumbnailCache(api);
 assert.equal(await handleThumbnail({type:'thumbnail:get',url:'https://original.test'},api,{excluded:[]}),image);
 assert.equal(await handleThumbnail({type:'thumbnail:get',url:'https://original.test/?other=1'},api,{excluded:[]}),null);
 assert.equal(await handleThumbnail({type:'thumbnail:get',url:'http://original.test/'},api,{excluded:[]}),null);
});
test('manual capture detects tab switches and returns actionable permission errors',async()=>{
 const tab={id:1,windowId:1,active:true,url:'https://page.test/'};
 const api={storage:{local:{get:async()=>({}),getBytesInUse:async keys=>storageBytes({},keys),set:async()=>assert.fail('must not save a wrong page')}},tabs:{query:async()=>[tab],get:async()=>({...tab,active:false}),captureVisibleTab:async()=> 'data:image/jpeg;base64,YQ=='}};
 const {db}=installThumbnailCache(api,{migrated:true});
 await assert.rejects(handleThumbnail({type:'thumbnail:capture',url:tab.url},api,{excluded:[]}),/变化/);
 api.tabs.captureVisibleTab=async()=>{throw Error('Either the all_urls or activeTab permission is required.');};
 await assert.rejects(handleThumbnail({type:'thumbnail:capture',url:tab.url},api,{excluded:[]}),/工具栏|授权/);
 assert.equal(db.state.images.size,0);
});
test('thumbnail capture is explicit, only current visible non-incognito page and never opens tabs',async()=>{
 let captures=0;const local={};let tab={id:1,windowId:1,active:true,incognito:false,url:'https://page.test/'};
 const api={storage:{local:{get:async()=>local,getBytesInUse:async keys=>storageBytes(local,keys),set:async v=>Object.assign(local,v)}},tabs:{query:async()=>[tab],get:async()=>tab,captureVisibleTab:async()=>{captures++;return 'data:image/jpeg;base64,YQ==';}}};
 const {db,cache}=installThumbnailCache(api,{migrated:true});
 assert.equal(await handleThumbnail({type:'thumbnail:get',url:tab.url},api,{excluded:[]}),null);assert.equal(captures,0);
 await assert.rejects(handleThumbnail({type:'thumbnail:capture',url:'https://other.test/'},api,{excluded:[]}));assert.equal(captures,0);
 tab.incognito=true;await assert.rejects(handleThumbnail({type:'thumbnail:capture',url:tab.url},api,{excluded:[]}));tab.incognito=false;
 const image=await handleThumbnail({type:'thumbnail:capture',url:tab.url},api,{excluded:[]});assert.equal(captures,1);assert.equal(await cache.get(tab.url),image);
 assert.equal(db.state.images.get(tab.url).type,'image/jpeg');assert.equal(local[THUMBNAIL_KEY],undefined);
});
