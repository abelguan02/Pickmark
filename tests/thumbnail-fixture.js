import {thumbnailCache} from '../extension/thumbnail-cache.js';

export function memoryThumbnailDB({entries=[],images={},migrated=false}={}){
 const state={entries:new Map(entries.map(entry=>[entry.url,structuredClone(entry)])),images:new Map(Object.entries(images)),migrated};
 const db={state,beforeWrite:null,afterCommit:null,failure:null,
  async read(){return {entries:structuredClone([...state.entries.values()]),migrated:state.migrated};},
  async images(urls){return urls.map(url=>state.images.get(url));},
  async write({put=[],remove=[],clear=false,migrated},{signal,shouldSave=()=>true}={}){
   signal?.throwIfAborted();
   if(!shouldSave())throw Object.assign(Error('Preview changed'),{code:'PAGE_CHANGED'});
   await db.beforeWrite?.({put,remove,clear,migrated},{signal,shouldSave});
   signal?.throwIfAborted();
   if(!shouldSave())throw Object.assign(Error('Preview changed'),{code:'PAGE_CHANGED'});
   if(db.failure)throw db.failure;
   const entries=clear?new Map():new Map(state.entries),images=clear?new Map():new Map(state.images);
   for(const url of remove){entries.delete(url);images.delete(url);}
   for(const {entry,image} of put){entries.set(entry.url,structuredClone(entry));if(image)images.set(entry.url,image);}
   state.entries=entries;state.images=images;
   if(migrated!==undefined)state.migrated=migrated;
   await db.afterCommit?.({put,remove,clear,migrated});
  }
 };
 return db;
}

export function installThumbnailCache(api,options){
 const db=memoryThumbnailDB(options),cache=thumbnailCache(api,db);
 return {db,cache};
}
