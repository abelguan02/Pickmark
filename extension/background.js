import {t,setLanguage} from './i18n.js';
import {dashboardLauncher} from './dashboard-launcher.js';
import {bookmarkAIService} from './bookmark-ai.js';
import {cleanupSnapshot,preserveCurrent} from './cleanup.js';
import {retentionDays} from './retention-policy.js';
import {handleBookmarks,BOOKMARK_KEY} from './bookmarks.js';
import {excludedUrl} from './core.js';
import {handleThumbnail,THUMBNAIL_KEY,retainThumbnails} from './thumbnails.js';
import {organize} from './ai.js?v=20260917-15';
import {requestRecordsSignature} from './classification-request.js';
import {writeLocal,isStorageCapacityError} from './storage-budget.js';
import {thumbnailWorker} from './thumbnail-worker.js';
import {PREVIEW_AUTO_KEY} from './thumbnails.js';
import {historyCandidates,UNGROUPED} from './core.js?v=20260917-15';
import {retainVisits} from './activity.js';
import {activityWorker} from './activity-worker.js';
import {preferenceText,mergeRuleBackup} from './rule-transfer.js?v=20260917-15';
import {providerFor,sessionKeys} from './providers.js?v=20260917-15';
import {defaults, settingsSignature, assertSettingsCurrent, retainRecords, classificationContext, collect, eligible, dayKey, removeReadingStatus, normalizeDomain, canAssign, updateRules, orderedWorkspaces, reorderByKey, manageWorkspace, applyLocalRules} from './core.js?v=20260917-15';
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(console.error);
const openDashboard=dashboardLauncher(chrome);
chrome.action?.onClicked.addListener(tab=>openDashboard(tab).catch(console.error));
const snapshotRecords=records=>records.map(r=>r.day===dayKey()||!r.snapshotGroup?{...r,snapshotGroup:r.group}:r);
let queue = Promise.resolve();
function serial(fn) { const task = queue.then(fn); queue = task.catch(console.error); return task; }
const activity=activityWorker(serial);
const previews=thumbnailWorker({api:chrome,serial});
const bookAI=bookmarkAIService({api:chrome,readConfig:async()=>(await read()).config,readKeys,organize,serial});
const cleanupKeys=['records','visits','config','lastCleanupAt',THUMBNAIL_KEY];
async function maintain(force=false,options={}){
 if(!force){const {lastCleanupAt}=await chrome.storage.local.get(['lastCleanupAt']);if(lastCleanupAt&&Date.now()-lastCleanupAt>=0&&Date.now()-lastCleanupAt<86400000)return;}
 const source=await chrome.storage.local.get(cleanupKeys);
 const patch=cleanupSnapshot(source,await chrome.tabs.query({}),options);
 return writeLocal(patch);
}
// Do not postpone the daily alarm every time the MV3 worker wakes up.
if(chrome.alarms)chrome.alarms.get('data-maintenance').then(alarm=>{if(!alarm)return chrome.alarms.create('data-maintenance',{periodInMinutes:1440});}).catch(console.error);
chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name==='data-maintenance')return serial(()=>maintain(true));});
async function read() {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await maintain();
  const data = await chrome.storage.local.get(['records','config']);
  let config={...defaults(),...data.config};
  const hadLegacy=Object.hasOwn(config,'autoOrganize');delete config.autoOrganize;
  const source=data.records||[];
  const cleaned=removeReadingStatus(source);
  let records=retainRecords(cleaned,config);
  const pruning=records.length!==source.length;
  if(pruning)records=retainRecords(preserveCurrent(cleaned,await chrome.tabs.query({}),config),config);
  if(hadLegacy||cleaned.some((r,i)=>r!==source[i])||pruning){const saved=await writeLocal({records,config});records=saved.records;config=saved.config;}
  return {records:snapshotRecords(records),config};
}
async function readKeys(migrate=true) {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const stored=await chrome.storage.local.get(['apiKeys']);
  const legacy=await chrome.storage.session.get(['apiKey','apiKeys']);
  const keys={...sessionKeys(legacy),...stored.apiKeys};
  if(migrate&&(Object.hasOwn(legacy,'apiKey')||Object.hasOwn(legacy,'apiKeys'))) {
    await writeLocal({apiKeys:keys});
    await chrome.storage.session.remove(['apiKey','apiKeys']);
  }
  return keys;
}
// Recovery reads never migrate, collect, prune or write. Re-read after failure:
// an earlier successful cleanup must not be replaced by a stale snapshot.
async function savedState(){
 const data=await chrome.storage.local.get(['records','config','visits','trackingSince']);
 const config={...defaults(),...data.config};delete config.autoOrganize;
 const tabs=await chrome.tabs.query({}),keys=await readKeys(false);
 const prefs=await chrome.storage.session.get(['classificationPreference']);
 return {...data,records:snapshotRecords(data.records||[]),visits:data.visits||[],config,
  preference:prefs.classificationPreference??config.savedPreference,
  tabs:tabs.filter(tab=>eligible(tab,config)).map(({id,windowId,url})=>({id,windowId,url})),
  hasKey:!!keys[config.provider],keyProviders:Object.keys(keys).filter(id=>!!keys[id]),today:dayKey(),storageWarning:true};
}
async function readable(operation){
 try{return await operation();}catch(error){if(!isStorageCapacityError(error))throw error;return savedState();}
}
async function savedConfig(){const {config}=await chrome.storage.local.get(['config']);return {...defaults(),...config};}
async function sync(activeId=null) {
  const data = await read();
  const tabs = await chrome.tabs.query({});
  if (data.config.recording) {
    data.records = collect(data.records, tabs, data.config, Date.now(), activeId);
    data.records=snapshotRecords(data.records);
    const saved=await writeLocal({records:snapshotRecords(data.records)});data.records=saved.records;if(saved.config)data.config=saved.config;
  }
  const keys=await readKeys();
  const prefs=await chrome.storage.session.get(['classificationPreference']);
  return {...data, preference:prefs.classificationPreference ?? data.config.savedPreference, tabs:tabs.filter(t=>eligible(t,data.config)).map(({id,windowId,url})=>({id,windowId,url})), hasKey:!!keys[data.config.provider], keyProviders:Object.entries(keys).filter(([,key])=>!!key).map(([id])=>id), today:dayKey()};
}
chrome.runtime.onInstalled.addListener(()=>serial(()=>sync()));
chrome.runtime.onStartup.addListener(()=>serial(()=>sync()));
chrome.tabs.onCreated.addListener(()=>serial(()=>sync()));
chrome.tabs.onRemoved.addListener(()=>serial(()=>sync()));
chrome.tabs.onUpdated.addListener((id,info)=>{if(info.url || Object.hasOwn(info,'title') || info.status==='complete') serial(()=>sync());});
chrome.tabs.onActivated.addListener(({tabId})=>serial(()=>sync(tabId)));
async function handle(message) {
  if(message.type==='storageInfo'){
    const d=await chrome.storage.local.get(cleanupKeys);
    return {records:(d.records||[]).length,visits:(d.visits||[]).length,bytes:chrome.storage.local.getBytesInUse?await chrome.storage.local.getBytesInUse(null):0,lastCleanupAt:d.lastCleanupAt,retentionDays:retentionDays(d.config||{})};
  }
  if(message.type==='cleanupPreview'||message.type==='cleanup'){
    if(!['cache','old','all'].includes(message.mode))throw Error('Invalid cleanup mode');
    const source=await chrome.storage.local.get(cleanupKeys);
    if(message.mode==='cache'){
      const count=Object.keys(source[THUMBNAIL_KEY]||{}).length;
      if(message.type==='cleanup')await writeLocal({[THUMBNAIL_KEY]:{}});
      return {records:0,visits:0,thumbnails:count};
    }
    if(message.mode==='old'&&![7,14,30].includes(message.days))throw Error('Invalid retention days');
    const patch=cleanupSnapshot(source,await chrome.tabs.query({}),{mode:message.mode,days:message.days});
    const kept=new Set(patch.records.map(r=>r.id));const removed=(source.records||[]).filter(r=>!kept.has(r.id));
    if(message.type==='cleanup')await writeLocal(patch);
    return {records:removed.length,visits:(source.visits||[]).length-patch.visits.length,from:removed.map(r=>r.day).sort()[0],to:removed.map(r=>r.day).sort().at(-1)};
  }
  if(message.type==='preview:auto'){
    if(typeof message.enabled!=='boolean')throw Error('Invalid preview preference');
    if(message.enabled&&!await chrome.permissions.contains({origins:['<all_urls>']}))throw Error('请先授权截图 / Authorize screenshots first');
    await writeLocal({[PREVIEW_AUTO_KEY]:message.enabled});
    if(message.enabled)previews.schedule();else previews.cancel();
    return true;
  }
  if(message.type==='thumbnail:capture')return previews.captureFor(message,await savedConfig());
  if(message.type?.startsWith('thumbnail:'))return handleThumbnail(message,chrome,await savedConfig());
  if(message.type?.startsWith('bookAI:'))return bookAI(message);
  if(message.type?.startsWith('bookmarks:'))return handleBookmarks(message,chrome,(await savedConfig()).excluded);
  if(message.type==='closeTab'){
    const data=await read(),record=data.records.find(r=>r.id===message.id);
    if(!record)throw new Error(t('记录已不存在，请刷新。'));
    const tabs=await chrome.tabs.query({});
    const tab=tabs.find(tab=>tab.url===record.url&&!tab.incognito);
    if(tab)await chrome.tabs.remove(tab.id);
    return true;
  }
  if(message.type==='getHistory') {
   return readable(async()=>{
    const data=await read(),keys=await readKeys(),prefs=await chrome.storage.session.get(['classificationPreference']);
    return {...data,preference:prefs.classificationPreference??data.config.savedPreference,hasKey:!!keys[data.config.provider]};
   });
  }
  if(message.type==='get')return readable(async()=>{const review=await activity.sample();return {...await sync(),...review};});
  if(message.type==='key' || message.type==='getKey') {
    const provider=message.provider || (await savedConfig()).provider;providerFor(provider);
    const guarded=message.type==='key'&&message.expectedSettings!==undefined;
    const config=message.type==='key'?await savedConfig():null;
    if(guarded)assertSettingsCurrent(config,message.expectedSettings);
    let keys;
    try{keys=await readKeys(!guarded);}catch(error){if(message.type!=='getKey'||!isStorageCapacityError(error))throw error;keys=await readKeys(false);}
    if(message.type==='getKey')return keys[provider] || '';
    keys[provider]=String(message.value||'').trim();
    const saved=await writeLocal({apiKeys:keys,config:{...config,settingsRevision:(config.settingsRevision||0)+1}});
    return guarded?{settingsSignature:settingsSignature(saved.config)}:true;
  }
  if(message.type==='clear') {
    // Keep the legacy entry atomic too; failed clearing must not leave visits
    // or previews partially deleted, or lose current manual classifications.
    const source=await chrome.storage.local.get(cleanupKeys);
    const patch=cleanupSnapshot(source,await chrome.tabs.query({}),{mode:'all'});
    patch.records=patch.records.filter(r=>r.manualGroup);
    patch.config={...patch.config,recording:false,settingsRevision:(patch.config.settingsRevision||0)+1};
    patch[THUMBNAIL_KEY]={};
    await writeLocal(patch);
    try{await chrome.storage.session.remove(['mediaFrames']);}catch(error){console.error(error);}
    return true;
  }
  // Settings stage retention and migrations in their single commit, never in read().
  const settingsSource=message.type==='settings'?await chrome.storage.local.get([...cleanupKeys,BOOKMARK_KEY,'activityCursor','trackingSince']):null;
  const data=settingsSource?{records:settingsSource.records||[],config:{...defaults(),...settingsSource.config}}:await read();
  if(message.type==='classify') {
    const prefs=await chrome.storage.session.get(['classificationPreference']);
    const preference=prefs.classificationPreference??data.config.savedPreference;
    if(!data.config.recording)return {reason:'paused'};
    if(message.expectedContext!==classificationContext(data.config,preference))return {reason:'changed'};
    const records=message.ids.map(id=>data.records.find(r=>r.id===id)).filter(Boolean);
    if(message.expectedRecords!==requestRecordsSignature(records)||records.some(r=>!eligible(r,data.config)))return {reason:'changed'};
    const key=(await readKeys())[data.config.provider];
    if(!key)return {reason:'no-key'};
    const select=ids=>ids.map(id=>records.find(r=>r.id===id)).filter(Boolean);
    const batch=select(message.batchIds);
    if(!batch.length||batch.length!==message.batchIds.length)return {reason:'changed'};
    if(message.day){if(batch.some(r=>r.day!==message.day))return {reason:'changed'};}
    else {
      const tabs=await chrome.tabs.query({});
      if(batch.some(r=>r.day!==dayKey()||!tabs.some(tab=>tab.url===r.url&&eligible(tab,data.config))))return {reason:'changed'};
    }
    const names=message.day?data.records.filter(r=>r.day===message.day).map(r=>({...r,group:r.snapshotGroup||r.group})):data.records;
    const examples=select(message.workspaceIds).map(r=>message.day?{...r,group:r.snapshotGroup||r.group}:r);
    // Start the network operation before releasing the queue, but do not hold
    // the queue while awaiting it: pause/exclude/clear must remain responsive.
    // Keep the MV3 worker alive only for this bounded request, including slow
    // suppliers; a read-only extension API call resets Chrome's idle timer.
    const heartbeat=setInterval(()=>{chrome.storage.local.get([]).catch(()=>{});},20000);
    const pending=organize(batch,data.config.rules,key,data.config.model,AbortSignal.timeout(90000),orderedWorkspaces(names,data.config),data.config.provider,preference,{pending:select(message.pendingIds),workspaces:examples}).then(plan=>({plan})).finally(()=>clearInterval(heartbeat));
    return {pending};
  }
  if(message.type==='historyRules'||message.type==='historyAssign') {
    const day=message.day;
    if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>dayKey()||dayKey(new Date(`${day}T12:00:00`))!==day)throw new Error(t('请选择有效的历史日期。'));
    const prefs=await chrome.storage.session.get(['classificationPreference']);
    if(!data.config.recording||message.expectedContext!==classificationContext(data.config,prefs.classificationPreference??data.config.savedPreference))return {accepted:false,matched:0,applied:0};
    const candidates=historyCandidates(data.records,day,data.config);
    if(message.type==='historyRules') {
      const ids=new Set(message.ids||[]),scope=candidates.filter(r=>ids.has(r.id)).map(r=>r.id);
      const result=applyLocalRules(data.records,data.config.rules,scope);
      const updated=new Set(scope);
      const records=result.records.map(r=>updated.has(r.id)?{...r,snapshotGroup:r.group}:r);
      await writeLocal({records});return {accepted:true,matched:result.matched};
    }
    if(!(await readKeys())[data.config.provider])return {accepted:false,applied:0};
    const allowed=new Set(candidates.map(r=>r.id)),applied=new Set();
    for(const a of message.assignments||[]) {
      const record=data.records.find(r=>r.id===a.id);
      if(!allowed.has(a.id)||applied.has(a.id)||a.baseTitle!==record.title||a.baseGroup!==UNGROUPED||a.baseManual!==false||a.baseSnapshot!==record.snapshotGroup||
        typeof a.group!=='string'||!a.group.trim()||a.group.length>40)continue;
      record.group=a.group.trim();record.snapshotGroup=record.group;record.aiTitle=record.title;record.ruleMatched=false;applied.add(record.id);
    }
    await writeLocal({records:data.records});return {accepted:true,applied:applied.size};
  }
  if(message.type==='preference') {
    const text=preferenceText(message.value);
    data.config={...data.config,savedPreference:message.save?text:'',savePreference:!!message.save};
    await writeLocal({config:data.config});
    await chrome.storage.session.set({classificationPreference:text});return true;
  }
  if(message.type==='importRules') {
    const result=mergeRuleBackup(data.config.rules,message.backup);
    data.config.rules=result.rules;await writeLocal({config:data.config});return {added:result.added,skipped:result.skipped};
  }
  if(message.type==='restoreDay') {
    if(!data.config.recording)throw new Error(t('请先在设置中开启记录，再恢复工作现场。'));
    const ids=new Set(message.ids||[]),source=data.records.filter(r=>r.day===message.day&&ids.has(r.id)&&eligible({url:r.url},data.config));
    if(!source.length)throw new Error(t('这个日期没有可恢复的页面。'));
    const openedTabs=await chrome.tabs.query({}),urls=new Set(openedTabs.filter(t=>!t.incognito).map(t=>t.url));
    let opened=0,existing=0,failed=0;const restored=[];
    for(const record of source) {
      if(urls.has(record.url)){existing++;continue;}
      try{const tab=await chrome.tabs.create({url:record.url,active:false});urls.add(record.url);openedTabs.push({...tab,url:record.url,title:record.title});restored.push(record);opened++;}catch{failed++;}
    }
    data.records=collect(data.records,openedTabs,data.config,Date.now());
    data.records=data.records.map(r=>{const old=restored.find(item=>item.url===r.url);return r.day===dayKey()&&old?{...r,group:old.snapshotGroup||old.group,manualGroup:true,aiTitle:r.title}:r;});
    await writeLocal({records:snapshotRecords(data.records)});return {opened,existing,failed};
  }
  if(message.type==='settings') {
    assertSettingsCurrent(data.config,message.expectedSettings);
    if(message.apiKey!==undefined&&typeof message.apiKey!=='string')throw Error('Invalid API key');
    if(message.value.retentionDays!==undefined&&![7,14,30].includes(message.value.retentionDays))throw Error('Invalid retention days');
    data.config.retentionDays=message.value.retentionDays??retentionDays(data.config);
    const activityPatch=await activity.sample({stop:true,commit:false});
    const {recording, excluded, model}=message.value;
    const provider=message.value.provider || data.config.provider;const info=providerFor(provider);
    const nextModel=String(model||'').trim().slice(0,80)||info.model;
    const providerModels={...data.config.providerModels,[data.config.provider]:data.config.model,[provider]:nextModel};
    data.config={...data.config,idleSeconds:[60,300,600,900].includes(Number(message.value.idleSeconds))?Number(message.value.idleSeconds):(data.config.idleSeconds||300),provider,providerModels,recording:!!recording,excluded:[...new Set(excluded.map(normalizeDomain).filter(Boolean))],model:nextModel};
    delete data.config.autoOrganize;
    data.config.historyRevision=(data.config.historyRevision||0)+1;
    data.config.settingsRevision=(data.config.settingsRevision||0)+1;
    const patch=cleanupSnapshot({...settingsSource,...activityPatch,config:data.config,records:removeReadingStatus(data.records)},await chrome.tabs.query({}));
    patch.activityCursor=activityPatch.activityCursor;patch.trackingSince=activityPatch.trackingSince;
    patch.records=snapshotRecords(patch.records);
    const bookmarkData=settingsSource[BOOKMARK_KEY];
    // Read legacy keys without migration writes; persist every provider in the
    // same transaction. Empty form input means keep the effective saved key.
    const keys=await readKeys(false);
    if(message.apiKey?.trim())keys[provider]=message.apiKey.trim();
    patch.apiKeys=keys;
    if(bookmarkData)patch[BOOKMARK_KEY]={...bookmarkData,revision:(bookmarkData.revision||0)+1,metadata:Object.fromEntries(Object.entries(bookmarkData.metadata||{}).filter(([,entry])=>!excludedUrl(entry.url,patch.config.excluded)))};
    await writeLocal(patch);
    // The persistent transaction is complete; a browser-side timer adjustment
    // must not turn a successful save into a reported storage failure.
    try{activity.configureIdle(patch.config);}catch(error){console.error(error);}
    return true;
  }
  if(['rule','deleteRule','reorderRules'].includes(message.type)) {
    data.config.rules=updateRules(data.config.rules,message);
    await writeLocal({config:data.config}); return true;
  }
  if(message.type==='applyRules') {
    if(!data.config.recording)return {matched:0};
    const tabs=await chrome.tabs.query({});
    const ids=data.records.filter(r=>r.day===dayKey()&&message.ids.includes(r.id)&&tabs.some(t=>t.url===r.url&&eligible(t,data.config))).map(r=>r.id);
    const result=applyLocalRules(data.records,data.config.rules,ids);
    await writeLocal({records:snapshotRecords(result.records)});return {matched:result.matched};
  }
  if(message.type==='workspace') {const next=manageWorkspace(data,message);await writeLocal({...next,records:snapshotRecords(next.records)});return true;}
  if(message.type==='reorderWorkspaces') {
    data.config.workspaceOrder=reorderByKey(orderedWorkspaces(data.records,data.config,true),message.source,message.target);
    await writeLocal({config:data.config});return true;
  }
  if(message.type==='patch') {
    const record=data.records.find(r=>r.id===message.id);
    if(!record) throw new Error(t('记录已不存在，请刷新。'));
    if(typeof message.value.group==='string'&&message.value.group.trim()&&message.value.group.length<=40) { record.group=message.value.group.trim(); record.snapshotGroup=record.group; record.manualGroup=true;record.ruleMatched=false; }
    await writeLocal({records:snapshotRecords(data.records)}); return true;
  }
  if(message.type==='assign') {
    if(!data.config.recording)return false;
    const prefs=await chrome.storage.session.get(['classificationPreference']);
    if(message.expectedContext!==undefined&&message.expectedContext!==classificationContext(data.config,prefs.classificationPreference??data.config.savedPreference))return false;
    const tabs=await chrome.tabs.query({});

    if(message.workspaceRevision!==undefined && message.workspaceRevision!==(data.config.workspaceRevision||0))return false;
    for(const a of message.assignments) {
      const record=data.records.find(r=>r.id===a.id);
      if(record?.day===dayKey()&&tabs.some(t=>t.url===record.url&&eligible(t,data.config))&&canAssign(record,a)&&typeof a.group==='string'&&a.group.trim()&&a.group.length<=40) { record.group=a.group.trim(); record.aiTitle=record.title; }
    }
    await writeLocal({records:snapshotRecords(data.records)}); return true;
  }
  if(message.type==='jump'||message.type==='jumpVisit') {
    const record=message.type==='jump'?data.records.find(r=>r.id===message.id):
      retainVisits((await chrome.storage.local.get(['visits'])).visits||[],data.config).find(v=>v.visit===message.visit&&v.day===message.day&&v.url===message.url);
    if(!record) throw new Error(t('记录已不存在。'));
    const tabs=await chrome.tabs.query({});
    const tab=tabs.find(t=>t.url===record.url&&!t.incognito);
    if(tab) {await chrome.windows.update(tab.windowId,{focused:true}); await chrome.tabs.update(tab.id,{active:true});}
    else await chrome.tabs.create({url:record.url});
    return true;
  }
  throw new Error(t('未知操作'));
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type==='mediaState'){
    if(sender.id!==chrome.runtime.id||!sender.tab||typeof message.playing!=='boolean')return false;
    serial(()=>activity.sample({mediaMessage:{tab:sender.tab,frameId:sender.frameId,playing:message.playing}})).then(()=>reply({value:true}),()=>reply({value:false}));return true;
  }
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  // Status is read-only: it must remain responsive while capture owns the write queue.
  if(message.type==='preview:status'||message.type==='preview:states'){
    (message.type==='preview:states'?previews.states(message.urls):previews.status(message.url)).then(value=>reply({value}),error=>reply({error:error.message}));return true;
  }
  serial(()=>{setLanguage(message.locale);return handle(message);}).then(value=>value?.pending??value).then(value=>reply({value}),error=>reply({error:error.message}));
  return true;
});
