import {THUMBNAIL_KEY,PREVIEW_BYTES,PREVIEW_ITEMS,previewAllowed,previewSources,thumbnailTarget,validPreviewEntries,planPreviewEntries} from './thumbnail-policy.js';
import {isStorageCapacityError} from './storage-budget.js';
const stores=new WeakMap(),encoder=new TextEncoder();
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
function database(){
 let opening;
 async function open(){
  if(!opening)opening=new Promise((resolve,reject)=>{
   const req=indexedDB.open('pickmark-previews',1);
   req.onupgradeneeded=()=>{for(const name of ['entries','images','state'])req.result.createObjectStore(name);};
   req.onerror=()=>{opening=null;reject(req.error);};
   req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
  });
  return opening;
 }
 return {
  async read(){const db=await open(),tx=db.transaction(['entries','state'],'readonly');const [entries,migrated]=await Promise.all([request(tx.objectStore('entries').getAll()),request(tx.objectStore('state').get('migrated'))]);return {entries,migrated};},
  async images(urls){const db=await open(),tx=db.transaction('images','readonly');return Promise.all(urls.map(url=>request(tx.objectStore('images').get(url))));},
  async write({put=[],remove=[],clear=false,migrated},{signal,shouldSave=()=>true}={}){
   signal?.throwIfAborted();if(!shouldSave())throw Object.assign(Error('Preview changed'),{code:'PAGE_CHANGED'});
   const db=await open();signal?.throwIfAborted();
   return new Promise((resolve,reject)=>{
    const tx=db.transaction(['entries','images','state'],'readwrite');let failure;
    const abort=()=>{failure=signal.reason;tx.abort();};
    tx.oncomplete=()=>{signal?.removeEventListener('abort',abort);resolve();};
    tx.onabort=()=>{signal?.removeEventListener('abort',abort);reject(failure||tx.error||Error('Preview transaction aborted'));};
    signal?.addEventListener('abort',abort,{once:true});
    try{
     if(!shouldSave())throw Object.assign(Error('Preview changed'),{code:'PAGE_CHANGED'});
     if(clear){tx.objectStore('entries').clear();tx.objectStore('images').clear();}
     for(const url of remove){tx.objectStore('entries').delete(url);tx.objectStore('images').delete(url);}
     for(const {entry,image} of put){tx.objectStore('entries').put(entry,entry.url);if(image)tx.objectStore('images').put(image,entry.url);}
     if(migrated!==undefined)tx.objectStore('state').put(migrated,'migrated');
    }catch(error){failure=error;tx.abort();}
   });
  }
 };
}
function imageBlob(image){
 if(typeof image!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))throw Error('Invalid preview image');
 return new Blob([Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/jpeg'});
}
async function imageURL(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return 'data:image/jpeg;base64,'+btoa(binary);
}
function metadata(url,at,sources,image){
 const entry={url,at,sources,imageBytes:image.size};return {...entry,bytes:image.size+encoder.encode(JSON.stringify(entry)).length};
}
// The optional database adapter keeps unit tests independent of browser APIs;
// the real IndexedDB transactions are covered by the browser regression.
export function thumbnailCache(api=chrome,backend){
 if(stores.has(api))return stores.get(api);
 const db=backend||database();let initialization,queue=Promise.resolve();
 const notify=()=>api.runtime?.sendMessage?.({type:'preview:cacheChanged'})?.catch(()=>{});
 const mutate=fn=>{const result=queue.then(fn).catch(error=>{if(error.name==='QuotaExceededError'||isStorageCapacityError(error))throw Object.assign(Error('预览缓存空间不足，请清理缓存后重试。 / Preview storage is full. Clear the cache and retry.',{cause:error}),{code:'STORAGE_CAPACITY'});throw error;});queue=result.catch(()=>{});return result;};
 async function ready(){
  if(!initialization)initialization=mutate(async()=>{
   const current=await db.read();if(current.migrated)return;
   const legacy=(await api.storage.local.get(THUMBNAIL_KEY))[THUMBNAIL_KEY]||{};
   const {config}=await api.storage.local.get('config'),excluded=config?.excluded||[];
   const put=[];
   for(const [url,value] of Object.entries(legacy)){
    if(!previewAllowed(url,excluded)||!value?.at||typeof value.image!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.image)||current.entries.some(e=>e.url===url&&e.at>=value.at))continue;
    const image=imageBlob(value.image),sources=previewSources(url,value.sources,excluded);
    put.push({entry:metadata(url,value.at,sources,image),image});
   }
   const entries=planPreviewEntries([...current.entries.filter(e=>!put.some(v=>v.entry.url===e.url)),...put.map(v=>v.entry)],null,{excluded});
   const keep=new Set(entries.map(e=>e.url));
   await db.write({put:put.filter(v=>keep.has(v.entry.url)),remove:current.entries.filter(e=>!keep.has(e.url)).map(e=>e.url),migrated:true});
   notify();
  }).catch(error=>{initialization=null;throw error;});
  return initialization;
 }
 async function list(excluded=[]){await ready();return Object.fromEntries(validPreviewEntries((await db.read()).entries,excluded).map(({url,...entry})=>[url,entry]));}
 const cache={
  list,
  async lookup(urls,excluded=[]){
   const entries=await list(excluded),targets=[...new Set(urls.filter(url=>previewAllowed(url,excluded)).map(url=>thumbnailTarget(entries,url)).filter(url=>entries[url]))];
   if(!targets.length)return {};
   const blobs=await db.images(targets),images=Object.fromEntries(await Promise.all(targets.map(async(url,i)=>[url,blobs[i]?await imageURL(blobs[i]):null])));
   return Object.fromEntries(urls.filter(url=>previewAllowed(url,excluded)&&images[thumbnailTarget(entries,url)]).map(url=>[url,images[thumbnailTarget(entries,url)]]));
  },
  async get(url,excluded=[]){return (await cache.lookup([url],excluded))[url]||null;},
  async put(url,value,{at=Date.now(),sources=[],excluded=[],preserveUrls=[],signal,shouldSave}={}){
   await ready();signal?.throwIfAborted();if(!previewAllowed(url,excluded))throw Error('Preview is excluded');
   const image=imageBlob(value);
   return mutate(async()=>{
    signal?.throwIfAborted();const {entries}=await db.read(),previous=entries.find(e=>e.url===url);
    const entry=metadata(url,at,previewSources(url,[...(previous?.sources||[]),...sources],excluded),image);
    const kept=planPreviewEntries(entries,entry,{excluded,preserveUrls});const keep=new Set(kept.map(e=>e.url));
    await db.write({put:[{entry,image}],remove:entries.filter(e=>!keep.has(e.url)).map(e=>e.url)},{signal,shouldSave});notify();
   });
  },
  async addSources(url,sources,excluded=[]){
   await ready();return mutate(async()=>{
    const {entries}=await db.read(),previous=entries.find(e=>e.url===url);if(!previous)return;
    const entry=metadata(url,previous.at,previewSources(url,[...previous.sources,...sources],excluded),{size:previous.imageBytes});
    const kept=planPreviewEntries(entries,entry,{excluded}),keep=new Set(kept.map(e=>e.url));
    await db.write({put:[{entry}],remove:entries.filter(e=>!keep.has(e.url)).map(e=>e.url)});notify();
   });
  },
  async usage(excluded=[]){await cache.prune(excluded);const entries=(await db.read()).entries;return {bytes:entries.reduce((n,e)=>n+e.bytes,0),count:entries.length,maxBytes:PREVIEW_BYTES,maxItems:PREVIEW_ITEMS};},
  async prune(excluded=[]){
   await ready();return mutate(async()=>{
    const {entries}=await db.read(),kept=planPreviewEntries(entries,null,{excluded}),keep=new Set(kept.map(e=>e.url));
    const remove=entries.filter(e=>!keep.has(e.url)).map(e=>e.url),put=kept.filter(e=>JSON.stringify(e.sources)!==JSON.stringify(entries.find(old=>old.url===e.url).sources)).map(entry=>({entry:metadata(entry.url,entry.at,entry.sources,{size:entry.imageBytes})}));
    if(remove.length||put.length){await db.write({remove,put});notify();}
   });
  },
  async countForClear(){const [{entries},stored]=await Promise.all([db.read(),api.storage.local.get(THUMBNAIL_KEY)]);return new Set([...entries.map(e=>e.url),...Object.keys(stored[THUMBNAIL_KEY]||{})]).size;},
  async clear(){return mutate(async()=>{await db.write({clear:true,migrated:true});await api.storage.local.remove([THUMBNAIL_KEY]);notify();});}
 };
 stores.set(api,cache);return cache;
}
