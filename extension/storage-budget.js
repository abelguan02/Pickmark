// Page records share Chrome's 10 MiB local quota with settings and credentials.
export const HISTORY_BYTES=4*1024*1024;
const LOCAL_BYTES=10*1024*1024-128*1024;
export const isStorageCapacityError=error=>error?.code==='STORAGE_CAPACITY'||/QUOTA_BYTES|quota.*exceed|exceed.*quota/i.test(error?.message||'');
const encoder=new TextEncoder();
export const jsonBytes=value=>encoder.encode(JSON.stringify(value)).length;

export function retainByBytes(items,budget=HISTORY_BYTES) {
 const kept=[];let bytes=2;
 for(let i=items.length-1;i>=0;i--){
  const size=jsonBytes(items[i]);
  // Skip an individually oversized page without evicting all normal pages.
  if(size+2>budget)continue;
  const extra=size+(kept.length?1:0);
  if(bytes+extra>budget)break;
  kept.push(items[i]);bytes+=extra;
 }
 return kept.reverse();
}

// Capacity may discard history, never protected rows. The final writer checks
// whether the protected set fits the shared quota and fails atomically if not.
export function retainProtected(items,budget,protect,maxItems=Infinity){
 const protectedRows=items.filter(protect),disposable=items.filter(r=>!protect(r));
 const reserved=jsonBytes(protectedRows);
 const candidates=disposable.slice(Math.max(0,disposable.length-Math.max(0,maxItems-protectedRows.length)));
 const retained=retainByBytes(candidates,Math.max(2,budget-reserved+2-(protectedRows.length?1:0)));
 const keep=new Set([...retained,...protectedRows]);
 return items.filter(r=>keep.has(r));
}

// All callers run on the background worker's serial queue. Budget the merged
// storage, including unchanged histories, before a single atomic write.
export async function writeLocal(value,api=chrome,{signal}={}) {
 const readKeys=['config',...(!Object.hasOwn(value,'records')?['records']:[])];
 const replacedKeys=[...new Set(['records','config',...Object.keys(value)])];
 const [stored,totalBytes,replacedBytes]=await Promise.all([
  api.storage.local.get(readKeys),
  api.storage.local.getBytesInUse(null),
  api.storage.local.getBytesInUse(replacedKeys)
 ]);
 const {records=[]}={...stored,...value};
 const patch={...value};
 if(patch.config)patch.config={...patch.config,historyRevision:Math.max(stored.config?.historyRevision||0,patch.config.historyRevision||0)};
 const config=Object.hasOwn(patch,'config')?patch.config:stored.config;
 const tabs=api.tabs?await api.tabs.query({}):null;
 const open=tabs&&new Set(tabs.filter(t=>!t.incognito).map(t=>t.url));
 const latest=new Map();
 for(const r of records)if(!latest.has(r.url)||latest.get(r.url).day<=r.day)latest.set(r.url,r);
 // Use only the proposed records: never recover a deleted row from old storage.
 // Protect the latest manual state of each open URL, even before startup maintenance.
 const protectedIds=new Set([...latest.values()].filter(r=>r.manualGroup&&(!open||open.has(r.url))).map(r=>r.id));
 const protectedRows=records.filter(r=>protectedIds.has(r.id));
 // Count unchanged large values in Chrome without fetching or serializing them.
 const overhead=Object.entries(value).filter(([key])=>!['records','config'].includes(key)).reduce((sum,[key,item])=>sum+encoder.encode(key).length+jsonBytes(item),totalBytes-replacedBytes);
 const reserved=jsonBytes(protectedRows);
 function fitRecords(config){
  const configBytes=config===undefined?0:'config'.length+jsonBytes(config);
  const available=LOCAL_BYTES-overhead-configBytes-'records'.length;
  if(reserved+2>available)throw Object.assign(Error('空间不足，未保存本次更改；当前标签的人工分类已保留。 / Not enough storage; changes were not saved and manual classifications remain intact.'),{code:'STORAGE_CAPACITY'});
  // Spend disposable history first, borrowing its budget to keep manual state.
  const recordBudget=Math.max(reserved,Math.min(HISTORY_BYTES,Math.max(2,available)));
  return {available,keptRecords:retainProtected(records,recordBudget,r=>protectedIds.has(r.id),5000)};
 }
 let {available,keptRecords}=fitRecords(config);
 if(keptRecords.length!==records.length){
  patch.config={...config,historyRevision:Math.max(stored.config?.historyRevision||0,config?.historyRevision||0)+1};
  // The new revision field (or digit) also consumes space in the final write.
  ({available,keptRecords}=fitRecords(patch.config));
 }
 if(Object.hasOwn(value,'records')||keptRecords.length!==records.length)patch.records=keptRecords;
 signal?.throwIfAborted();
 await api.storage.local.set(patch);
 return patch;
}
