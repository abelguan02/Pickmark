import {excludedUrl} from './core.js';
import {writeLocal} from './storage-budget.js';
export const THUMBNAIL_KEY='pickmark-thumbnails-v1';
const MAX_BYTES=1_500_000,MAX_ITEMS=100,MAX_AGE=7*86400000;
export const PREVIEW_AUTO_KEY='pickmark-auto-preview-v1';
const mailDomains=['mail.google.com','outlook.live.com','outlook.office.com','outlook.office365.com','mail.yahoo.com','mail.proton.me','mail.qq.com','mail.163.com','mail.126.com'];
export const previewAllowed=(url,excluded=[])=>!excludedUrl(url,[...excluded,...mailDomains]);
export function retainThumbnails(cache,excluded=[],now=Date.now()){
 let bytes=0;const entries=Object.entries(cache||{}).filter(([url,v])=>{
  try{return previewAllowed(url,excluded)&&v?.at>now-MAX_AGE&&typeof v.image==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v.image);}catch{return false;}
 }).sort((a,b)=>b[1].at-a[1].at);
 return Object.fromEntries(entries.filter(([url,v],i)=>{const size=url.length+v.image.length;if(i>=MAX_ITEMS||bytes+size>MAX_BYTES)return false;bytes+=size;return true;}));
}
// Capture is explicit and restricted to the already-visible requested page.
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
export async function handleThumbnail(message,api,config,{shouldSave=()=>true,captureTimeoutMs=15000}={}){
 const stored=(await api.storage.local.get(THUMBNAIL_KEY))[THUMBNAIL_KEY]||{};
 const cache=retainThumbnails(stored,config.excluded);
 if(message.type==='thumbnail:lookup'){
  if(!Array.isArray(message.urls)||message.urls.length>5000)throw Error('Invalid preview scope');
  const urls=new Set(message.urls);return Object.fromEntries(Object.entries(cache).filter(([url])=>urls.has(url)).map(([url,v])=>[url,v.image]));
 }
 const url=new URL(message.url);if(!previewAllowed(url.href,config.excluded))throw Error('此页面不允许保存预览 / Preview is excluded for this page');
 if(message.type==='thumbnail:get'){
  return cache[url.href]?.image||null;
 }
 if(message.type!=='thumbnail:capture')throw Error('未知预览操作');
 const [tab]=await api.tabs.query({active:true,lastFocusedWindow:true});
 if(!tab||tab.incognito||tab.url!==url.href)throw Object.assign(Error('请在该网页当前可见时，通过侧边栏保存预览'),{code:'PAGE_CHANGED'});
 let image,deadline,expired=false;
 const timeoutError=()=>Object.assign(Error('Preview capture timed out'),{code:'CAPTURE_TIMEOUT'});
 try{
  // The deadline covers image production only. Storage writes must retain the
  // background queue until they settle, so a timeout cannot race a later cleanup.
  image=await Promise.race([
   (async()=>{const screenshot=await api.tabs.captureVisibleTab(tab.windowId,{format:'jpeg',quality:85});if(expired)throw timeoutError();return shrinkImage(screenshot);})(),
   new Promise((resolve,reject)=>{deadline=setTimeout(()=>{expired=true;reject(timeoutError());},captureTimeoutMs);})
  ]);
 }
 catch(error){
  if(/permission|activeTab|all_urls/i.test(error.message))throw Object.assign(Error('请点击网页上的浏览器工具栏插件图标后重试，或在设置中开启自动预览并授权截图。 / Click the extension toolbar icon on the page, or authorize automatic previews in Settings.'),{code:'CAPTURE_PERMISSION'});
  throw error;
 }finally{clearTimeout(deadline);}
 const current=await api.tabs.get(tab.id);
 const [active]=await api.tabs.query({active:true,lastFocusedWindow:true});
 if(!current.active||current.url!==url.href||active?.id!==tab.id||!shouldSave())throw Object.assign(Error('当前页面已变化，未保存缩略图'),{code:'PAGE_CHANGED'});
 cache[url.href]={image,at:Date.now()};const next=retainThumbnails(cache,config.excluded);
 if(!next[url.href])throw Object.assign(Error('缩略图过大，未保存'),{code:'CAPTURE_TOO_LARGE'});
 await writeLocal({[THUMBNAIL_KEY]:next},api);return image;
}
