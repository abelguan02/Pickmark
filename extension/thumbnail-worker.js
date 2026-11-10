import {defaults,webUrl} from './core.js';
import {handleThumbnail,previewAllowed,thumbnailTarget,PREVIEW_AUTO_KEY} from './thumbnails.js';
import {thumbnailCache} from './thumbnail-cache.js';
import {isStorageCapacityError} from './storage-budget.js';
// Consent is persistent; eligibility is checked again for each visible page.
// Timers hold no tab images. Network/hidden tabs/bookmarks are never opened.
export function thumbnailWorker({api,serial,delayMs=1100,captureTimeoutMs=15000,batchActive=()=>false}){
 const images=thumbnailCache(api);
 let timer,generation=0,lastAttempt=0,captureTarget;
 const attempts=new Map(),navigations=new Map();
 function notify(url,sources=[]){
  // No open panel is a normal condition; progress itself is kept in memory.
  for(const changed of new Set([url,...sources]))api.runtime.sendMessage?.({type:'preview:changed',url:changed})?.catch(()=>{});
 }
 function targetFor(url,cache){
  const normalized=webUrl(url)?.href||url;
  const navigation=[...navigations.values()].reverse().find(n=>n.complete&&n.source===normalized);
  return navigation?.url||thumbnailTarget(cache,normalized);
 }
 function sourcesFor(tab,config){
  const navigation=navigations.get(tab?.id);
  return navigation?.complete&&navigation.url===tab.url&&navigation.source!==tab.url&&previewAllowed(navigation.source,config.excluded)?[navigation.source]:[];
 }
 function remember(url,value){
  attempts.delete(url);attempts.set(url,value);
  while(attempts.size>100)attempts.delete(attempts.keys().next().value);
  notify(url,value.sources);
 }
 async function captureFor(message,config,{automatic=false}={}){
  const token=generation,c=await context(),requested=webUrl(message.url)?.href||message.url;
  const url=c.tab?.url===requested?requested:targetFor(requested,c.cache);
  if(!previewAllowed(message.url,config.excluded))throw Error('此页面不允许保存预览 / Preview is excluded for this page');
  const sources=[...(c.cache[url]?.sources||[]),...sourcesFor(c.tab,config)];
  const attempt={state:'generating',automatic,sources};
  const target=c.tab;captureTarget=target;
  remember(url,attempt);
  try{
   const image=await handleThumbnail({...message,url},api,config,{shouldSave:()=>token===generation,captureTimeoutMs,sources});
   if(attempts.get(url)===attempt){attempts.delete(url);notify(url,sources);}
   return image;
  }catch(error){
   if(token===generation&&attempts.get(url)===attempt){
    const reason=isStorageCapacityError(error)?'storage':({CAPTURE_TIMEOUT:'timeout',CAPTURE_PERMISSION:'permission',PAGE_CHANGED:'changed',CAPTURE_TOO_LARGE:'tooLarge'})[error.code]||'capture';
    remember(url,{state:'error',reason,automatic,sources});
   }
   throw error;
  }finally{if(captureTarget===target)captureTarget=null;}
 }
 async function context(){
   const data=await api.storage.local.get(['config',PREVIEW_AUTO_KEY]);
  const config={...defaults(),...data.config};
  const authorized=await api.permissions.contains({origins:['<all_urls>']});
  const window=await api.windows.getLastFocused(),[tab]=await api.tabs.query({active:true,lastFocusedWindow:true});
  return {config,authorized,window,tab,requested:data[PREVIEW_AUTO_KEY]===true,cache:await images.list(config.excluded)};
 }
 function describe(url,c){
  const base={enabled:c.requested&&c.authorized,requested:c.requested,authorized:c.authorized,recording:c.config.recording};
  if(url===undefined)return base;
  const requested=webUrl(url)?.href||url,entry=c.cache[thumbnailTarget(c.cache,requested)];
  url=c.tab?.url===requested?requested:targetFor(requested,c.cache);
  const blocked=!previewAllowed(requested,c.config.excluded)||!previewAllowed(url,c.config.excluded),visible=!!c.tab&&!c.tab.incognito&&c.window.focused&&c.tab.windowId===c.window.id&&c.tab.url===url&&!blocked;
  const common={...base,blocked,visible,savedAt:entry?.at||null};
  if(blocked)return {...common,state:'unavailable',reason:webUrl(url)?'excluded':'unsupported'};
  const attempt=attempts.get(url);
  // Automatic-capture settings must not hide the result of an explicit manual request.
  if(attempt&&(!attempt.automatic||(c.config.recording&&c.requested&&c.authorized)))return {...common,state:attempt.state,reason:attempt.reason};
  if(entry)return {...common,state:'saved'};
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
  if(batchActive())return;
  const token=generation,now=Date.now();
  const data=await api.storage.local.get(['config',PREVIEW_AUTO_KEY]);
  const config={...defaults(),...data.config};
  if(data[PREVIEW_AUTO_KEY]!==true||!config.recording||!await api.permissions.contains({origins:['<all_urls>']}))return;
  const window=await api.windows.getLastFocused();
  if(!window.focused||window.incognito)return;
  const [tab]=await api.tabs.query({active:true,lastFocusedWindow:true});
  if(!tab||tab.windowId!==window.id||tab.incognito||tab.status!=='complete'||!previewAllowed(tab.url,config.excluded))return;
  const cache=await images.list(config.excluded),entry=cache[tab.url];
  if(token!==generation)return;
  if(entry&&now-entry.at<300000){
   const sources=sourcesFor(tab,config).filter(source=>!entry.sources?.includes(source));
   if(sources.length){
    const attempt={state:'generating',automatic:true,sources};remember(tab.url,attempt);
    try{
      await images.addSources(tab.url,sources,config.excluded);
     if(attempts.get(tab.url)===attempt){attempts.delete(tab.url);notify(tab.url,sources);}
    }catch(error){
     if(token===generation&&attempts.get(tab.url)===attempt)remember(tab.url,{state:'error',reason:isStorageCapacityError(error)?'storage':'capture',automatic:true,sources});
     throw error;
    }
   }
   return;
  }
  if(now-lastAttempt<1000)return;
  lastAttempt=now;
  if(token!==generation)return;
  return captureFor({type:'thumbnail:capture',url:tab.url},config,{automatic:true});
 }
 function cancel(){generation++;clearTimeout(timer);for(const [url,attempt] of attempts)if(attempt.state==='generating'){attempts.delete(url);notify(url,attempt.sources);}}
 function schedule(){cancel();timer=setTimeout(()=>serial(capture).catch(()=>{/* Failure is available through preview status. */}),delayMs);timer.unref?.();}
 api.tabs.onActivated?.addListener(schedule);
 // Observe only the first load of a new tab. A later click, reload or SPA
 // navigation must never turn into an alias for the original bookmark.
 api.tabs.onCreated?.addListener(tab=>{
  if(tab.incognito)return;
  const source=webUrl(tab.pendingUrl||tab.url)?.href;
  navigations.set(tab.id,{source,url:source,complete:!!source&&tab.status==='complete'&&!tab.pendingUrl});
 });
 api.tabs.onRemoved?.addListener(id=>navigations.delete(id));
 api.tabs.onUpdated?.addListener((id,info,tab)=>{
  const n=navigations.get(id);
  if(n){
   if(tab?.incognito||n.complete&&(info.status==='loading'||info.url&&info.url!==n.url))navigations.delete(id);
   else{
    n.source??=webUrl(tab?.pendingUrl||info.url||tab?.url)?.href;
    n.url=webUrl(info.url||tab?.url)?.href||n.url;
    if(info.status==='complete'){if(n.source&&n.url)n.complete=true;else navigations.delete(id);}
   }
  }
  if(!info.url&&!['loading','complete'].includes(info.status))return;
  const update=()=>{if(info.url||info.status==='complete')schedule();else cancel();};
  if(captureTarget){if(id===captureTarget.id&&tab?.windowId===captureTarget.windowId)update();return;}
  if(!tab?.active)return;
  const token=generation;
  return api.windows.getLastFocused().then(window=>{if(token===generation&&window.focused&&window.id===tab.windowId)update();}).catch(console.error);
 });
 api.windows.onFocusChanged?.addListener(schedule);
 api.runtime.onStartup?.addListener(schedule);
 api.runtime.onInstalled?.addListener(schedule);
 async function configureCheckpoint(){
  const data=await api.storage.local.get(['config',PREVIEW_AUTO_KEY]);
  const enabled=data[PREVIEW_AUTO_KEY]===true&&data.config?.recording!==false&&await api.permissions.contains({origins:['<all_urls>']});
  if(enabled){if(!await api.alarms.get('preview-checkpoint'))await api.alarms.create('preview-checkpoint',{periodInMinutes:1});}
  else await api.alarms.clear('preview-checkpoint');
 }
 const refreshCheckpoint=()=>serial(configureCheckpoint).catch(console.error);
 api.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='preview-checkpoint')schedule();});
 api.storage.onChanged?.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes[PREVIEW_AUTO_KEY]||changes.config&&changes.config.newValue?.recording!==changes.config.oldValue?.recording)void refreshCheckpoint();
  if(changes[PREVIEW_AUTO_KEY]){if(changes[PREVIEW_AUTO_KEY].newValue===true)schedule();else cancel();}
  const config=changes.config;
  if(config&&(config.newValue?.recording!==config.oldValue?.recording||JSON.stringify(config.newValue?.excluded)!==JSON.stringify(config.oldValue?.excluded)))schedule();
 });
 api.permissions?.onRemoved?.addListener(()=>{cancel();void refreshCheckpoint();});
 api.permissions?.onAdded?.addListener(()=>{schedule();void refreshCheckpoint();});
 void refreshCheckpoint();
 schedule();
 return {capture,captureFor,status,states,schedule,cancel};
}
