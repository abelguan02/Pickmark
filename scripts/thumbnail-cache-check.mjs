// Native IndexedDB checks in a disposable, headless extension profile.
// All images, URLs, records and keys below are synthetic; no personal data is read.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pickmark-cache-check-'));
const extension=path.join(temp,'extension');
await fs.cp(path.resolve('extension'),extension,{recursive:true});
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Pickmark cache fixture',version:'1.0',default_locale:'zh_CN',permissions:['storage'],background:{service_worker:'cache-fixture.js',type:'module'}}));
await fs.writeFile(path.join(extension,'cache-fixture.js'),"import * as cacheModule from './thumbnail-cache.js';globalThis.cacheModule=cacheModule;chrome.runtime.onInstalled.addListener(()=>{});");
await fs.writeFile(path.join(extension,'cache-fixture.html'),'<!doctype html><title>Local cache fixture</title>');
let context,worker;
async function check(label,fn,timeout=45000){
 let timer;
 try{
  await Promise.race([worker.evaluate(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),timeout);})]);
  console.log('PASS '+label);
 }finally{clearTimeout(timer);}
}
try{
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{
  ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),
  headless:true,ignoreDefaultArgs:['--disable-extensions'],
  args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]
 });
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 await worker.evaluate(async()=>{
  globalThis.expect=(condition,message)=>{if(!condition)throw Error(message);};
  globalThis.same=(a,b,message)=>{
   const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
   expect(JSON.stringify(ordered(a))===JSON.stringify(ordered(b)),message);
  };
  globalThis.makeImage=size=>'data:image/jpeg;base64,'+btoa('x'.repeat(size));
  globalThis.legacyKey='pickmark-thumbnails-v1';
  globalThis.now=Date.now();
  globalThis.smallImage=makeImage(1000);
  globalThis.legacy={
   'https://legacy.test/one':{image:smallImage,at:now-10,sources:['https://legacy-source.test/']},
   'https://legacy.test/two':{image:smallImage,at:now-20},
   'https://expired.test/':{image:smallImage,at:now-8*86400000},
   'https://mail.google.com/':{image:smallImage,at:now}
  };
  globalThis.otherData={config:{recording:true,excluded:[],rules:[{keyword:'saved',group:'Manual'}]},records:[{id:'synthetic',url:'https://record.test/',group:'Manual',manualGroup:true}],visits:[{url:'https://record.test/',start:1,end:2}],apiKeys:{synthetic:'fake-test-key'},'pickmark-bookmarks-v1':{metadata:{synthetic:{group:'Manual bookmark'}}}};
  await chrome.storage.local.set({...otherData,[legacyKey]:legacy});
  globalThis.initialLocal=await chrome.storage.local.get(null);
  globalThis.cache=cacheModule.thumbnailCache(chrome);
  expect(cache===cacheModule.thumbnailCache(chrome),'Factory must reuse the API-specific cache');
 });

 await check('failed native migration transaction preserves the old cache and other local data',async()=>{
  const originals={put:IDBObjectStore.prototype.put,add:IDBObjectStore.prototype.add};
  globalThis.imageStores=new Set();let injected=false;
  for(const method of ['put','add'])IDBObjectStore.prototype[method]=function(value,...args){
   const request=originals[method].call(this,value,...args);
   const hasBlob=value instanceof Blob||value&&typeof value==='object'&&Object.values(value).some(v=>v instanceof Blob);
   if(hasBlob){
    imageStores.add(this.name);
    if(!injected){injected=true;const transaction=this.transaction;request.addEventListener('success',()=>transaction.abort(),{once:true});}
   }
   return request;
  };
  let failed=false;
  try{await cache.list();}catch{failed=true;}
  finally{for(const method of ['put','add'])IDBObjectStore.prototype[method]=originals[method];}
  expect(injected&&failed,'Aborted Blob transaction must reject migration');
  same(await chrome.storage.local.get(null),initialLocal,'Migration failure changed existing data');
  for(const info of await indexedDB.databases()){
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(info.name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   try{
    for(const name of imageStores){
     if(!db.objectStoreNames.contains(name))continue;
     const count=await new Promise((resolve,reject)=>{const request=db.transaction(name).objectStore(name).count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
     expect(count===0,'Failed migration left partially committed image data');
    }
   }finally{db.close();}
  }
 });

 await check('migration retries explicitly, preserves images and redirect aliases, and keeps a rollback snapshot',async()=>{
  const list=await cache.list();same(Object.keys(list).sort(),['https://legacy.test/one','https://legacy.test/two'],'Migration did not retain the two eligible previews');
  expect(await cache.get('https://legacy.test/one')===smallImage,'Migrated image changed');
  expect(await cache.get('https://legacy-source.test/')===smallImage,'Migrated alias was lost');
  expect(await cache.get('https://expired.test/')===null,'Expired legacy image was imported');
  expect(await cache.get('https://mail.google.com/')===null,'Email preview was imported');
  same(await chrome.storage.local.get(null),initialLocal,'Migration modified the rollback snapshot or unrelated data');
  const usage=await cache.usage();expect(usage.count===2&&usage.bytes>2000,'Migration usage is not measured');
  expect(usage.maxBytes===50000000&&usage.maxItems===500,'Unexpected independent cache limits');
  expect(Object.values(list).every(entry=>!('image' in entry)&&!('blob' in entry)),'Metadata list contains image payloads');
 });

 await check('metadata and usage avoid image reads; lookups read only selected images',async()=>{
  const originals=Object.fromEntries(['get','getAll','openCursor'].map(name=>[name,IDBObjectStore.prototype[name]])),reads=[];
  for(const method of Object.keys(originals))IDBObjectStore.prototype[method]=function(...args){if(imageStores.has(this.name))reads.push({method,key:args[0]});return originals[method].apply(this,args);};
  try{
   await cache.list();await cache.usage();same(reads,[],'Metadata or usage fetched image payloads');
   const found=await cache.lookup(['https://legacy.test/one','https://unknown.test/']);
   same(Object.keys(found),['https://legacy.test/one'],'Lookup returned unexpected images');
   expect(reads.length>0&&reads.every(r=>r.method==='get'&&r.key==='https://legacy.test/one'),'Lookup read an entire image store or unrelated image');
  }finally{for(const method of Object.keys(originals))IDBObjectStore.prototype[method]=originals[method];}
 });

 await check('persistent migration quota and transaction failures still allow counting and clearing all previews',async()=>{
  const info=(await indexedDB.databases()).find(item=>item.name==='pickmark-previews');
  expect(info,'The native preview database was not created');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(info.name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{
   for(const mode of ['quota','abort']){
    const existingURL='https://already-cached.test/'+mode;
    await cache.put(existingURL,smallImage);
    const failedLegacy={...legacy,'https://migration-failure.test/':{image:smallImage,at:Date.now()}};
    await chrome.storage.local.set({[legacyKey]:failedLegacy});
    await new Promise((resolve,reject)=>{
     const transaction=db.transaction('state','readwrite');transaction.objectStore('state').put(false,'migrated');
     transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);
    });
    const failingCache=cacheModule.thumbnailCache({storage:chrome.storage,runtime:chrome.runtime});
    const originals={put:IDBObjectStore.prototype.put,add:IDBObjectStore.prototype.add};
    const aborting=new WeakSet();let attempts=0;
    for(const method of ['put','add'])IDBObjectStore.prototype[method]=function(value,...args){
     if(!imageStores.has(this.name))return originals[method].call(this,value,...args);
     attempts++;
     if(mode==='quota')throw new DOMException('Synthetic persistent image quota failure','QuotaExceededError');
     const request=originals[method].call(this,value,...args),transaction=this.transaction;
     if(!aborting.has(transaction)){aborting.add(transaction);request.addEventListener('success',()=>transaction.abort(),{once:true});}
     return request;
    };
    try{
     for(let attempt=0;attempt<2;attempt++){
      let failure;try{await failingCache.list();}catch(error){failure=error;}
      expect(failure,mode+' migration did not reject');
      if(mode==='quota')expect(failure.code==='STORAGE_CAPACITY','Native quota error was not exposed as storage capacity');
     }
     const writesBeforeCount=attempts;
     expect(writesBeforeCount>=2,'Persistent migration failure was not exercised twice');
     const count=await failingCache.countForClear();
     expect(count===new Set([existingURL,...Object.keys(failedLegacy)]).size,'Clear count lost old or independent previews');
     expect(attempts===writesBeforeCount,'Counting previews retried the failed migration');
     same((await chrome.storage.local.get(legacyKey))[legacyKey],failedLegacy,'Failed migration changed the old previews');
     await failingCache.clear();
     expect(attempts===writesBeforeCount,'Clearing previews attempted the blocked image migration');
     expect(await failingCache.countForClear()===0,'Clear retained old or independent previews');
     expect((await failingCache.usage()).count===0,'Clear left visible previews');
     const migrated=await new Promise((resolve,reject)=>{const request=db.transaction('state').objectStore('state').get('migrated');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
     expect(migrated===true,'Clear did not persist migration completion');
     for(const name of ['entries',...imageStores]){
      const count=await new Promise((resolve,reject)=>{const request=db.transaction(name).objectStore(name).count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      expect(count===0,'Clear left native '+name+' records');
     }
     same(await chrome.storage.local.get(null),otherData,'Clear during failed migration changed unrelated local data');
    }finally{for(const method of ['put','add'])IDBObjectStore.prototype[method]=originals[method];}
   }
  }finally{db.close();}
 });
 const recoveryPage=await context.newPage();await recoveryPage.goto(`chrome-extension://${new URL(worker.url()).hostname}/cache-fixture.html`);
 const recovered=await recoveryPage.evaluate(async()=>{
  const {thumbnailCache}=await import('./thumbnail-cache.js'),cache=thumbnailCache(chrome);
  return {usage:await cache.usage(),count:await cache.countForClear(),image:await cache.get('https://migration-failure.test/')};
 });
 assert.equal(recovered.usage.count,0);assert.equal(recovered.count,0);assert.equal(recovered.image,null);await recoveryPage.close();
 console.log('PASS clearing after persistent migration failures survives a fresh extension context.');

 await check('independent binary cache exceeds 1.5 MB and 100 images without growing storage.local',async()=>{
  await cache.clear();
  globalThis.localAfterClear=await chrome.storage.local.get(null);
  for(const [key,value] of Object.entries(otherData))same(localAfterClear[key],value,'Clear changed unrelated '+key);
  expect(!localAfterClear[legacyKey]||!Object.keys(localAfterClear[legacyKey]).length,'Clear retained legacy images');
  const image=makeImage(20000),start=Date.now()-1000;
  for(let i=0;i<501;i++)await cache.put('https://count.test/'+i,image,{at:start+i});
  const usage=await cache.usage();expect(usage.count===500,'Cache is not bounded at 500 images');expect(usage.bytes>10000000&&usage.bytes<11000000,'Binary image usage has an unexpected size');
  expect(await cache.get('https://count.test/0')===null,'Oldest image was not evicted at the item limit');
  expect(await cache.get('https://count.test/500')===image,'Newest image was not retained');
  same(await chrome.storage.local.get(null),localAfterClear,'New images grew or changed storage.local');
 });

 await check('50 MB limit stops protected-scope writes atomically and otherwise evicts oldest images',async()=>{
  await cache.clear();const image=makeImage(16000000),start=Date.now()-10;
  for(let i=0;i<3;i++)await cache.put('https://bytes.test/'+i,image,{at:start+i});
  const before=await cache.usage();expect(before.bytes>48000000&&before.bytes<50000000,'Three binary 16 MB images should fit below 50 MB');
  const protectedURLs=Object.keys(await cache.list());let failed=false;
  try{await cache.put('https://bytes.test/extra',makeImage(3000000),{preserveUrls:protectedURLs});}catch(error){failed=error.code==='PREVIEW_LIMIT';}
  expect(failed,'Protected scope must stop at the byte limit');same(await cache.usage(),before,'Rejected write changed cache occupancy');
  expect(await cache.get('https://bytes.test/extra')===null,'Rejected image was committed');
  await cache.put('https://bytes.test/extra',makeImage(3000000));
  const list=await cache.list();expect(!list['https://bytes.test/0']&&list['https://bytes.test/extra'],'Unprotected oldest image was not replaced');
  expect((await cache.usage()).bytes<=50000000,'Cache exceeded 50 MB');
  same(await chrome.storage.local.get(null),localAfterClear,'Large preview writes changed unrelated local data');
 });

 await check('cancellation during a real image-write transaction rolls back images, metadata and evictions',async()=>{
  const before=await cache.list(),controller=new AbortController();
  const originals={put:IDBObjectStore.prototype.put,add:IDBObjectStore.prototype.add};let injected=false;
  for(const method of ['put','add'])IDBObjectStore.prototype[method]=function(value,...args){
   const request=originals[method].call(this,value,...args);
   if(imageStores.has(this.name)&&!injected){injected=true;request.addEventListener('success',()=>controller.abort(Error('Synthetic cancellation')),{once:true});}
   return request;
  };
  let failed=false;
  try{await cache.put('https://cancelled.test/',makeImage(16000000),{signal:controller.signal});}catch{failed=true;}
  finally{for(const method of ['put','add'])IDBObjectStore.prototype[method]=originals[method];}
  expect(injected&&failed,'Cancellation during an image write did not reject');same(await cache.list(),before,'Cancelled transaction changed stored metadata or evicted images');
  expect(await cache.get('https://cancelled.test/')===null,'Cancelled image was saved');
 });

 await check('source aliases, exclusions, expiry and manual clear apply to the independent cache',async()=>{
  await cache.clear();
  await cache.put('https://final.test/page',smallImage,{sources:['https://source.test/','https://mail.google.com/']});
  await cache.addSources('https://final.test/page',['https://second-source.test/'],[]);
  expect(await cache.get('https://second-source.test/')===smallImage,'Adding redirect source did not persist');
  await cache.prune(['source.test']);expect(await cache.get('https://source.test/')===null,'Excluded source still resolves');expect(await cache.get('https://final.test/page')===smallImage,'Excluding an alias removed its eligible target');
  await cache.prune(['final.test']);expect((await cache.usage()).count===0,'Excluded target was not removed');expect(await cache.get('https://second-source.test/')===null,'Orphan alias still resolves');
  await cache.put('https://expires.test/',smallImage);
  const realNow=Date.now;Date.now=()=>realNow()+8*86400000;
  try{expect((await cache.usage()).count===0,'Usage did not prune expired previews');expect(await cache.countForClear()===0,'Usage hid expired metadata without removing it');}finally{Date.now=realNow;}
  await cache.put('https://clear.test/',smallImage);await cache.clear();expect((await cache.usage()).count===0,'Clear left cached images');
  same(await chrome.storage.local.get(null),localAfterClear,'Preview maintenance changed unrelated local data');
 });

 const page=await context.newPage();await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/cache-fixture.html`);
 const reopened=await page.evaluate(async()=>{
  const {thumbnailCache}=await import('./thumbnail-cache.js'),cache=thumbnailCache(chrome);
  return {usage:await cache.usage(),old:await cache.get('https://legacy.test/one'),current:await cache.get('https://clear.test/')};
 });
 assert.equal(reopened.usage.count,0);assert.equal(reopened.old,null);assert.equal(reopened.current,null);
 console.log('PASS clear survives a fresh extension context without resurrecting the rollback snapshot.');
 console.log('Native IndexedDB regression passed: migration/rollback snapshot, atomic aborts, bounded binary storage, metadata-only reads and data isolation.');
}finally{
 try{if(context)await context.close();}finally{await fs.rm(temp,{recursive:true,force:true});}
}
