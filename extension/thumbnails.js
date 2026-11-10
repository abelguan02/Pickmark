import {previewAllowed} from './thumbnail-policy.js';
import {thumbnailCache} from './thumbnail-cache.js';
export {THUMBNAIL_KEY,PREVIEW_AUTO_KEY,previewAllowed,retainThumbnails,thumbnailTarget} from './thumbnail-policy.js';
// Manual/automatic capture uses the visible page; batch capture supplies its
// owned inactive tab and screenshot callback, sharing image and cache handling.
async function shrinkImage(image){
 if(typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined')return image;
 const raw=atob(image.split(',')[1]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
 try{
  const scale=Math.min(1,1200/bitmap.width,750/bitmap.height),canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await canvas.convertToBlob({type:'image/jpeg',quality:0.85}),encoded=new Uint8Array(await blob.arrayBuffer());
  let binary='';for(let i=0;i<encoded.length;i+=8192)binary+=String.fromCharCode(...encoded.subarray(i,i+8192));
  return 'data:image/jpeg;base64,'+btoa(binary);
 }finally{bitmap.close();}
}
export async function handleThumbnail(message,api,config,{shouldSave=()=>true,captureTimeoutMs=15000,sources=[],targetTab,signal,preserveUrls=[],capture}={}){
 const cache=thumbnailCache(api);
 if(message.type==='thumbnail:lookup'){
  if(!Array.isArray(message.urls)||message.urls.length>5000)throw Error('Invalid preview scope');
  return cache.lookup(message.urls.filter(url=>typeof url==='string'),config.excluded);
 }
 if(message.type==='thumbnail:usage')return cache.usage(config.excluded);
 const url=new URL(message.url);if(!previewAllowed(url.href,config.excluded))throw Error('此页面不允许保存预览 / Preview is excluded for this page');
 if(message.type==='thumbnail:get'){
  return cache.get(url.href,config.excluded);
 }
 if(message.type!=='thumbnail:capture')throw Error('未知预览操作');
 const query=targetTab?{active:true,windowId:targetTab.windowId}:{active:true,lastFocusedWindow:true};
 const tab=capture?await api.tabs.get(targetTab.id):(await api.tabs.query(query))[0];
 if(capture&&(tab.active||tab.windowId!==targetTab.windowId||tab.pendingUrl))throw Object.assign(Error('Preview page changed'),{code:'PAGE_CHANGED'});
 if(targetTab&&tab?.id!==targetTab.id)throw Object.assign(Error('Preview page changed'),{code:'PAGE_CHANGED'});
 if(!tab||tab.incognito||tab.url!==url.href)throw Object.assign(Error('请在该网页当前可见时，通过侧边栏保存预览'),{code:'PAGE_CHANGED'});
 let image,deadline,expired=false,abort;
 const timeoutError=()=>Object.assign(Error('Preview capture timed out'),{code:'CAPTURE_TIMEOUT'});
 try{
  // The deadline covers image production only. Storage writes must retain the
  // background queue until they settle, so a timeout cannot race a later cleanup.
  if(signal?.aborted)throw signal.reason;
  image=await Promise.race([
   (async()=>{
    const screenshot=await (capture?capture():api.tabs.captureVisibleTab(tab.windowId,{format:'jpeg',quality:85}));if(expired)throw timeoutError();
    try{return await shrinkImage(screenshot);}catch(error){throw Object.assign(Error(error.message,{cause:error}),{code:'IMAGE_PROCESSING'});}
   })(),
   new Promise((resolve,reject)=>{deadline=setTimeout(()=>{expired=true;reject(timeoutError());},captureTimeoutMs);}),
   ...(signal?[new Promise((resolve,reject)=>{abort=()=>{expired=true;reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});})]:[])
  ]);
 }
 catch(error){
  if(/permission|activeTab|all_urls/i.test(error.message))throw Object.assign(Error('请点击网页上的浏览器工具栏插件图标后重试，或在设置中开启自动预览并授权截图。 / Click the extension toolbar icon on the page, or authorize automatic previews in Settings.'),{code:'CAPTURE_PERMISSION'});
  throw error;
 }finally{clearTimeout(deadline);if(abort)signal.removeEventListener('abort',abort);}
 const current=await api.tabs.get(tab.id);
 const validTarget=capture?!current.active&&current.windowId===targetTab.windowId:current.active&&(await api.tabs.query(query))[0]?.id===tab.id;
 if(!validTarget||current.pendingUrl||current.url!==url.href||!shouldSave())throw Object.assign(Error('当前页面已变化，未保存缩略图'),{code:'PAGE_CHANGED'});
 try{await cache.put(url.href,image,{sources,excluded:config.excluded,preserveUrls,signal,shouldSave});}
 catch(error){error.previewStage='save';throw error;}
 return image;
}
