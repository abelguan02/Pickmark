import {defaults,webUrl} from './core.js';
import {handleThumbnail,previewAllowed,retainThumbnails,THUMBNAIL_KEY,PREVIEW_AUTO_KEY} from './thumbnails.js';
import {isStorageCapacityError} from './storage-budget.js';
// Consent is persistent; eligibility is checked again for each visible page.
// Timers hold no tab images. Network/hidden tabs/bookmarks are never opened.
export function thumbnailWorker({api,serial,delayMs=1100,captureTimeoutMs=15000}){
 let timer,generation=0,lastAttempt=0;
 const attempts=new Map();
 function notify(url){
  // No open panel is a normal condition; progress itself is kept in memory.
  api.runtime.sendMessage?.({type:'preview:changed',url})?.catch(()=>{});
 }
 function remember(url,value){
  attempts.delete(url);attempts.set(url,value);
  while(attempts.size>100)attempts.delete(attempts.keys().next().value);
  notify(url);
 }
 async function captureFor(message,config){
  const token=generation,attempt={state:'generating'};
  remember(message.url,attempt);
  try{
   const image=await handleThumbnail(message,api,config,{shouldSave:()=>token===generation,captureTimeoutMs});
   if(attempts.get(message.url)===attempt){attempts.delete(message.url);notify(message.url);}
   return image;
  }catch(error){
   if(token===generation&&attempts.get(message.url)===attempt){
    const reason=isStorageCapacityError(error)?'storage':({CAPTURE_TIMEOUT:'timeout',CAPTURE_PERMISSION:'permission',PAGE_CHANGED:'changed',CAPTURE_TOO_LARGE:'tooLarge'})[error.code]||'capture';
    remember(message.url,{state:'error',reason});
   }
   throw error;
  }
 }
 async function context(){
  const data=await api.storage.local.get(['config',PREVIEW_AUTO_KEY,THUMBNAIL_KEY]);
  const config={...defaults(),...data.config};
  const authorized=await api.permissions.contains({origins:['<all_urls>']});
  const window=await api.windows.getLastFocused(),[tab]=await api.tabs.query({active:true,lastFocusedWindow:true});
  return {config,authorized,window,tab,requested:data[PREVIEW_AUTO_KEY]===true,cache:retainThumbnails(data[THUMBNAIL_KEY],config.excluded)};
 }
 function describe(url,c){
  const base={enabled:c.requested&&c.authorized,requested:c.requested,authorized:c.authorized,recording:c.config.recording};
  if(url===undefined)return base;
  const blocked=!previewAllowed(url,c.config.excluded),visible=!!c.tab&&!c.tab.incognito&&c.window.focused&&c.tab.windowId===c.window.id&&c.tab.url===url&&!blocked;
  const common={...base,blocked,visible,savedAt:c.cache[url]?.at||null};
  if(blocked)return {...common,state:'unavailable',reason:webUrl(url)?'excluded':'unsupported'};
  const attempt=attempts.get(url);
  if(attempt&&c.config.recording&&(c.requested?c.authorized:true))return {...common,...attempt};
  if(c.cache[url])return {...common,state:'saved'};
  if(!c.config.recording)return {...common,state:'unavailable',reason:'paused'};
  if(!c.requested)return {...common,state:'unavailable',reason:'disabled'};
  if(!c.authorized)return {...common,state:'unavailable',reason:'permission'};
  if(c.tab?.url===url&&c.tab.incognito)return {...common,state:'unavailable',reason:'private'};
  const reason=c.tab?.url!==url?'visit':!c.window.focused?'foreground':c.tab.status!=='complete'?'loading':'ready';
  return {...common,state:'pending',reason};
 }
 async function status(url){
  if(url!==undefined&&typeof url!=='string')throw Error('Invalid preview URL');
  return describe(url,await context());
 }
 async function states(urls){
  if(!Array.isArray(urls)||urls.length>5000||urls.some(url=>typeof url!=='string'))throw Error('Invalid preview scope');
  const c=await context();return Object.fromEntries(urls.map(url=>[url,describe(url,c)]));
 }
 async function capture(){
  const token=generation,now=Date.now();
  const data=await api.storage.local.get(['config',PREVIEW_AUTO_KEY]);
  const config={...defaults(),...data.config};
  if(data[PREVIEW_AUTO_KEY]!==true||!config.recording||!await api.permissions.contains({origins:['<all_urls>']}))return;
  const window=await api.windows.getLastFocused();
  if(!window.focused||window.incognito)return;
  const [tab]=await api.tabs.query({active:true,lastFocusedWindow:true});
  if(!tab||tab.windowId!==window.id||tab.incognito||tab.status!=='complete'||!previewAllowed(tab.url,config.excluded))return;
  const cache=await api.storage.local.get(THUMBNAIL_KEY);
  if(now-lastAttempt<1000||now-(cache[THUMBNAIL_KEY]?.[tab.url]?.at||0)<300000)return;
  lastAttempt=now;
  if(token!==generation)return;
  return captureFor({type:'thumbnail:capture',url:tab.url},config);
 }
 function cancel(){generation++;clearTimeout(timer);for(const [url,attempt] of attempts)if(attempt.state==='generating'){attempts.delete(url);notify(url);}}
 function schedule(){cancel();timer=setTimeout(()=>serial(capture).catch(()=>{/* Failure is available through preview status. */}),delayMs);timer.unref?.();}
 api.tabs.onActivated?.addListener(schedule);
 api.tabs.onUpdated?.addListener((id,info)=>{if(info.url||info.status==='complete')schedule();else if(info.status==='loading')cancel();});
 api.windows.onFocusChanged?.addListener(schedule);
 api.runtime.onStartup?.addListener(schedule);
 api.runtime.onInstalled?.addListener(schedule);
 api.alarms?.onAlarm?.addListener(alarm=>{if(alarm.name==='activity-checkpoint')schedule();});
 api.storage.onChanged?.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes[PREVIEW_AUTO_KEY]){if(changes[PREVIEW_AUTO_KEY].newValue===true)schedule();else cancel();}
  const config=changes.config;
  if(config&&(config.newValue?.recording!==config.oldValue?.recording||JSON.stringify(config.newValue?.excluded)!==JSON.stringify(config.oldValue?.excluded)))schedule();
 });
 api.permissions?.onRemoved?.addListener(cancel);
 api.permissions?.onAdded?.addListener(schedule);
 schedule();
 return {capture,captureFor,status,states,schedule,cancel};
}
