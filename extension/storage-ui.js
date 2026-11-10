import {getLanguage} from './i18n.js';
const L=(zh,en)=>getLanguage()==='en'?en:zh;
export function storageUI({send,reload,toast,clearPreviews}){
 const root=document.createElement('section');root.id='storage-controls';
 document.querySelector('#recording').closest('label').after(root);
 root.innerHTML=`<h3>${L('数据与存储','Data and storage')}</h3><label>${L('记录保留时间','History retention')}<select id="retention-days"><option value="30">${L('30 天（默认）','30 days (default)')}</option><option value="14">${L('14 天','14 days')}</option><option value="7">${L('7 天','7 days')}</option></select></label><details class="settings-disclosure storage-details"><summary>${L('存储详情','Storage details')}</summary><dl id="storage-summary" role="status"><div><dt>${L('页面记录','Page records')}</dt><dd data-storage-stat="records"></dd></div><div><dt>${L('本地存储','Local storage')}</dt><dd data-storage-stat="bytes"></dd></div><div><dt>${L('最近维护','Last maintenance')}</dt><dd data-storage-stat="maintenance"></dd></div></dl><p class="help">${L('每天自动维护，关闭或休眠后下次启动补做。容量或条数上限可能缩短保留时间；当前标签分类、书签和规则保留。','Maintenance runs daily and resumes after startup or sleep. Count and size limits may shorten retention. Current tab classifications, bookmarks and rules remain.')}</p></details><div class="connection-actions"><button type="button" id="clear-preview-cache">${L('清理预览缓存','Clear preview cache')}</button><select id="cleanup-days" aria-label="${L('旧记录范围','Old history range')}"><option value="7">${L('7 天以前','Older than 7 days')}</option><option value="14">${L('14 天以前','Older than 14 days')}</option><option value="30">${L('30 天以前','Older than 30 days')}</option></select><button type="button" id="clear-old-history">${L('清理旧记录','Clear old history')}</button></div>`;
 const clear=document.querySelector('#clear-data');clear.textContent=L('清空页面记录','Clear page history');root.append(clear);
 root.querySelector('[data-storage-stat="bytes"]').previousElementSibling.textContent=L('记录与设置（含旧版预览副本）','Records & settings (includes legacy previews)');
 const cacheStat=document.createElement('div');cacheStat.innerHTML=`<dt>${L('独立预览缓存','Separate preview cache')}</dt><dd data-storage-stat="previews"></dd>`;root.querySelector('#storage-summary').append(cacheStat);
 const cleanupActions=root.querySelector('.connection-actions');
 for(const [id,controls] of [['cache',['clear-preview-cache']],['old',['cleanup-days','clear-old-history']],['all',['clear-data']]]){
  const section=document.createElement('div');section.className='storage-action';section.dataset.cleanup=id;
  section.innerHTML='<div class="storage-action-controls"></div>';
  for(const control of controls)section.lastElementChild.append(root.querySelector('#'+control));
  root.append(section);
 }
 cleanupActions.remove();
 async function refresh(config){
  if(config)root.querySelector('#retention-days').value=String(config.retentionDays||30);
  const info=await send({type:'storageInfo'});
  const usage=info.previews;
  const values={records:info.records,bytes:(info.bytes/1e6).toFixed(2)+' MB',maintenance:info.lastCleanupAt?new Date(info.lastCleanupAt).toLocaleString(getLanguage()==='en'?'en-US':'zh-CN'):'—',previews:usage?L(`${(usage.bytes/1e6).toFixed(2)} / ${usage.maxBytes/1e6} MB · ${usage.count} / ${usage.maxItems} 张`,`${(usage.bytes/1e6).toFixed(2)} / ${usage.maxBytes/1e6} MB · ${usage.count} / ${usage.maxItems} images`):'—'};
  for(const [key,value] of Object.entries(values))root.querySelector('[data-storage-stat="'+key+'"]').textContent=value;
 }
 const impact=p=>L(`将删除 ${p.records} 条页面记录${p.from?'（'+p.from+' 至 '+p.to+'）':''}。当前打开标签的分类、书签和规则保留；已删除日期无法继续浏览或补分类。继续？`,`Remove ${p.records} page records${p.from?' ('+p.from+' to '+p.to+')':''}? Current tab classifications, bookmarks and rules remain. Deleted history cannot be reopened or classified.`);
 let busy=false;
 async function clean(mode){
  if(busy)return;busy=true;
  try{
   const days=Number(root.querySelector('#cleanup-days').value),scope={mode,days};
   const p=await send({type:'cleanupPreview',...scope});
   if(!confirm(mode==='cache'?L(`清理 ${p.thumbnails} 张缓存缩略图？分类和记录不受影响。`,`Clear ${p.thumbnails} cached previews? Classifications and history remain.`):impact(p)))return;
   await send({type:'cleanup',...scope});clearPreviews();await reload();await refresh();toast(L('清理完成。','Cleanup complete.'));
  }catch(e){toast(e.message);}finally{busy=false;}
 }
 root.querySelector('#clear-preview-cache').onclick=()=>clean('cache');root.querySelector('#clear-old-history').onclick=()=>clean('old');clear.onclick=()=>clean('all');
 function translate(){
  root.querySelector('.storage-details summary').textContent=L('存储详情','Storage details');
  const stats=[L('页面记录','Page records'),L('记录与设置（含旧版预览副本）','Records & settings (includes legacy previews)'),L('最近维护','Last maintenance'),L('独立预览缓存','Separate preview cache')];
  root.querySelectorAll('#storage-summary dt').forEach((node,index)=>node.textContent=stats[index]);
  root.querySelector('#cleanup-days').setAttribute('aria-label',L('旧记录范围','Old history range'));
  root.querySelector('h3').textContent=L('数据与存储','Data and storage');
  root.querySelector('label').firstChild.textContent=L('记录保留时间','History retention');
  for(const o of root.querySelectorAll('#retention-days option'))o.textContent=o.value==='30'?L('30 天（默认）','30 days (default)'):L(`${o.value} 天`,`${o.value} days`);
  root.querySelector('p.help').textContent=L('每天自动维护，关闭或休眠后下次启动补做。容量或条数上限可能缩短保留时间；当前标签分类、书签和规则保留。','Maintenance runs daily and resumes after startup or sleep. Count and size limits may shorten retention. Current tab classifications, bookmarks and rules remain.');
  root.querySelector('#clear-preview-cache').textContent=L('清理预览缓存','Clear preview cache');root.querySelector('#clear-old-history').textContent=L('清理旧记录','Clear old history');clear.textContent=L('清空页面记录','Clear page history');
  for(const o of root.querySelectorAll('#cleanup-days option'))o.textContent=L(`${o.value} 天以前`,`Older than ${o.value} days`);
  void refresh().catch(e=>toast(e.message));
 }
 return {refresh,translate,get days(){return Number(root.querySelector('#retention-days').value);},async confirmRetention(days,current){if(days>=current)return true;return confirm(impact(await send({type:'cleanupPreview',mode:'old',days})));}};
}
