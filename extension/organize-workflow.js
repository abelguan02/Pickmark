import {UNGROUPED,autoCandidates,orderedWorkspaces,excludedUrl,classificationContext} from './core.js';
import {dispatchClassification} from './classification-request.js';
const openRecords=state=>state.records.filter(r=>r.day===state.today&&state.tabs.some(t=>t.url===r.url)&&!excludedUrl(r.url,state.config.excluded));
// One lock wraps the whole operation in the caller. Refresh before each batch,
// so the next request reuses newly created workspaces and respects user edits.
export async function organizeOpenTabs({send,request=null,onProgress=()=>{},shouldContinue=()=>true,force=false,ids=null}) {
  let state=await send({type:'get'});
  const result={total:0,local:0,ai:0,unresolved:0,batches:0,remaining:0,reason:'complete',suggestions:[]};
  if(!state.config.recording)return {...result,reason:'paused'};
  const scope=new Set(openRecords(state).filter(r=>!ids||ids.includes(r.id)).map(r=>r.id));result.total=scope.size;
  const local=await send({type:'applyRules',ids:[...scope]});result.local=local.matched;
  state=await send({type:'get'});
  const initial=openRecords(state).filter(r=>scope.has(r.id));
  const seeds=new Set(autoCandidates(initial).map(r=>r.id));
  // Revisit accumulated uncertain pages only when there is new classification evidence.
  // Keep fresh pages last so an interrupted backlog review remains retryable.
  const reviewBacklog=!force&&seeds.size>0;
  const preference=state.preference||'',attempted=new Set();
  const expectedContext=classificationContext(state.config,preference);
  for(;;){
    const available=openRecords(state).filter(r=>scope.has(r.id)&&!attempted.has(r.id));
    const freshIds=new Set(autoCandidates(available).map(r=>r.id));
    const candidates=force?available.filter(r=>r.manualGroup||!r.ruleMatched):available.filter(r=>freshIds.has(r.id)||(reviewBacklog&&!r.manualGroup&&!r.ruleMatched&&r.group===UNGROUPED)).sort((a,b)=>Number(seeds.has(a.id))-Number(seeds.has(b.id)));
    result.unresolved=openRecords(state).filter(r=>scope.has(r.id)&&r.group===UNGROUPED).length;
    result.remaining=candidates.length;onProgress({...result});
    if(!candidates.length)return result;
    if(!state.config.recording)return {...result,reason:'paused'};
    if(classificationContext(state.config,state.preference||'')!==expectedContext)return {...result,reason:'changed'};
    if(!shouldContinue(state))return {...result,reason:'stopped'};
    if(!state.hasKey)return {...result,reason:'no-key'};
    const batch=candidates.slice(0,200);
    const key=await send({type:'getKey',provider:state.config.provider});
    if(!key)return {...result,reason:'no-key'};
    const response=await dispatchClassification({send,request,state,batch,key,shouldContinue,expectedContext,workspaces:orderedWorkspaces(state.records,state.config),context:{
      pending: candidates.filter(r=>!batch.some(b=>b.id===r.id)).sort((a,b)=>Number(seeds.has(b.id))-Number(seeds.has(a.id))).slice(0,200),
      workspaces: openRecords(state).filter(r=>r.group!==UNGROUPED)
    }});
    if(response.reason)return {...result,reason:response.reason};
    const plan=response.plan;
    const fresh=await send({type:'get'});
    if(!shouldContinue(fresh))return {...result,reason:'stopped'};
    if(!fresh.config.recording||classificationContext(fresh.config,fresh.preference||'')!==expectedContext)return {...result,reason:'changed'};
    const assignments=plan.assignments.filter(a=>fresh.tabs.some(t=>t.url===batch.find(r=>r.id===a.id)?.url)).map(a=>{const before=batch.find(r=>r.id===a.id);return {...a,baseTitle:before.title,baseGroup:before.group,baseManual:!!before.manualGroup};});
    const committed=await send({type:'assign',assignments,workspaceRevision:state.config.workspaceRevision||0,expectedContext});
    if(!committed)return {...result,reason:'changed'};
    batch.forEach(r=>attempted.add(r.id));result.batches++;
    state=await send({type:'get'});
    result.ai+=assignments.filter(a=>state.records.some(r=>r.id===a.id&&r.group===a.group&&r.aiTitle===a.baseTitle)).length;
    for(const rule of plan.rules)if(!result.suggestions.some(r=>r.keyword===rule.keyword))result.suggestions.push(rule);
  }
}
