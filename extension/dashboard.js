import {storageUI} from './storage-ui.js';
import {cleanupSnapshot} from './cleanup.js';
import {THUMBNAIL_KEY} from './thumbnails.js';
import {groupIcon,groupIconChoices,groupIconLabel} from './group-icons.js';
import {t,getLanguage,setLanguage,LANGUAGE_KEY,staticTranslations,workspaceLabel,preferredLanguage,systemLanguage} from './i18n.js';
import {recordsChanged,withTabTargets} from './dashboard-sync.js';
import {preferenceText,parseRuleBackup,mergeRuleBackup,exportRuleBackup} from './rule-transfer.js';
import {organizeOpenTabs} from './organize-workflow.js';
import {organizeHistory} from './history-workflow.js';
import {historyCandidates,classificationContext} from './core.js';
import {removeReadingStatus,UNGROUPED,normalizeDomain,excludedUrl,dayKey,defaults,settingsSignature,assertSettingsCurrent,updateRules,orderedWorkspaces,reorderByKey,manageWorkspace,applyLocalRules} from './core.js';
import {testConnection} from './ai.js';
import {PROVIDERS,providerFor} from './providers.js';
import {iconButton,fillWorkspaceSelect,selectedWorkspace,sortableHandle} from './controls.js';
import {demoState} from './demo.js';
import {OffsetUI} from './offset-ui.js';
let mono;
const storagePanel=storageUI({send,reload:load,toast,clearPreviews:()=>{mono?.thumbnails.clear();mono?.clearPreview();}});
const $=s=>document.querySelector(s);
const translateStatic=staticTranslations(document.documentElement);translateStatic();
const isExtension=!!globalThis.chrome?.runtime?.id;
let state,view='workspace',searchOpen=false,suggestions=[],pending=[],busy=false,editing=null,autoTimer,autoError='',retryAfter=0;
let autoDirty=false,setupIntent=false;
let historyJob=null,historyProgressDay='';
const isSidePanel=isExtension&&new URLSearchParams(location.search).get("surface")==="sidepanel";
let resumeDay=dayKey(new Date().setDate(new Date().getDate()-1));
let calendarDay=dayKey(),resumeDateChosen=false,settingsBase;
let demoPreference,importBackup=null,restoring=false;
let demo=demoState();
// Old preview caches may contain private development examples. Never load them.
if(!isExtension)try {
 const saved=JSON.parse(localStorage.getItem('atlas-demo'));
 if(saved?.demoVersion===demo.demoVersion&&saved.records&&saved.config)demo=saved;
 else {
  localStorage.setItem('atlas-demo',JSON.stringify(demo));
  for(const key of ['atlas-card-layout-v1','atlas-card-layout-classic-v1'])localStorage.removeItem(key);
 }
}catch{}
const cleanedDemo=removeReadingStatus(demo.records);
if(cleanedDemo.some((r,i)=>r!==demo.records[i])){demo.records=cleanedDemo;try{localStorage.setItem('atlas-demo',JSON.stringify(demo));}catch{}}
let editingRule=null,sorting=false,sortSaving=false,connectionController=null,settingsModels={};
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,5500);}
async function send(message){
 if(isExtension){const response=await chrome.runtime.sendMessage({...message,locale:getLanguage()});if(response.error)throw new Error(response.error);return response.value;}
 if(message.type==='get')return {...structuredClone(demo),preference:demoPreference??demo.config.savedPreference??''};
 if(message.type==='preference'){demoPreference=preferenceText(message.value);demo.config.savedPreference=message.save?demoPreference:'';demo.config.savePreference=!!message.save;}
 if(message.type==='importRules'){const result=mergeRuleBackup(demo.config.rules,message.backup);demo.config.rules=result.rules;localStorage.setItem('atlas-demo',JSON.stringify(demo));return {added:result.added,skipped:result.skipped};}
 if(message.type==='patch'&&typeof message.value.group==='string'&&message.value.group.trim()&&message.value.group.length<=40){Object.assign(demo.records.find(r=>r.id===message.id),{group:message.value.group.trim(),snapshotGroup:message.value.group.trim(),manualGroup:true,ruleMatched:false});}
 if(message.type==='settings'){assertSettingsCurrent(demo.config,message.expectedSettings);demo.config={...demo.config,...message.value,providerModels:{...demo.config.providerModels,[demo.config.provider||'deepseek']:demo.config.model,[message.value.provider||demo.config.provider||'deepseek']:message.value.model}};demo.records=demo.records.filter(r=>!excludedUrl(r.url,demo.config.excluded));demo.tabs=demo.tabs.filter(t=>!excludedUrl(t.url,demo.config.excluded));Object.assign(demo,cleanupSnapshot(demo,demo.tabs));}
 if(['rule','deleteRule','reorderRules'].includes(message.type)) demo.config.rules=updateRules(demo.config.rules,message);
 if(message.type==='applyRules'){const result=applyLocalRules(demo.records,demo.config.rules,message.ids);demo.records=result.records;localStorage.setItem('atlas-demo',JSON.stringify(demo));return {matched:result.matched};}
 if(message.type==='workspace')demo=manageWorkspace(demo,message);
 if(message.type==='reorderWorkspaces')demo.config.workspaceOrder=reorderByKey(orderedWorkspaces(demo.records,demo.config,true),message.source,message.target);
 if(message.type==='restoreDay')throw new Error(t('网页预览只展示示例；加载扩展后可恢复真实标签。'));
 if(message.type==='key')toast(t('示例模式不保存 API Key。请加载 Chrome 扩展后配置。'));
 if(message.type==='storageInfo')return {records:demo.records.length,bytes:new TextEncoder().encode(JSON.stringify(demo)).length,lastCleanupAt:demo.lastCleanupAt,retentionDays:demo.config.retentionDays||30};
 if(message.type==='cleanupPreview'||message.type==='cleanup'){
  const patch=message.mode==='cache'?{[THUMBNAIL_KEY]:{}}:cleanupSnapshot(demo,demo.tabs,{mode:message.mode,days:message.days});
  const kept=new Set((patch.records||demo.records).map(r=>r.id)),removed=demo.records.filter(r=>!kept.has(r.id));
  const result={records:removed.length,thumbnails:Object.keys(demo[THUMBNAIL_KEY]||{}).length,from:removed.map(r=>r.day).sort()[0],to:removed.map(r=>r.day).sort().at(-1)};
  if(message.type==='cleanup'){Object.assign(demo,patch);localStorage.setItem('atlas-demo',JSON.stringify(demo));}
  return result;
 }
 if(message.type==='clear'){demo.records=[];demo.tabs=[];demo.config.recording=false;}
 localStorage.setItem('atlas-demo',JSON.stringify(demo));return true;
}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(error){toast(error.message||t('操作失败，请重试。'));}};}
async function load(){state=await send({type:'get'});state.config={...defaults(),...state.config};render();scheduleAuto();}
function scoped(){
 const urls=new Set(state.tabs.map(t=>t.url));
 if(view==='workspace'&&state.storageWarning){const latest=new Map();for(const r of state.records)if(urls.has(r.url)&&(!latest.has(r.url)||latest.get(r.url).day<=r.day))latest.set(r.url,r);return withTabTargets([...latest.values()],state.tabs);}
 const rows=state.records.filter(r=>view==='workspace'?r.day===state.today&&urls.has(r.url):r.day===$('#day').value).map(r=>view!=='workspace'?{...r,group:r.snapshotGroup||r.group}:r);
 return view==='workspace'?withTabTargets(rows,state.tabs):rows;
}
function visible(){const query=$('#search').value.trim().toLowerCase();const rows=scoped().filter(r=>`${r.title} ${r.domain} ${workspaceLabel(r.group)}`.toLowerCase().includes(query));return mono?mono.filterRows(rows):rows;}
function workspaceNames(){return orderedWorkspaces(state.records,state.config);}
function updateCalendar(){
 const today=dayKey();
 $('#day').max=today;
 if(today===calendarDay)return false;
 calendarDay=today;
 if(!resumeDateChosen)resumeDay=dayKey(new Date().setDate(new Date().getDate()-1));
 if(view!=='workspace')$('#day').value=resumeDay;
 return true;
}
function render(){
 updateCalendar();
 if(sorting||sortSaving)return;
 const records=scoped(),rows=visible(),searching=!!$('#search').value.trim();
 const groups=orderedWorkspaces([...state.records,...records],state.config,true).filter(g=>records.some(r=>r.group===g));
 $('#demo-banner').hidden=isExtension;
 $('#page-title').textContent=view==='history'?t('继续浏览'):t('工作区');
 $('#quicklinks').classList.toggle('active',view==='workspace');$('#quicklinks').setAttribute('aria-pressed',view==='workspace');
 for(const [id,name] of [['continue-browsing','history']]){const button=$('#'+id);button.classList.toggle('active',view===name);button.setAttribute('aria-pressed',view===name);}
 $('#workspace-tools').hidden=view!=='workspace';
 $('#ai-state').hidden=!isExtension||(!state.hasKey&&!busy);
 $('#ai-onboarding').hidden=view!=='workspace'||!isExtension||state.hasKey;
 $('#ai-recovery').hidden=view!=='workspace'||!isExtension||!state.hasKey||!autoError||busy;
 $('#organize-progress').hidden=view!=='workspace'||!$('#organize-progress').textContent;
 $('#search-toolbar').hidden=!searchOpen;$('#search-toggle').setAttribute('aria-expanded',!$('#search-toolbar').hidden);
 $('#summary').textContent=t`${records.length} 个标签 · ${groups.length} 个工作区`;
 $('#ai-state').textContent=busy?t('✧ 正在归位…'):autoError?t('自动分类未完成'):!isExtension?'':!state.config.recording?t('记录已暂停'):!state.hasKey?t('AI 未配置'):t('自动整理已开启');
 $('#ai-state').title=autoError || t('新增标签先匹配规则；配置 AI 后，工作区可见时处理需要分类的页面。');
 $('#day').hidden=view==='workspace';$('#recap').hidden=view==='workspace';$('#restore-day').hidden=view!=='history';
 $('#recap-title').textContent=$('#day').value===dayKey(new Date().setDate(new Date().getDate()-1))?t('昨天留下的页面'):t('那天留下的页面');
 $('#restore-day').disabled=restoring||!rows.length;
 $('#restore-day').textContent=restoring?t('正在恢复…'):t`重新打开这些标签（${rows.length}）`;
 const historyIds=new Set(rows.map(r=>r.id));
 const historyCount=historyCandidates(state.records,resumeDay,state.config).filter(r=>historyIds.has(r.id)).length;
 $('#organize-history').hidden=view!=='history';$('#organize-history').disabled=busy||restoring||!historyCount;
 $('#organize-history').textContent=t`补分类（${historyCount}）`;
 $('#history-progress').hidden=view!=='history'||resumeDay!==historyProgressDay||!$('#history-progress').textContent;
 $('#recap-summary').textContent=records.length?t`${$('#day').value} · ${records.length} 个页面 · 保存当天收集的页面及最后分组，包含已关闭标签；保留最近 30 天 / 最多 5,000 条。`:t('这一天没有留下记录。插件只能找回开始记录之后、尚未过期的页面。');
 $('#search').placeholder=t('搜索当前清单的标题、域名或分组…');
 $('#view-note').textContent=view==='workspace'?t('当前打开 · 点击回到标签页'):isExtension?t('包含已关闭页面 · 点击可重新打开'):t('示例标题 · 无真实阅读记录');

 $('#reorganize').hidden=view!=='workspace';
 $('#rule-count').textContent=suggestions.length?t` · ${suggestions.length} 条待确认`:'';
 mono?.render();
}
function showTab(item){
 editing=item;$('#tab-title').textContent=item.title;$('#tab-domain').textContent=item.domain;
 fillWorkspaceSelect($('#tab-group'),$('#tab-new-group'),workspaceNames(),item.group);
 $('#tab-dialog').showModal();
}
let workspaceEdit=null;
function renameWorkspace(name,copy){
 if(copy.querySelector('input'))return;
 const label=copy.querySelector('.workspace-name'),input=el('input','workspace-name-input');input.value=name;input.maxLength=40;input.setAttribute('aria-label',t('新名称'));label.replaceWith(input);input.focus();input.select();
 const revision=state.config.workspaceRevision||0;let saving=false;
 const cancel=()=>{if(!saving){input.replaceWith(label);label.focus();}};
 input.onkeydown=safe(async e=>{
  if(e.key==='Escape'){e.preventDefault();cancel();return;}if(e.key!=='Enter'||saving)return;e.preventDefault();
  const target=input.value.trim();if(target===name){cancel();return;}saving=true;input.disabled=true;
  try{await send({type:'workspace',action:'rename',name,target,expectedRevision:revision});suggestions=suggestions.map(r=>r.group===name?{...r,group:target}:r);await load();renderWorkspaces();}
  finally{saving=false;input.disabled=false;}
 });
 input.onblur=cancel;
}
function chooseWorkspaceIcon(name){
 const dialog=$('#workspace-icon-dialog'),list=$('#workspace-icon-options');list.replaceChildren();
 const revision=state.config.workspaceRevision||0;
 groupIconChoices.forEach(value=>{
  const button=el('button','workspace-icon-choice');button.type='button';button.innerHTML=groupIcon(name,value);
  button.append(el('span','',groupIconLabel(value,getLanguage())));button.setAttribute('aria-pressed',String((state.config.workspaceIcons?.[name]||'auto')===value));
  button.onclick=safe(async()=>{await send({type:'workspace',action:'icon',name,icon:value,expectedRevision:revision});dialog.close();await load();renderWorkspaces();});list.append(button);
 });dialog.showModal();
}

function renderWorkspaces(){
 const list=$('#workspace-list');list.replaceChildren();
 for(const name of workspaceNames()){
  const row=el('div','rule-row'),copy=el('div','rule-copy');
  row.dataset.sortKey=name;
  const handle=iconButton('grip',t`排序分类：${name}`,'drag-handle');
  row.append(handle);
  sortableHandle({handle,item:row,container:list,selector:'.rule-row[data-sort-key]',onBusy:value=>sorting=value,onMove:safe(async(source,target)=>{
   if(sortSaving)return;sortSaving=true;
   try{await send({type:'reorderWorkspaces',source,target});await load();renderWorkspaces();}
   finally{sortSaving=false;}
   [...list.children].find(item=>item.dataset.sortKey===source)?.querySelector('.drag-handle')?.focus();
   toast(t('分类顺序已保存。'));
  })});
  const records=state.records.filter(r=>r.group===name),count=new Set(records.map(r=>r.url)).size,rules=state.config.rules.filter(r=>r.group===name).length;
  const title=el('button','workspace-name');title.type='button';title.append(el('strong','',workspaceLabel(name)));title.title=t('重命名');title.onclick=()=>renameWorkspace(name,copy);
  const badge=el('span','workspace-icon');badge.innerHTML=groupIcon(name,state.config.workspaceIcons?.[name]);row.append(badge);
  copy.append(title,el('small','',t`${count} 个页面 · ${rules} 条规则${count?'':t(' · 空分类')}`));row.append(copy);
  const menu=el('details','workspace-menu'),summary=el('summary','','···'),actions=el('div','workspace-menu-actions');
  summary.setAttribute('aria-label',getLanguage()==='en'?'Category actions: '+name:'分类操作：'+name);menu.append(summary,actions);
  menu.addEventListener('toggle',()=>{if(menu.open)list.querySelectorAll('details').forEach(other=>{if(other!==menu)other.open=false;});});
  menu.onkeydown=e=>{if(e.key==='Escape'){menu.open=false;summary.focus();}};
  for(const action of ['rename','icon','merge','delete']){
   const label=getLanguage()==='en'?{rename:'Rename',icon:'Change icon',merge:'Merge into…',delete:'Delete'}[action]:{rename:'重命名',icon:'更换图标',merge:'合并到…',delete:'删除'}[action];
   const button=el('button','',label);button.type='button';button.dataset.workspaceAction=action;
   button.onclick=()=>{
    menu.open=false;
    if(action==='rename'){renameWorkspace(name,copy);return;}
    if(action==='icon'){chooseWorkspaceIcon(name);return;}
    workspaceEdit={name,action:'delete',merge:action==='merge',expectedRevision:state.config.workspaceRevision||0};
    $('#workspace-edit-title').textContent=`${label}「${name}」`;
    $('#workspace-impact').textContent=action==='merge'?(getLanguage()==='en'?'Move pages, history and rules into the selected category, then remove this category. Manual classifications remain protected.':'将页面、历史记录和规则合并到目标分类，再移除当前分类；人工调整仍受保护。'):(getLanguage()==='en'?'Remove this category. Its pages and rules move to Unclassified; no pages are deleted or closed.':'移除此分类，页面和规则归入待整理；不会删除记录或关闭页面。');
    $('#workspace-rename-label').hidden=true;$('#workspace-rename').required=false;
    $('#workspace-target-label').hidden=action!=='merge';
    const targets=workspaceNames().filter(n=>n!==name);
    $('#workspace-target').replaceChildren(...(action==='merge'?targets.map(n=>new Option(workspaceLabel(n),n)):[new Option(t('待整理（系统分类）'),UNGROUPED)]));
    $('#workspace-edit-save').disabled=action==='merge'&&!targets.length;
    $('#workspace-edit-save').textContent=label;$('#workspace-edit-dialog').showModal();
   };actions.append(button);
  }
  row.append(menu);
  list.append(row);
 }
 if(!list.children.length)list.append(el('p','help',t('还没有分类，可在下方新建。')));
}
function showWorkspaces(){$('#workspace-create').reset();renderWorkspaces();mono.openPanel('workspaces-dialog','manage');}
$('#workspaces-button').onclick=safe(async()=>{const source=mono.mode,navigation=mono.navigationId;await load();if(source!==mono.mode||navigation!==mono.navigationId)return;showWorkspaces();});
$('#workspace-create').onsubmit=safe(async event=>{
 event.preventDefault();await send({type:'workspace',action:'create',name:$('#workspace-name').value,expectedRevision:state.config.workspaceRevision||0});
 await load();$('#workspace-create').reset();renderWorkspaces();toast(t('分类已创建。'));
});
$('#workspace-edit-form').onsubmit=safe(async event=>{
 event.preventDefault();const edit=workspaceEdit,target=edit.action==='rename'?$('#workspace-rename').value.trim():$('#workspace-target').value;
 await send({type:'workspace',...edit,target});
 suggestions=suggestions.map(r=>r.group===edit.name?{...r,group:target}:r);
 $('#workspace-edit-dialog').close();await load();renderWorkspaces();toast(edit.action==='delete'?t('分类已删除，标签和规则已迁移。'):t('分类名称已更新。'));
});
function renderRules(){
 $('#saved-rule-total').textContent=String(state.config.rules.length);
 $('#rule-sort-hint').hidden=state.config.rules.length<2;
 $('#saved-rules').replaceChildren();
 if(!state.config.rules.length){const empty=el('div','rules-empty');empty.append(el('strong','',t('尚未添加规则')),el('p','',t('例如：github.com → 开发与技术。')));$('#saved-rules').append(empty);}
 state.config.rules.forEach(rule=>{
  const row=el('div','rule-row');row.dataset.sortKey=rule.keyword;
  const handle=iconButton('grip',t`排序规则：${rule.keyword}`,'drag-handle');row.append(handle);
  const text=el('div','rule-copy');text.append(el('strong','',rule.keyword),el('small','',workspaceLabel(rule.group)));row.append(text);
  const edit=iconButton('edit',t`编辑规则：${rule.keyword}`);edit.onclick=()=>{
   editingRule={...rule};$('#rule-keyword').value=rule.keyword;
   fillWorkspaceSelect($('#rule-group'),$('#rule-new-group'),workspaceNames(),rule.group);
   $('#rule-save').textContent=t('保存修改');$('#rule-cancel').hidden=false;$('#rule-editing').hidden=false;$('#rule-keyword').focus();
  };
  const remove=iconButton('trash',t`删除规则：${rule.keyword}`,'delete-icon');remove.onclick=safe(async()=>{
   await send({type:'deleteRule',base:rule});if(editingRule?.keyword===rule.keyword)resetRuleForm();await load();renderRules();
  });row.append(edit,remove);$('#saved-rules').append(row);
  const expected=structuredClone(state.config.rules);
  sortableHandle({handle,item:row,container:$('#saved-rules'),selector:'.rule-row',onBusy:value=>sorting=value,onMove:safe(async(keyword,target)=>{
   if(sortSaving)return;sortSaving=true;
   try{await send({type:'reorderRules',keyword,target,expected});}finally{sortSaving=false;}
   await load();renderRules();[...$('#saved-rules').children].find(e=>e.dataset.sortKey===keyword)?.querySelector('.drag-handle')?.focus();toast(t('规则优先级已保存。'));
  })});
 });
 $('#suggested-rules').replaceChildren();
 $('#suggested-rules').closest('.rule-suggestions').hidden=!suggestions.length;
 suggestions.forEach((rule,index)=>{const row=el('div','rule-row');row.append(el('span','',`${rule.keyword} → ${rule.group}`));const accept=el('button','',t('确认保存'));accept.onclick=safe(async()=>{await send({type:'rule',value:rule});suggestions.splice(index,1);await load();renderRules();});const dismiss=el('button','',t('忽略'));dismiss.onclick=()=>{suggestions.splice(index,1);renderRules();};row.append(accept,dismiss);$('#suggested-rules').append(row);});
}
function keyHelp(){
 const id=$('#ai-provider').value,info=providerFor(id);
 const hasKey=state.keyProviders?.includes(id) || (id===state.config.provider&&state.hasKey);
 $('#api-key-label').textContent=`${t(info.name)} API Key`;
 $('#api-key').placeholder=hasKey?t('已保存，留空保留。'):'API Key';
 $('#provider-endpoint').textContent=t`连接到 ${new URL(info.url).hostname}`;
}
// Choices are local presets/saved models, not an account availability claim.
function modelChoices(){
 let choice=$('#model-choice');
 if(!choice.dataset.bound){
  choice.dataset.bound='true';
  choice.onchange=()=>{
   const custom=choice.value==='';$('#model').hidden=!custom;
   if(custom){$('#model').focus();return;}
   $('#model').value=choice.value;$('#model').dispatchEvent(new Event('input'));
  };
 }
 const current=$('#model').value,info=providerFor($('#ai-provider').value);
 const values=[...new Set([info.model,settingsModels[info.id],current].filter(Boolean))];
 const wasCustom=choice.dataset.provider===info.id&&choice.value==='';
 choice.replaceChildren(...values.map(value=>new Option(value,value)),new Option(t('自定义模型…'),''));
 choice.value=wasCustom?'':current;choice.dataset.provider=info.id;
 $('#model').hidden=choice.value!=='';
 choice.setAttribute('aria-label',t('模型名称'));$('#model').setAttribute('aria-label',t('自定义模型名称'));
 $('#model-help').textContent=t('模型可用性取决于供应商账户，请通过测试连接确认。');
}
function resetConnection(){
 connectionController?.abort();connectionController=null;
 $('#test-connection').disabled=false;$('#test-connection').textContent=t('测试连接');
 $('#connection-result').textContent='';
 $('#connection-result').removeAttribute('data-state');
}
function showSettings(startOrganizing=false){
 settingsBase=settingsSignature(state.config);
 setupIntent=startOrganizing===true;
 $('#save-settings').textContent=setupIntent?t('保存并开始整理'):t('保存设置');
 settingsModels={...state.config.providerModels,[state.config.provider]:state.config.model};
 $('#ai-provider').replaceChildren(...PROVIDERS.map(p=>new Option(t(p.name),p.id)));$('#ai-provider').value=state.config.provider;
 $('#api-key').value='';keyHelp();resetConnection();
 $('#model').value=state.config.model;modelChoices();$('#recording').checked=state.config.recording;$('#excluded').value=state.config.excluded.join('\n');mono.openPanel('settings-dialog','settings');void storagePanel.refresh(state.config).catch(e=>toast(e.message));
}
$('#ai-provider').onchange=()=>{resetConnection();$('#api-key').value='';$('#model').value=settingsModels[$('#ai-provider').value]||providerFor($('#ai-provider').value).model;modelChoices();keyHelp();};
$('#model').oninput=()=>{settingsModels[$('#ai-provider').value]=$('#model').value;resetConnection();};
$('#api-key').oninput=resetConnection;
$('#settings-dialog').addEventListener('close',()=>{resetConnection();$('#api-key').value='';});
$('#test-connection').onclick=safe(async()=>{
 if(!isExtension){resetConnection();$('#connection-result').textContent=t('示例预览不保存 Key、不发送请求；请在 Chrome 扩展中测试真实连接。');return;}
 resetConnection();const controller=new AbortController();connectionController=controller;
 const timeout=setTimeout(()=>controller.abort(new DOMException('Timeout','TimeoutError')),30000);
 $('#test-connection').disabled=true;$('#test-connection').textContent=t('正在测试…');$('#connection-result').textContent=t('正在检查 Key、模型与 JSON 响应…');
 try{
  const id=$('#ai-provider').value,model=$('#model').value.trim(),key=$('#api-key').value.trim()||await send({type:'getKey',provider:id});
  if(controller.signal.aborted)return;
  const result=await testConnection(id,key,model,controller.signal);
  if(connectionController!==controller)return;
  $('#connection-result').textContent=t`连接成功 · ${t(providerFor(id).name)} · ${model} · ${(result.latency/1000).toFixed(1)} 秒。保存后用于分类。`;$('#connection-result').dataset.state='success';
 }catch(error){if(connectionController===controller){$('#connection-result').textContent=error.message;$('#connection-result').dataset.state='error';}}
 finally{clearTimeout(timeout);if(connectionController===controller){connectionController=null;$('#test-connection').disabled=false;$('#test-connection').textContent=t('测试连接');}}
});
const syncColorMode=()=>{$('#color-mode').value=window.atlasColorMode.value;document.querySelectorAll('[data-color-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.colorChoice===window.atlasColorMode.value)));};
syncColorMode();
document.querySelectorAll('[data-color-choice]').forEach(button=>button.onclick=()=>{if(!window.atlasColorMode.set(button.dataset.colorChoice))toast(t('颜色模式已切换，但浏览器无法保存此偏好。'));});
window.addEventListener('atlas-color-mode-change',syncColorMode);
$('#color-mode').onchange=()=>{
 if(!window.atlasColorMode.set($('#color-mode').value))toast(t('颜色模式已切换，但浏览器无法保存此偏好。'));
};
function switchView(next){view=next;$('#search').value='';if(next!=='workspace')$('#day').value=resumeDay;render();scheduleAuto();}
$('#quicklinks').onclick=safe(async()=>{await load();switchView('workspace');});
$('#settings-shortcut').onclick=safe(async()=>{const source=mono.mode,navigation=mono.navigationId;await load();if(source!==mono.mode||navigation!==mono.navigationId)return;showSettings();});
$('#configure-ai').onclick=()=>showSettings(true);
$('#ai-recovery').onclick=()=>showSettings(true);
$('#onboarding-rules').onclick=()=>$('#rules-button').click();
$('#brand-home').title=isSidePanel?t('在新标签页打开完整面板'):t('返回工作区');
$('#brand-home').setAttribute('aria-label',$('#brand-home').title);
$('#panel-expand').hidden=!isSidePanel;
$('#brand-home').onclick=safe(async()=>{
 if(isSidePanel)await chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')});
 else {await load();switchView('workspace');}
});
$('#search-toggle').onclick=()=>{searchOpen=!searchOpen;if(!searchOpen)$('#search').value='';render();if(searchOpen)$('#search').focus();};
$('#continue-browsing').onclick=safe(async()=>{await load();switchView('history');});
$('#restore-day').onclick=safe(async()=>{
 if(restoring)return;restoring=true;const rows=visible(),day=$('#day').value;render();
 try{const result=await send({type:'restoreDay',day,ids:rows.map(r=>r.id)});await load();toast(t`已恢复 ${result.opened} 个标签，跳过 ${result.existing} 个已打开标签${result.failed?t`，${result.failed} 个失败，可重试`:''}。`);}finally{restoring=false;render();}
});
$('#organize-history').onclick=safe(async()=>{
 if(busy||view!=='history'||mono?.siteGrouping)return;
 if(!isExtension){toast(t('示例预览不调用 AI；加载扩展后可补分类历史页面。'));return;}
 await load();
 if(!state.config.recording){toast(t('记录已暂停，请先开启记录再补分类。'));return;}
 const visibleIds=new Set(visible().map(r=>r.id));
 const rows=historyCandidates(state.records,resumeDay,state.config).filter(r=>visibleIds.has(r.id));
 if(!rows.length)return;
 historyJob={day:resumeDay,ids:rows.map(r=>r.id),expectedContext:classificationContext(state.config,state.preference||''),hasKey:state.hasKey};
 $('#history-summary').textContent=t`${historyJob.day} · ${rows.length} 个待整理页面 · ${t(providerFor(state.config.provider).name)} / ${state.config.model}`;
 $('#history-preview').replaceChildren(...rows.map(r=>{const line=el('div');line.append(el('strong','',r.title),el('small','',r.domain));return line;}));
 $('#history-use-ai').checked=state.hasKey;$('#history-use-ai').disabled=!state.hasKey;
 $('#history-dialog').showModal();
});
$('#history-confirm').onclick=safe(async()=>{
 if(busy||!historyJob)return;
 const job={...historyJob,allowAI:historyJob.hasKey&&$('#history-use-ai').checked};
 busy=true;historyProgressDay=job.day;$('#history-dialog').close();
 const progress=$('#history-progress');progress.textContent=t('正在补分类历史页面…');render();
 const run=async()=>{
  const result=await organizeHistory({...job,send,
   shouldContinue:()=>document.visibilityState==='visible'&&view==='history'&&mono?.mode==='tabs'&&!mono?.panel&&!mono?.siteGrouping&&resumeDay===job.day,
   onProgress:r=>{progress.textContent=t`全部 ${r.total} 页 · 规则归类 ${r.local} 页（免费） · AI 已检查 ${r.ai} 页 · 剩余 ${r.remaining} 页`;}
  });
  for(const rule of result.suggestions)if(!suggestions.some(r=>r.keyword===rule.keyword))suggestions.push(rule);
  const notes={complete:t('历史补分类完成'),paused:t('记录已暂停，已停止补分类'),changed:t('设置已变化，已保留完成结果，请重新整理'),stopped:t('已停止补分类，已完成结果保留'),'no-key':t('AI 未配置；已保留本地规则结果'),'rules-only':t('已应用本地规则，剩余页面可使用 AI 补分类')};
  progress.textContent=t`${job.day} · ${notes[result.reason]} · 规则归类 ${result.local} 页 · AI 已检查 ${result.ai} 页 · 仍待整理 ${result.unresolved} 页`;
 };
 try{
  if(navigator.locks)await navigator.locks.request('atlas-ai',{ifAvailable:true},async lock=>{if(lock)await run();else progress.textContent=t('另一个工作区窗口正在整理，请稍后查看结果。');});
  else await run();
 }catch(error){progress.textContent=t`${error.message} · 已完成的结果保留，可再次点击“补分类”重试。`;}
 finally{busy=false;historyJob=null;autoDirty=false;await load();}
});
$('#day').value=dayKey();$('#day').max=dayKey();$('#day').onchange=()=>{if(!$('#day').value)return;resumeDay=$('#day').value;resumeDateChosen=true;render();};
$('#search').oninput=render;
$('#refresh').onclick=safe(async()=>{retryAfter=0;autoError='';await load();toast(t('已同步当前标签清单。'));});
function showRules(){resetRuleForm();renderRules();$('#ai-preference').value=state.preference||'';$('#save-preference').checked=!!state.config.savePreference;$('#export-preference').checked=false;mono.openPanel('rules-dialog','rules');}
$('#rules-button').onclick=safe(async()=>{const source=mono.mode,navigation=mono.navigationId;await load();if(source!==mono.mode||navigation!==mono.navigationId)return;showRules();});
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>document.getElementById(button.dataset.close).close();
$('#settings-form').onsubmit=safe(async event=>{
 event.preventDefault();
 // Capture one edit session before any asynchronous confirmation or Key read.
 // Switching provider while waiting must never combine fields from two drafts.
 const startOrganizing=setupIntent;
 const submission={type:'settings',expectedSettings:settingsBase,apiKey:$('#api-key').value,value:{
  provider:$('#ai-provider').value,
  excluded:$('#excluded').value.split('\n').filter(s=>s.trim()).map(normalizeDomain),
  retentionDays:storagePanel.days,
  recording:$('#recording').checked,model:$('#model').value
 }};
 if(!await storagePanel.confirmRetention(submission.value.retentionDays,state.config.retentionDays||30))return;
 if(startOrganizing&&isExtension&&!submission.apiKey.trim()&&!await send({type:'getKey',provider:submission.value.provider})){
  $('#api-key').focus();throw new Error(t('请填写所选供应商的 API Key，或关闭设置后使用分类规则。'));
 }
 if(startOrganizing&&!submission.value.recording){$('#recording').focus();throw new Error(t('请开启记录，以同步并整理当前标签。'));}
 await send(submission);
 $('#api-key').value='';$('#settings-dialog').close();retryAfter=0;autoError='';await load();
 if(startOrganizing){switchView('workspace');await runAI(true);}
 toast(startOrganizing?t('设置已保存在本机。'):t('设置已保存在本地。'));
});
$('#forget-key').onclick=safe(async()=>{resetConnection();const result=await send({type:'key',provider:$('#ai-provider').value,value:'',expectedSettings:settingsBase});if(isExtension)settingsBase=result.settingsSignature;$('#api-key').value='';await load();keyHelp();});
function resetRuleForm(){editingRule=null;$('#rule-form').reset();fillWorkspaceSelect($('#rule-group'),$('#rule-new-group'),workspaceNames());$('#rule-save').textContent=t('确认保存规则');$('#rule-cancel').hidden=true;$('#rule-editing').hidden=true;}
$('#rule-cancel').onclick=resetRuleForm;
$('#rule-form').onsubmit=safe(async event=>{
 event.preventDefault();await send({type:'rule',base:editingRule,value:{keyword:$('#rule-keyword').value.trim(),group:selectedWorkspace($('#rule-group'),$('#rule-new-group'))}});
 await load();resetRuleForm();renderRules();toast(t('规则已保存，新页面会按列表优先级匹配。'));
});
$('#preference-form').onsubmit=safe(async event=>{event.preventDefault();await send({type:'preference',value:$('#ai-preference').value,save:$('#save-preference').checked});await load();toast(state.config.savePreference?t('偏好已保存，后续 AI 分类自动使用。'):t('偏好仅在本次浏览器会话使用，未长期保存。'));});
$('#export-rules').onclick=safe(async()=>{
 await load();const backup=exportRuleBackup(state.config,$('#export-preference').checked);
 const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=`tabkeep-rules-${dayKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast(t`已导出 ${backup.rules.length} 条规则${backup.preference!==undefined?t('和已保存的 AI 偏好'):''}。`);
});
$('#import-rules').onclick=()=>{$('#rules-file').value='';$('#rules-file').click();};
$('#rules-file').onchange=safe(async()=>{
 const file=$('#rules-file').files[0];if(!file)return;if(file.size>1024*1024)throw new Error(t('规则备份不能超过 1 MB。'));
 let value;try{value=JSON.parse(await file.text());}catch{throw new Error(t('文件不是有效 JSON，尚未导入。'));}
 importBackup=parseRuleBackup(value);await load();const result=mergeRuleBackup(state.config.rules,importBackup);
 $('#import-summary').textContent=t`${importBackup.rules.length} 条规则：新增 ${result.added} 条，跳过 ${result.skipped} 条重复关键词。`;
 $('#import-preview').replaceChildren(...importBackup.rules.map(r=>el('div','',`${r.keyword} → ${r.group}`)));
 if(importBackup.preference!==undefined)$('#import-preview').append(el('div','',t`AI 偏好：${importBackup.preference||t('（空）')}`));
 $('#import-preference-label').hidden=importBackup.preference===undefined;$('#import-preference').checked=false;$('#import-dialog').showModal();
});
$('#confirm-import').onclick=safe(async()=>{
 if(!importBackup)return;const result=await send({type:'importRules',backup:importBackup});
 if($('#import-preference').checked&&importBackup.preference!==undefined){$('#ai-preference').value=importBackup.preference;$('#save-preference').checked=false;$('#preference-form').closest('details').open=true;}
 $('#import-dialog').close();await load();resetRuleForm();renderRules();toast(t`已新增 ${result.added} 条规则，保留 ${result.skipped} 条已有规则。${$('#import-preference').checked?t('偏好已填入，请点击应用偏好。'):''}`);importBackup=null;
});
$('#reorganize').onclick=safe(async()=>{
 if(view!=='workspace'||!mono?.allowsAuto)return;
 if(!isExtension){toast(t('当前是示例分类。加载 Chrome 扩展并配置 AI 后，即可整理真实标签页。'));return;}
 await load();if(!state.hasKey){showSettings();toast(t('先选择 AI 供应商并填写自己的 API Key。'));return;}
 pending=visible().map(r=>({...r}));if(!pending.length){toast(t('当前清单没有可整理的页面。'));return;}
 $('#ai-summary').textContent=t`当前范围：${pending.length} 个页面 · ${t(providerFor(state.config.provider).name)} / ${state.config.model} · 同时参考已打开页面中现有分类的代表标题和域名`;$('#ai-preview').replaceChildren(...pending.map(r=>{const line=el('div');line.append(el('strong','',r.title),el('small','',r.domain));return line;}));$('#ai-rules').textContent=t`已确认规则：${state.config.rules.length?state.config.rules.map(r=>`${r.keyword} → ${r.group}`).join('；'):t('无')}`;$('#ai-dialog').showModal();
});
async function runAI(automatic=false,force=false,scopeIds=null){
 if(busy||!mono?.allowsAuto||view!=='workspace')return;
 $('#ai-dialog').close();busy=true;render();
 const progress=$('#organize-progress');progress.hidden=false;
 const run=async()=>{
  const result=await organizeOpenTabs({send,force,ids:force?pending.map(r=>r.id):scopeIds,
   shouldContinue:fresh=>document.visibilityState==='visible'&&view==='workspace'&&mono?.allowsAuto&&(!automatic||!document.querySelector('dialog[open]')),
   onProgress:value=>{progress.textContent=t`全部 ${value.total} 页 · 规则归类 ${value.local} 页（免费） · AI 已检查 ${value.ai} 页 · 剩余 ${value.remaining} 页${value.remaining?t('，正在分批处理…'):''}`;}
  });
  for(const rule of result.suggestions)if(!suggestions.some(r=>r.keyword===rule.keyword))suggestions.push(rule);
  await load();autoError='';
  const notes={complete:t('整理完成'),paused:t('记录已暂停，请先开启记录以同步所有标签'),changed:t('设置已变化，已保留完成结果，请重新整理'),stopped:t('已暂停后续批次，返回工作区后可继续'),'no-key':isExtension?t('剩余页面需要 AI，请配置供应商和 Key'):t('示例预览不调用 AI；加载扩展后打开工作区即可整理真实标签')};
  progress.textContent=t`${notes[result.reason]} · 规则归类 ${result.local} 页（免费） · AI 已检查 ${result.ai} 页 · 仍待整理 ${result.unresolved} 页${result.remaining?t` · 剩余 ${result.remaining} 页`:''}`;
  if(!automatic&&isExtension&&result.reason==='no-key')showSettings();
 };
 try{
  if(navigator.locks)await navigator.locks.request('atlas-ai',{ifAvailable:true},async lock=>{if(lock)await run();else progress.textContent=t('另一个工作区窗口正在整理，请稍后查看结果。');});
  else await run();
 }catch(error){autoError=error.name==='TimeoutError'?t('AI 请求超时，可点击「刷新标签页」以重试。'):error.message;retryAfter=Date.now()+300000;progress.textContent+=t` · ${autoError} 已完成的批次会保留，点击「刷新标签页」可重试剩余页面。`;}
 finally{busy=false;render();if(autoDirty){autoDirty=false;scheduleAuto();}}
}
$('#ai-confirm').onclick=()=>{retryAfter=0;autoError='';return runAI(false,true);};
function scheduleAuto(){
 clearTimeout(autoTimer);
 if(!isExtension||!state||state.storageWarning||busy||sorting||sortSaving||!mono?.allowsAuto||view!=='workspace'||document.visibilityState==='hidden'||!state.config.recording||Date.now()<retryAfter)return;
 autoTimer=setTimeout(()=>safe(async()=>{
  if(document.querySelector('dialog[open]')||document.visibilityState==='hidden')return;
  await runAI(true);
 })(),1600);
}
$('#tab-form').onsubmit=safe(async event=>{
 event.preventDefault();const value={};
 const group=selectedWorkspace($('#tab-group'),$('#tab-new-group'));if(group!==editing.group)value.group=group;
 await send({type:'patch',id:editing.id,value});$('#tab-dialog').close();await load();
});
$('#exclude-tab').onclick=safe(async()=>{
 if(!confirm(t`排除 ${editing.domain} 及其子域名？已有本地记录将清除。`))return;
 await send({type:'settings',expectedSettings:settingsSignature(state.config),value:{...state.config,excluded:[...state.config.excluded,editing.domain]}});
 $('#tab-dialog').close();await load();
});
$('#search').onkeydown=event=>{if(event.key==='Escape'){$('#search').value='';render();}};
$('#more-menu').addEventListener('click',event=>{if(event.target.closest('button'))$('#more-menu').open=false;});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{refreshSoon();scheduleAuto();});
let refreshTimer;
function refreshSoon(){if(busy){autoDirty=true;return;}clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(!sorting&&!sortSaving&&document.visibilityState==='visible'&&!document.querySelector('dialog[open]'))safe(load)();},250);}
if(isExtension){
 chrome.tabs.onCreated.addListener(refreshSoon);chrome.tabs.onRemoved.addListener(refreshSoon);
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.apiKeys||changes.config||changes.records&&recordsChanged(changes.records)))refreshSoon();});
 chrome.tabs.onUpdated.addListener((id,info)=>{if(info.url||Object.hasOwn(info,'title')||info.status==='complete')refreshSoon();});
}
window.addEventListener('focus',refreshSoon);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshSoon();else clearTimeout(autoTimer);});
function updateLanguageButtons(){
 $('#language-zh').setAttribute('aria-pressed',String(getLanguage()==='zh'));
 $('#language-en').setAttribute('aria-pressed',String(getLanguage()==='en'));
 document.title=getLanguage()==='en'?'Pickmark':'拾签';
}
function changeLanguage(value,persist=true){
 let saved=true;
 setLanguage(value);
 if(persist){try{localStorage.setItem(LANGUAGE_KEY,getLanguage());}catch{saved=false;}}
 translateStatic();storagePanel.translate();updateLanguageButtons();
 $('#brand-home').title=isSidePanel?t('在新标签页打开完整面板'):t('返回工作区');
 $('#brand-home').setAttribute('aria-label',$('#brand-home').title);
 if(state){render();if($('#workspaces-dialog').open)renderWorkspaces();if($('#rules-dialog').open)renderRules();}
 // Preserve form values and edits in other open panels while relabeling options.
 for(const select of document.querySelectorAll('select'))for(const option of select.options){
  if(option.value===UNGROUPED)option.textContent=workspaceLabel(UNGROUPED);
  if(select.id==='ai-provider')option.textContent=t(providerFor(option.value).name);
 }
 if($('#settings-dialog').open){
  modelChoices();
  keyHelp();resetConnection();$('#save-settings').textContent=setupIntent?t('保存并开始整理'):t('保存设置');
 }
 $('#rule-save').textContent=editingRule?t('保存修改'):t('确认保存规则');
 for(const id of ['tab-group','rule-group']){
  const option=[...$('#'+id).options].find(option=>option.value==='');if(option)option.textContent=t('＋新建分类…');
 }
 const target=[...$('#workspace-target').options].find(option=>option.value===UNGROUPED);if(target)target.textContent=t('待整理（系统分类）');
 $('#toast').hidden=true;
 if(!saved)toast(t('语言已切换，仅在当前窗口生效。'));
 if(busy)autoDirty=true;
 if(!busy)$('#organize-progress').textContent='';
 scheduleAuto();
}
$('#language-zh').onclick=()=>changeLanguage('zh');
$('#language-en').onclick=()=>changeLanguage('en');
window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&(event.key===LANGUAGE_KEY||event.key===null))changeLanguage(preferredLanguage(event.newValue,systemLanguage()),false);});
updateLanguageButtons();
mono=new OffsetUI({
 extension:isExtension,state:()=>state,view:()=>view,rows:visible,scoped,names:workspaceNames,busy:()=>busy,
 send,toast,render,edit:showTab,switchView,groupingChanged:scheduleAuto,
 showManagement:section=>section==='manage'?showWorkspaces():showRules(),
 home:()=>$('#brand-home').click(),
 organize:()=>runAI(false,false,visible().map(r=>r.id)),
 refresh:async()=>{retryAfter=0;autoError='';await load();},
 close:safe(async item=>{if(!item)return;if(!isExtension){demo.tabs=demo.tabs.filter(tab=>tab.id!==item.tabId);localStorage.setItem('atlas-demo',JSON.stringify(demo));}else await send({type:'closeTab',id:item.id,tabId:item.tabId});await load();})
});
await safe(load)();
if(location.hash==='#settings'&&state)showSettings();

setInterval(()=>{if(document.visibilityState==='visible'&&!document.querySelector('dialog[open]')){const changed=updateCalendar();if(changed)safe(load)();}},60000);
