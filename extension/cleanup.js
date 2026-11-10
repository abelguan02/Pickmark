import {defaults,dayKey,eligible,retainRecords} from './core.js';
import {THUMBNAIL_KEY,retainThumbnails} from './thumbnails.js';
// Carry only already known open pages. Never reopen tabs or read bookmarks.
export function preserveCurrent(records,tabs,config,now=Date.now()){
 const today=dayKey(now),latest=new Map(),current=new Set();
 for(const r of records){if(!latest.has(r.url)||latest.get(r.url).day<=r.day)latest.set(r.url,r);if(r.day===today)current.add(r.url);}
 const result=[...records];
 for(const tab of tabs){const previous=latest.get(tab.url);if(!previous||current.has(tab.url)||!eligible(tab,config))continue;current.add(tab.url);result.push({...previous,id:crypto.randomUUID(),day:today,snapshotGroup:previous.group,firstSeen:now,lastSeen:now,activations:0});}
 return result;
}
export function cleanupSnapshot(data,tabs,{now=Date.now(),mode='auto',days=7}={}){
 const config={...defaults(),...data.config},policy=mode==='old'?{...config,retentionDays:days}:config;
 const open=new Set(tabs.filter(t=>eligible(t,config)).map(t=>t.url));
 let records=preserveCurrent(data.records||[],tabs,config,now);
 if(mode==='all')records=records.filter(r=>r.day===dayKey(now)&&open.has(r.url));
 // Under the count/byte budget, prefer current open state over closed history.
 const isCurrent=r=>r.day===dayKey(now)&&open.has(r.url);
 records=retainRecords([...records.filter(r=>!isCurrent(r)),...records.filter(isCurrent)],policy,now);
 const keptIds=new Set(records.map(r=>r.id)),removed=(data.records||[]).some(r=>!keptIds.has(r.id));
 if(mode!=='auto'||removed)config.historyRevision=(config.historyRevision||0)+1;
 return {records,config,[THUMBNAIL_KEY]:retainThumbnails(data[THUMBNAIL_KEY]||{},config.excluded,now),lastCleanupAt:now};
}
