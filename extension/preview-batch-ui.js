import {getLanguage} from './i18n.js';
const L=(zh,en)=>getLanguage()==='en'?en:zh;

export class PreviewBatchUI{
 constructor(api){
  this.api=api;this.job={state:'idle'};this.urls=[];this.request=0;
  if(!api.extension)return;
  this.panel=document.createElement('div');this.panel.className='preview-batch-progress';this.panel.hidden=true;
  this.panel.innerHTML='<div><small data-cache-usage></small><span data-batch-status role="status" aria-live="polite"></span><small data-batch-skips></small><small data-batch-note></small><progress></progress><details data-batch-failures hidden><summary></summary><ul></ul></details></div><button type="button" class="tool" data-batch-cancel></button>';
  document.querySelector('#mono-list').before(this.panel);
  this.panel.querySelector('[data-batch-cancel]').onclick=()=>this.cancel();
  chrome.runtime.onMessage.addListener((message,sender)=>{if(sender.id===chrome.runtime.id&&['preview:batchChanged','preview:cacheChanged'].includes(message.type))void this.refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void this.refresh();});
  void this.refresh();
 }
 mount(rows){
  if(!this.api.extension)return;
  this.urls=[...new Set(rows.map(row=>row.url))];
  const tools=document.querySelector('#mono-list .view-controls');
  this.button=document.createElement('button');this.button.type='button';this.button.className='tool';this.button.dataset.pm='fill-previews';
  this.button.onclick=()=>this.start();tools.prepend(this.button);this.draw();
 }
 draw(){
  if(!this.panel)return;
  const job=this.job,running=job.state==='running';
  if(this.button){
   this.button.textContent=L('补全预览','Fill previews');this.button.disabled=this.starting||running||!this.urls.length;
   this.button.title=L('在后台标签页补全当前列表的预览，无需调整窗口；Chrome 会显示调试提示条。','Fill missing previews in a background tab without resizing your window. Chrome displays a debugging banner.');
  }
  this.panel.hidden=false;
  const usage=this.usage;
  this.panel.querySelector('[data-cache-usage]').textContent=this.usageError?L('缓存占用读取失败，可到设置中清理缓存。','Could not read cache usage. You can clear the cache in Settings.'):usage?L(`预览缓存 ${(usage.bytes/1e6).toFixed(2)} / ${usage.maxBytes/1e6} MB · ${usage.count} / ${usage.maxItems} 张`,`Preview cache ${(usage.bytes/1e6).toFixed(2)} / ${usage.maxBytes/1e6} MB · ${usage.count} / ${usage.maxItems} images`):L('正在读取缓存占用…','Reading cache usage…');
  const names={running:L('正在补全','Filling previews'),complete:L('补全完成','Previews finished'),cancelled:L('已取消','Cancelled'),stopped:L('已停止','Stopped'),error:L('补全未完成','Could not finish')};
  this.panel.querySelector('[data-batch-status]').textContent=job.state==='idle'?'':`${names[job.state]} · ${L('待补全已处理','Missing previews processed')} ${job.processed||0}/${job.total||0} · ${L('已保存','Saved')} ${job.saved||0} · ${L('失败','Failed')} ${job.failed||0}`;
  const skipNames={cached:L('已有预览','Already cached'),email:L('邮箱页面','Email pages'),excluded:L('排除的网站','Excluded sites'),unsupported:L('不支持的页面','Unsupported pages')};
  this.panel.querySelector('[data-batch-skips]').textContent=!job.skipped?'':job.skipReasons?L('跳过：','Skipped: ')+Object.entries(job.skipReasons).filter(([,count])=>count>0).map(([reason,count])=>`${skipNames[reason]} ${count}`).join(' · '):L(`已跳过 ${job.skipped}（旧任务未记录原因，可重新补全查看）`,`Skipped ${job.skipped} (this older task did not record reasons; run again to see them)`);
  const reasons={capacity:L('当前列表的预览缓存已满，已保留完成结果。','The preview cache is full for this list. Completed images were kept.'),STORAGE_CAPACITY:L('存储空间不足，请在设置中清理缓存。','Storage is full. Clear cached previews in Settings.'),minimized:L('临时窗口已最小化，任务已停止；重新点击补全可继续。','The temporary window was minimized. Click Fill previews to continue.'),closed:L('临时标签页已关闭。','The temporary tab was closed.'),focused:L('临时标签页被选中，任务已停止。','The temporary tab was selected; the task stopped.'),permission:L('截图授权已撤销。','Screenshot permission was removed.'),interrupted:L('任务被中断，已保留完成结果；可重新补全。','The task was interrupted. Completed images were kept; you can start again.'),cleanup:L('临时标签页未能自动关闭，请手动关闭。','The temporary tab could not close automatically. Please close it.'),browser:L('浏览器未能完成任务，请重试。','The browser could not complete this task. Please retry.')};
  reasons.capacity=L('当前列表的预览已达到 50 MB 或 500 张上限，无法再放入下一张。已保存的预览保留，可到设置清理缓存。','This list has reached the 50 MB or 500-image limit and cannot fit another image. Saved previews remain; clear the cache in Settings.');
  reasons.changed=L('临时标签已移到其他窗口，任务已停止。','The temporary tab moved to another window; the task stopped.');
  reasons.debugger=L('调试连接未能建立或已断开，任务已停止。请关闭临时标签页的开发者工具后重试。','The debugging connection failed or was disconnected. Close DevTools for the temporary tab and try again.');
  reasons.readback=L('Chrome 未能读取截图画面，已停止后续访问。请重新补全；已有预览保留。','Chrome could not read the screenshot, so no further pages were opened. Try again; saved previews remain.');
  const host=job.currentUrl?new URL(job.currentUrl).hostname:'';
  const phase=job.phase==='loading'?L('正在加载网页','Loading page'):job.phase==='capture'?L('正在生成预览','Generating preview'):'';
  this.panel.querySelector('[data-batch-note]').textContent=running?`${[host,phase].filter(Boolean).join(' · ')} · ${L('正在后台截图，可继续浏览；请勿选中临时标签页。','Capturing in the background. You can keep browsing; leave the temporary tab inactive.')}`:reasons[job.reason]||(job.failed?L('展开失败详情可查看具体原因；已保存的预览保留。','Expand failure details to see the causes. Saved previews remain.'):'');
  const failures=job.failures||[],details=this.panel.querySelector('[data-batch-failures]');details.hidden=!failures.length;
  const labels={loadTimeout:L('网页主体加载超时','Page document loading timed out'),captureTimeout:L('浏览器截图超时','Browser screenshot timed out'),pageChanged:L('截图时页面发生变化','The page changed during capture'),image:L('截图图片处理失败或过大','The screenshot could not be processed or was too large'),storage:L('图片保存失败','Image could not be saved'),load:L('网页加载或状态读取失败','Could not load the page or read its status'),capture:L('浏览器截图失败','Browser screenshot failed'),timeout:L('超时（旧任务未区分加载与截图）','Timed out (older task did not distinguish loading from capture)')};
  details.querySelector('summary').textContent=L(`失败详情 · ${failures.length} 个${failures.length>20?'（显示最近 20 个）':''}`,`Failure details · ${failures.length}${failures.length>20?' (latest 20)':''}`);
  details.querySelector('ul').replaceChildren(...failures.slice(-20).map(failure=>{
   const item=document.createElement('li'),seconds=Number.isFinite(failure.elapsedMs)?Math.ceil(failure.elapsedMs/1000):null;
   item.textContent=`${new URL(failure.url).hostname} — ${labels[failure.reason]||labels.capture}${seconds!==null?L(`（${seconds} 秒）`,` (${seconds}s)`):''}`;
   if(failure.detail){const note=document.createElement('small');note.textContent=failure.detail;item.append(note);}return item;
  }));
  const bar=this.panel.querySelector('progress');bar.hidden=!running;bar.max=Math.max(1,job.total||0);bar.value=job.processed||0;bar.setAttribute('aria-label',L('预览补全进度','Preview progress'));
  const cancel=this.panel.querySelector('[data-batch-cancel]');cancel.hidden=!running;cancel.disabled=!!this.cancelling;cancel.textContent=L('取消','Cancel');
 }
 async refresh(){
  const request=++this.request;
  // Cache maintenance can queue behind capture; progress must remain readable.
  await Promise.all([
   this.api.send({type:'preview:batchStatus'}).then(job=>{if(request===this.request){this.job=job;this.draw();}},error=>{if(request===this.request)this.api.toast(error.message);}),
   this.api.send({type:'thumbnail:usage'}).then(usage=>{if(request===this.request){this.usage=usage;this.usageError=false;this.draw();}},()=>{if(request===this.request){this.usageError=true;this.draw();}})
  ]);
 }
 async start(){
  if(this.starting||this.job.state==='running')return;
  const urls=[...this.urls];this.starting=true;this.draw();
  try{
   if(!await chrome.permissions.request({origins:['<all_urls>']})){this.api.toast(L('未获截图授权，未打开网页。','Screenshot permission was not granted; no pages were opened.'));return;}
   const owner=await chrome.windows.getCurrent();
   await this.api.send({type:'preview:batchStart',urls,windowId:owner.id});await this.refresh();
  }catch(error){this.api.toast(error.message);}
  finally{this.starting=false;this.draw();}
 }
 async cancel(){
  this.cancelling=true;this.draw();
  try{await this.api.send({type:'preview:batchCancel'});await this.refresh();}
  catch(error){this.api.toast(error.message);}
  finally{this.cancelling=false;this.draw();}
 }
}
