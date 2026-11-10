import {t,getLanguage} from './i18n.js';
import {retainProtected,HISTORY_BYTES} from './storage-budget.js';
import {retentionCutoff,retentionDays} from './retention-policy.js';
export const UNGROUPED = '待整理';
// Historical snapshots are independent of today's ownership and the open-page ownership.
export function historyCandidates(records,day,config) {
  return records.filter(r=>r.day===day&&!r.manualGroup&&r.group===UNGROUPED&&
    (!r.snapshotGroup||r.snapshotGroup===UNGROUPED)&&eligible(r,config));
}
// Migrate legacy reading-state fields without changing page or workspace data.
export function removeReadingStatus(records) {
  return records.map(record => {
    if (!Object.hasOwn(record,'status') && !Object.hasOwn(record,'snapshotStatus')) return record;
    const {status, snapshotStatus, ...page} = record;
    return page;
  });
}
export const defaults = () => ({recording: true, retentionDays: 30, savedPreference: '', savePreference: false, excluded: [], rules: [], provider: 'deepseek', model: 'deepseek-flash', providerModels: {}, workspaceOrder: [], workspaces: [], workspaceRevision: 0});
// Compare only fields edited by the settings form; unrelated rule edits are safe.
export function settingsSignature(config) {
  const c={...defaults(),...config};
  return JSON.stringify([c.recording,c.excluded,c.provider,c.model,retentionDays(c),c.settingsRevision||0]);
}
export function assertSettingsCurrent(config,expected) {
  if(expected!==settingsSignature(config))throw new Error(t('设置已在其他窗口更新，请关闭并重新打开设置后再保存。'));
}
export function dayKey(time = Date.now()) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function webUrl(raw) {
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
}
export function normalizeDomain(raw) {
  const input = raw.trim().toLowerCase();
  if (!input) return '';
  const u = webUrl(input.includes('://') ? input : `https://${input}`);
  if (!u || u.username || u.password || !u.hostname || u.pathname !== '/' || u.search || u.hash || u.port) throw new Error(t`请输入纯域名，例如 mail.google.com：${raw}`);
  return u.hostname.replace(/\.$/, '');
}
export function excludedUrl(raw, excluded) {
  const u = webUrl(raw);
  const hostname = u?.hostname.replace(/\.$/, '');
  return !u || excluded.some(host => hostname === host || hostname.endsWith(`.${host}`));
}
export function eligible(tab, config) { return !tab.incognito && !excludedUrl(tab.url, config.excluded); }
export function classify(title, domain, rules) {
  const text = `${title} ${domain}`.toLowerCase();
  return rules.find(r => text.includes(r.keyword.toLowerCase()))?.group || UNGROUPED;
}
export function collect(records, tabs, config, time = Date.now(), activeId = null) {
  const day = dayKey(time),today=new Map(),previous=new Map(),pages=new Map(),next=records.slice();
  records.forEach((r,index)=>{if(r.day===day&&!today.has(r.url))today.set(r.url,index);previous.set(r.url,r);});
  for (const tab of tabs.filter(t => eligible(t, config))) {
    const page=pages.get(tab.url);
    if(page){page.title=tab.title||page.title;page.active||=tab.id===activeId;}
    else pages.set(tab.url,{tab,title:tab.title,active:tab.id===activeId});
  }
  for(const {tab,title,active} of pages.values()){
    const index=today.get(tab.url);
    let item=index===undefined?null:records[index];
    if (!item) {
      const domain = new URL(tab.url).hostname;
      const prior=previous.get(tab.url);
      item = {id: crypto.randomUUID(), day, url: tab.url, domain, title: title || domain, group: prior?.group || classify(tab.title || '', domain, config.rules), aiTitle: prior?.aiTitle || '', manualGroup: prior?.manualGroup || false, firstSeen: time, lastSeen: time, activations: 0};
      if(active){item.activations++;item.lastActivated=time;}
      next.push(item);
    }else if(active||title&&title!==item.title||!item.lastSeen||time-item.lastSeen>=60000||time<item.lastSeen){
      // Unchanged open pages need at most one lastSeen checkpoint per minute.
      item={...item,title:title||item.title,lastSeen:time};
      if(active){item.activations++;item.lastActivated=time;}
      next[index]=item;
    }
  }
  const retained=retainRecords(next,config,time);
  if(retained.length===next.length)return retained;
  // When open pages exceed the budget, use a stable tab order. Otherwise each
  // refresh appends evicted pages and evicts the pages just classified by AI.
  const tabOrder=new Map(tabs.map((tab,index)=>[tab.url,index]));
  return retainRecords(next.sort((a,b)=>a.day.localeCompare(b.day)||
    (a.day===day?(tabOrder.get(a.url)??-1)-(tabOrder.get(b.url)??-1):0)),config,time);
}
export function retainRecords(records,config,time=Date.now()) {
  const cutoff = retentionCutoff(config,time);
  const today=dayKey(time),kept=records.filter(r => r.day >= dayKey(cutoff) && !excludedUrl(r.url, config.excluded));
  const manual=r=>r.day===today&&r.manualGroup;
  return retainProtected(kept,HISTORY_BYTES,manual,5000);
}
export function validatePlan(raw, allowedIds) {
  if (!raw || !Array.isArray(raw.assignments) || raw.assignments.length !== allowedIds.length) throw new Error(t('AI 返回的分类数量不完整，请重试。'));
  const known = new Set(allowedIds), seen = new Set();
  const assignments = raw.assignments.map(a => {
    if (!a || !known.has(a.id) || seen.has(a.id) || typeof a.group !== 'string' || !a.group.trim() || a.group.length > 40) throw new Error(t('AI 分类格式无效，尚未修改工作区。'));
    seen.add(a.id); return {id:a.id, group:a.group.trim()};
  });
  if (new Set(assignments.map(a => a.group)).size > 20) throw new Error(t('AI 分组过多，请缩小范围重试。'));
  const rules = (Array.isArray(raw.suggestedRules) ? raw.suggestedRules : []).slice(0,8).filter(r => r && typeof r.keyword === 'string' && r.keyword.trim().length >= 2 && r.keyword.length <= 80 && typeof r.group === 'string' && r.group.trim() && r.group.length <= 40).map(r=>({keyword:r.keyword.trim(), group:r.group.trim()}));
  return {assignments, rules};
}
export function aiPayload(records) {
  return records.map(({id,title,domain}) => ({id,title:title.slice(0,300),domain}));
}

// Successful attempts, including an uncertain result, are not repeated on every visit.
export function autoCandidates(records) {
  return records.filter(r => !r.manualGroup && r.aiTitle !== r.title && (r.group === UNGROUPED || !!r.aiTitle));
}
export function canAssign(record, assignment) {
  return record && typeof assignment?.baseTitle==='string' && typeof assignment.baseGroup==='string' && typeof assignment.baseManual==='boolean' && record.title===assignment.baseTitle && record.group===assignment.baseGroup && !!record.manualGroup===assignment.baseManual;
}

// Resolve by keyword and expected value, never by a stale UI row index.
export function updateRules(rules, message) {
  const next = rules.map(rule => ({...rule}));
  if (message.type === 'reorderRules') {
    if (JSON.stringify(rules) !== JSON.stringify(message.expected)) throw new Error(t('规则列表已在其他窗口更新，请重新打开后排序。'));
    return reorderByKey(next, message.keyword, message.target, rule => rule.keyword);
  }
  const base = message.base;
  const index = base ? next.findIndex(rule => rule.keyword === base.keyword && rule.group === base.group) : -1;
  if (base && index < 0) throw new Error(t('这条规则已在其他窗口修改或删除，请重新打开规则列表。'));
  if (message.type === 'deleteRule') {
    if (!base) throw new Error(t('请选择要操作的规则。'));
    next.splice(index, 1);
    return next;
  }
  const {keyword, group} = message.value || {};
  if (typeof keyword !== 'string' || keyword.trim().length < 2 || keyword.length > 80 || typeof group !== 'string' || !group.trim() || group.length > 40) throw new Error(t('规则关键词须为 2–80 字，分组名称须为 1–40 字。'));
  const value = {keyword: keyword.trim(), group: group.trim()};
  const duplicate = next.findIndex(rule => rule.keyword.toLowerCase() === value.keyword.toLowerCase());
  if (base && duplicate >= 0 && duplicate !== index) throw new Error(t('该关键词已有规则，请编辑已有规则或使用其他关键词。'));
  const target = base ? index : duplicate;
  if (target >= 0) next[target] = value;
  else {
    if(next.length>=1000)throw new Error(t('最多保存 1,000 条规则，请先清理已有规则。'));
    next.push(value);
  }
  return next;
}

// Move to the target's index; preserve the relative order of every other item.
export function reorderByKey(items, source, target, key = value => value) {
  const next = [...items], from = next.findIndex(item => key(item) === source), to = next.findIndex(item => key(item) === target);
  if (from < 0 || to < 0) throw new Error(t('排序对象已不存在，请刷新后重试。'));
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
export function orderedWorkspaces(records, config, includeUngrouped = false) {
  const names = [...new Set([...(config.workspaces||[]), ...records.map(r=>r.group), ...config.rules.map(r=>r.group)])].filter(name=>includeUngrouped || name!==UNGROUPED);
  return [...new Set([...(config.workspaceOrder||[]).filter(name=>names.includes(name)), ...names])];
}

export function manageWorkspace(data, message) {
  const names=orderedWorkspaces(data.records,data.config);
  const revision=data.config.workspaceRevision||0;
  if(message.expectedRevision!==revision)throw new Error(t('工作区已在其他窗口更新，请重新打开管理窗口。'));
  const name=typeof message.name==='string'?message.name.trim():'';
  if(!name || name.length>40 || name===UNGROUPED)throw new Error(t('工作区名称须为 1–40 字，不能使用系统名称「待整理」。'));
  const action=message.action;
  if(!['create','rename','delete','icon'].includes(action))throw new Error(t('未知工作区操作。'));
  if(action==='create' && names.includes(name))throw new Error(t('此工作区已存在。'));
  if(action!=='create' && !names.includes(name))throw new Error(t('工作区已不存在，请刷新。'));
  const target=typeof message.target==='string'?message.target.trim():'';
  if(action==='rename' && (!target || target.length>40 || target===UNGROUPED || names.includes(target)))throw new Error(t('请使用新的工作区名称（1–40 字），不能与已有工作区重名。'));
  if(action==='delete' && (target===name || (target!==UNGROUPED&&!names.includes(target))))throw new Error(t('请选择一个有效的迁移工作区。'));
  const config={...data.config,workspaceRevision:revision+1};
  const icons=new Map(Object.entries(data.config.workspaceIcons||{}));
  if(action==='icon'){
    if(!['auto','code','idea','components','map','team','book','music','tools','inbox','folder'].includes(message.icon))throw new Error(t('未知工作区操作。'));
    if(message.icon==='auto')icons.delete(name);else icons.set(name,message.icon);
    config.workspaceIcons=Object.fromEntries(icons);
    return {...data,config};
  }
  if(action==='rename'&&icons.has(name))icons.set(target,icons.get(name));
  if(action==='rename'||action==='delete')icons.delete(name);
  config.workspaceIcons=Object.fromEntries(icons);
  config.workspaces=action==='create'?[...names,name]:action==='rename'?names.map(n=>n===name?target:n):names.filter(n=>n!==name);
  config.workspaceOrder=(data.config.workspaceOrder||[]).flatMap(n=>n!==name?[n]:action==='rename'?[target]:[]);
  if(action==='create')return {...data,config};
  config.rules=data.config.rules.map(r=>r.group===name?{...r,group:target}:r);
  // Current ownership and the captured daily ownership can differ.
  const records=data.records.map(r=>({...r,
    ...(r.group===name?{group:target,...(action==='delete'?{manualGroup:true}:{})}:{}),
    ...(r.snapshotGroup===name?{snapshotGroup:target}:{})
  }));
  return {...data,config,records};
}

export function applyLocalRules(records, rules, ids) {
  const scope=new Set(ids);let matched=0;
  const next=records.map(record=>{
    if(!scope.has(record.id)||record.manualGroup)return record;
    const text=`${record.title} ${record.domain}`.toLowerCase();
    const rule=rules.find(r=>text.includes(r.keyword.toLowerCase()));
    if(!rule)return {...record,ruleMatched:false};
    matched++;
    return {...record,group:rule.group,aiTitle:record.title,ruleMatched:true};
  });
  return {records:next,matched};
}

// Used both before requests and by the serialized worker before committing results.
export function classificationContext(config,preference='') {
  return JSON.stringify([config.provider,config.model,config.rules,config.excluded,config.workspaceRevision||0,preference,getLanguage(),retentionDays(config),config.historyRevision||0,config.settingsRevision||0]);
}
