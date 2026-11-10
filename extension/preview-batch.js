import {defaults,webUrl} from './core.js';
import {handleThumbnail,previewAllowed,thumbnailTarget} from './thumbnails.js';
import {previewExclusion} from './thumbnail-policy.js';
import {thumbnailCache} from './thumbnail-cache.js';
import {PREVIEW_WINDOW_KEY,PREVIEW_JOB_KEY} from './preview-session.js';
import {previewDocumentState} from './preview-document.js';

export function previewBatchWorker({api,serial,settleMs=900,pollMs=150,loadTimeoutMs=15000,captureTimeoutMs=15000}){
 const images=thumbnailCache(api);
 let progress={state:'idle'},active;
 const startup=recover();
 const snapshot=()=>structuredClone(progress);
 // Batch failures are reported through progress; do not also log them as
 // unhandled shared-queue errors (for example when the user cancels capture).
 async function queued(work){
  const result=await serial(async()=>{try{return {value:await work()};}catch(error){return {error};}});
  if(result.error)throw result.error;
  return result.value;
 }
 async function publish(){
  await api.storage.session.set({[PREVIEW_JOB_KEY]:snapshot()});
  // Panels may be closed; session storage remains the source of progress.
  api.runtime.sendMessage?.({type:'preview:batchChanged'})?.catch(()=>{});
 }
 async function closeWindow(scope){
  if(!scope)return;
  if(scope.kind==='tab'){
   const tabs=await api.tabs.query({});
   if(tabs.some(tab=>tab.id===scope.tabId))await api.tabs.remove(scope.tabId);
  }else{
   // A session left by the previous release owns a whole helper window.
   const windows=await api.windows.getAll();
   if(windows.some(w=>w.id===scope.windowId))await api.windows.remove(scope.windowId);
  }
  await api.storage.session.remove(PREVIEW_WINDOW_KEY);
 }
 function cleanup(job){
  if(!job?.scope)return;
  job.closing=true;
  return job.cleanup??=(async()=>{
   // Wait for an in-flight attach before closing its target. Closing the tab
   // also detaches the debugger, including after cancellation or attach failure.
   if(job.attaching)await job.attaching.catch(()=>{});
   await closeWindow(job.scope);
  })();
 }
 async function recover(){
  const stored=await api.storage.session.get([PREVIEW_WINDOW_KEY,PREVIEW_JOB_KEY]);
  progress=stored[PREVIEW_JOB_KEY]||{state:'idle'};
  if(stored[PREVIEW_WINDOW_KEY])await closeWindow(stored[PREVIEW_WINDOW_KEY]);
  if(progress.state==='running'){
   progress={...progress,state:'cancelled',reason:'interrupted',currentUrl:null,phase:null};await publish();
  }
 }
 function check(job){if(job.controller.signal.aborted)throw job.controller.signal.reason;}
 function wait(ms,job){
  check(job);
  return new Promise((resolve,reject)=>{
   const abort=()=>{clearTimeout(timer);reject(job.controller.signal.reason);};
   const timer=setTimeout(()=>{job.controller.signal.removeEventListener('abort',abort);resolve();},ms);
   job.controller.signal.addEventListener('abort',abort,{once:true});
  });
 }
 const loadTimeout=()=>Object.assign(Error('Page document did not become ready before the loading deadline'),{code:'LOAD_TIMEOUT'});
 async function documentReady(tab,job,remainingMs){
  // An unresponsive page must not hold the batch beyond its loading deadline.
  let timer,abort;
  try{
   check(job);
   const response=await Promise.race([
    api.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:previewDocumentState,injectImmediately:true}).then(results=>results[0]?.result),
    new Promise((resolve,reject)=>{
     timer=setTimeout(()=>reject(loadTimeout()),Math.max(0,remainingMs));
     abort=()=>reject(job.controller.signal.reason);job.controller.signal.addEventListener('abort',abort,{once:true});
    })
   ]);
   if(response?.ready!==true||response.url!==tab.url)return false;
   return true;
  }catch(error){
   check(job);
   throw error;
  }finally{clearTimeout(timer);if(abort)job.controller.signal.removeEventListener('abort',abort);}
 }
 async function loaded(job){
  const deadline=Date.now()+loadTimeoutMs;
  let completeAt=0,lastUrl;
  while(Date.now()<deadline){
   check(job);
   const tab=await api.tabs.get(job.scope.tabId);
   check(job);
   if(tab.active)throw Object.assign(Error('Preview tab selected'),{code:'focused'});
   if(tab.windowId!==job.scope.windowId)throw Object.assign(Error('Preview tab moved'),{code:'changed'});
   const ready=!tab.pendingUrl&&webUrl(tab.url)&&await documentReady(tab,job,deadline-Date.now());
   check(job);
   if(ready){
    if(lastUrl!==tab.url){completeAt=Date.now();lastUrl=tab.url;}
    if(Date.now()-completeAt>=settleMs)return tab;
   }else{completeAt=0;lastUrl=null;}
   await wait(pollMs,job);
  }
  throw loadTimeout();
 }
 async function run(job,urls,preserveUrls){
  try{
   if(!urls.length)return;
   check(job);
   // Register the blank tab before any website navigation can be collected.
   await queued(async()=>{
    check(job);
    const tab=await api.tabs.create({windowId:job.windowId,url:api.runtime.getURL('preview-loading.html'),active:false});
    job.scope={kind:'tab',windowId:tab.windowId,tabId:tab.id};
    await api.storage.session.set({[PREVIEW_WINDOW_KEY]:job.scope});
    check(job);await api.tabs.update(tab.id,{muted:true});
   });
   check(job);
   job.attaching=api.debugger.attach({tabId:job.scope.tabId},'1.3');
   try{await job.attaching;}catch(error){throw Object.assign(Error(error.message,{cause:error}),{code:'debugger'});}
   check(job);
   for(const url of urls){
    check(job);const startedAt=Date.now();progress.currentUrl=url;progress.phase='loading';await publish();
    try{
     const {config:stored}=await api.storage.local.get('config');
     const exclusion=previewExclusion(url,stored?.excluded||[]);
     if(exclusion){progress.skipped++;progress.skipReasons[exclusion]++;progress.processed++;continue;}
     check(job);await api.tabs.update(job.scope.tabId,{url});
     const tab=await loaded(job);
     check(job);progress.phase='capture';await publish();
     await queued(async()=>{
      check(job);
      const {config:stored}=await api.storage.local.get('config'),config={...defaults(),...stored};
      const skipReason=previewExclusion(url,config.excluded)||previewExclusion(tab.url,config.excluded);
      if(skipReason)throw Object.assign(Error('Page excluded'),{code:'excluded',skipReason});
      if(!await api.permissions.contains({origins:['<all_urls>']}))throw Object.assign(Error('Permission removed'),{code:'permission'});
      check(job);
      // Recheck the temporary tab after waiting for the shared write queue.
      const current=await api.tabs.get(tab.id);
      if(current.active)throw Object.assign(Error('Preview tab selected'),{code:'focused'});
      if(current.windowId!==job.scope.windowId)throw Object.assign(Error('Preview tab moved'),{code:'changed'});
      if(current.pendingUrl||current.url!==tab.url||!await documentReady(current,job,loadTimeoutMs))throw Object.assign(Error('Preview page changed'),{code:'PAGE_CHANGED'});
      check(job);
      await handleThumbnail({type:'thumbnail:capture',url:tab.url},api,config,{
       targetTab:tab,signal:job.controller.signal,shouldSave:()=>!job.controller.signal.aborted,
       capture:async()=>{
        try{const shot=await api.debugger.sendCommand({tabId:tab.id},'Page.captureScreenshot',{format:'jpeg',quality:85,fromSurface:true,captureBeyondViewport:false});return 'data:image/jpeg;base64,'+shot.data;}
        catch(error){if(/not attached|detached|target closed/i.test(error.message))error.code='debugger';throw error;}
       },
       captureTimeoutMs,sources:tab.url===url?[]:[url],preserveUrls
      });
     });
     progress.saved++;preserveUrls.push(url);
     if(job.controller.signal.aborted){progress.processed++;break;}
     api.runtime.sendMessage?.({type:'preview:changed',url})?.catch(()=>{});
    }catch(error){
     check(job);
     if(['PREVIEW_LIMIT','STORAGE_CAPACITY','focused','changed','debugger','permission','CAPTURE_PERMISSION'].includes(error.code)){
      progress.state='stopped';progress.reason=error.code==='PREVIEW_LIMIT'?'capacity':error.code==='CAPTURE_PERMISSION'?'permission':error.code;break;
     }
     if(error.code==='excluded'){progress.skipped++;progress.skipReasons[error.skipReason]++;}
     else{
      const stage=error.previewStage||progress.phase;
      const reason=({LOAD_TIMEOUT:'loadTimeout',CAPTURE_TIMEOUT:'captureTimeout',PAGE_CHANGED:'pageChanged',CAPTURE_TOO_LARGE:'image',IMAGE_PROCESSING:'image'})[error.code]||(stage==='save'?'storage':stage==='loading'?'load':'capture');
      const detail=String(error.message||error).replace(/https?:\/\/[^\s"'<>]+/g,value=>{try{return new URL(value).origin;}catch{return '[URL]';}}).slice(0,300);
      progress.failed++;progress.failures.push({url,reason,stage,elapsedMs:Date.now()-startedAt,detail});
      if(stage==='capture'&&/image readback failed/i.test(error.message)){
       progress.processed++;progress.state='stopped';progress.reason='readback';break;
      }
     }
    }
    progress.processed++;await publish();
   }
  }catch(error){
   if(!job.controller.signal.aborted){progress.state='error';progress.reason=error.code==='debugger'?'debugger':'browser';progress.message=error.message;}
  }finally{
   try{await cleanup(job);}catch(error){progress.state='error';progress.reason='cleanup';progress.message=error.message;}
   if(progress.state==='running')progress.state='complete';
   progress.currentUrl=null;progress.phase=null;
   await publish();active=null;
  }
 }
 async function start({urls,windowId}){
  await startup;
  if(active)throw Error('预览补全仍在进行，请稍候 / Preview task is still running');
  const prior=(await api.storage.session.get(PREVIEW_WINDOW_KEY))[PREVIEW_WINDOW_KEY];
  if(prior)await closeWindow(prior);
  if(!Array.isArray(urls)||urls.length>5000||urls.some(url=>typeof url!=='string'||!webUrl(url)))throw Error('Invalid preview scope');
  if(!await api.permissions.contains({origins:['<all_urls>']}))throw Error('请先授权截图 / Authorize screenshots first');
  const data=await api.storage.local.get(['config']),excluded=data.config?.excluded||[];
  const cache=await images.list(excluded),scope=[...new Set(urls.map(url=>new URL(url).href))];
  const preserved=scope.filter(url=>cache[thumbnailTarget(cache,url)]);
  const missing=scope.filter(url=>previewAllowed(url,excluded)&&!cache[thumbnailTarget(cache,url)]);
  if(missing.length&&(!Number.isSafeInteger(windowId)||windowId<0))throw Error('无法确定当前窗口，请刷新拾签后重试。 / Could not determine this window. Reload Pickmark and try again.');
  const skipReasons={cached:0,email:0,excluded:0,unsupported:0};
  for(const url of scope){const cause=previewExclusion(url,excluded);if(cause)skipReasons[cause]++;else if(cache[thumbnailTarget(cache,url)])skipReasons.cached++;}
  progress={state:'running',total:missing.length,processed:0,saved:0,failed:0,skipped:scope.length-missing.length,skipReasons,failures:[],currentUrl:null,phase:null};
  const job={controller:new AbortController(),windowId};active=job;
  try{await publish();}catch(error){active=null;throw error;}
  void run(job,missing,preserved).catch(error=>{console.error(error);active=null;});
  return snapshot();
 }
 async function cancel(reason='user'){
  await startup;
  if(!active||active.controller.signal.aborted)return snapshot();
  const job=active;job.controller.abort(Error('Preview batch cancelled'));
  progress.state='cancelled';progress.reason=reason;progress.currentUrl=null;progress.phase=null;
  await publish();
  // Closing also releases a browser capture that stopped producing pixels.
  await cleanup(job);
  return snapshot();
 }
 api.tabs.onRemoved?.addListener(id=>{if(active?.scope?.tabId===id&&!active.closing)void cancel('closed').catch(console.error);});
 api.tabs.onActivated?.addListener(({tabId})=>{if(active?.scope?.tabId===tabId&&!active.closing)void cancel('focused').catch(console.error);});
 api.tabs.onDetached?.addListener(id=>{if(active?.scope?.tabId===id&&!active.closing)void cancel('changed').catch(console.error);});
 api.debugger?.onDetach.addListener(({tabId})=>{if(active?.scope?.tabId===tabId&&!active.closing)void cancel('debugger').catch(console.error);});
 api.permissions?.onRemoved?.addListener(()=>{if(active)void cancel('permission').catch(console.error);});
 return {start,cancel,async status(){await startup;return snapshot();},get running(){return !!active;}};
}
