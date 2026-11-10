import {excludedUrl} from './core.js';
export const THUMBNAIL_KEY='pickmark-thumbnails-v1';
export const PREVIEW_AUTO_KEY='pickmark-auto-preview-v1';
export const PREVIEW_BYTES=50_000_000,PREVIEW_ITEMS=500,PREVIEW_AGE=7*86400000;
const mailDomains=['mail.google.com','outlook.live.com','outlook.office.com','outlook.office365.com','mail.yahoo.com','mail.proton.me','mail.qq.com','mail.163.com','mail.126.com'];
export function previewExclusion(url,excluded=[]){
 if(excludedUrl(url,[]))return 'unsupported';
 if(excludedUrl(url,mailDomains))return 'email';
 if(excludedUrl(url,excluded))return 'excluded';
 return null;
}
export const previewAllowed=(url,excluded=[])=>!previewExclusion(url,excluded);
export function thumbnailTarget(cache,url){
 return Object.hasOwn(cache,url)?url:Object.keys(cache).find(target=>cache[target].sources?.includes(url))||url;
}
export function previewSources(url,sources,excluded=[]){
 return [...new Set((Array.isArray(sources)?sources:[]).filter(source=>typeof source==='string'&&source!==url&&previewAllowed(source,excluded)).map(source=>new URL(source).href))].slice(-PREVIEW_ITEMS);
}
// The old cache is retained only as a bounded rollback snapshot for 0.1.14.
export function retainThumbnails(cache,excluded=[],now=Date.now()){
 let bytes=0;
 return Object.fromEntries(Object.entries(cache||{}).filter(([url,v])=>previewAllowed(url,excluded)&&v?.at>now-PREVIEW_AGE&&typeof v.image==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v.image)).sort((a,b)=>b[1].at-a[1].at).map(([url,v])=>{
  const sources=previewSources(url,v.sources,excluded).slice(-100);
  return [url,{image:v.image,at:v.at,...(sources.length?{sources}:{})}];
 }).filter(([url,v],i)=>{const size=url.length+v.image.length+JSON.stringify(v.sources||[]).length;if(i>=100||bytes+size>1_500_000)return false;bytes+=size;return true;}));
}
export function validPreviewEntries(entries,excluded=[],now=Date.now()){
 return entries.filter(e=>previewAllowed(e.url,excluded)&&e.at>now-PREVIEW_AGE).map(e=>({...e,sources:previewSources(e.url,e.sources,excluded)}));
}
export function planPreviewEntries(entries,incoming,{excluded=[],preserveUrls=[],now=Date.now()}={}){
 const candidates=validPreviewEntries(entries.filter(e=>e.url!==incoming?.url),excluded,now);
 if(incoming)candidates.push(incoming);
 candidates.sort((a,b)=>b.at-a.at);
 const byURL=Object.fromEntries(candidates.map(e=>[e.url,e]));
 const protectedURLs=new Set(preserveUrls.map(url=>thumbnailTarget(byURL,url)));
 if(incoming)protectedURLs.add(incoming.url);
 const kept=candidates.filter(e=>protectedURLs.has(e.url));let bytes=kept.reduce((n,e)=>n+e.bytes,0);
 if(incoming?.bytes>PREVIEW_BYTES)throw Object.assign(Error('Screenshot too large'),{code:'CAPTURE_TOO_LARGE'});
 if(kept.length>PREVIEW_ITEMS||bytes>PREVIEW_BYTES)throw Object.assign(Error('Preview cache limit reached'),{code:'PREVIEW_LIMIT'});
 for(const entry of candidates)if(!protectedURLs.has(entry.url)&&kept.length<PREVIEW_ITEMS&&bytes+entry.bytes<=PREVIEW_BYTES){kept.push(entry);bytes+=entry.bytes;}
 return kept;
}
