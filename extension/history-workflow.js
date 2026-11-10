import {dispatchClassification} from './classification-request.js';
import {historyCandidates,classificationContext,orderedWorkspaces,UNGROUPED} from './core.js';

// Explicit, bounded repair of one day's unclassified records. Never opens tabs.
export async function organizeHistory({send,day,ids,allowAI=true,expectedContext,request=null,onProgress=()=>{},shouldContinue=()=>true}) {
 let state=await send({type:'getHistory'});
 const scope=new Set(historyCandidates(state.records,day,state.config).filter(r=>ids.includes(r.id)).map(r=>r.id));
 const result={total:scope.size,local:0,ai:0,remaining:scope.size,unresolved:scope.size,reason:'complete',suggestions:[]};
 const baseline=expectedContext??classificationContext(state.config,state.preference||'');
 const active=()=>historyCandidates(state.records,day,state.config).filter(r=>scope.has(r.id));
 const status=()=>!state.config.recording?'paused':classificationContext(state.config,state.preference||'')!==baseline?'changed':!shouldContinue()?'stopped':null;
 let reason=status();if(reason)return {...result,reason};
 const local=await send({type:'historyRules',day,ids:[...scope],expectedContext:baseline});
 if(!local.accepted)return {...result,reason:'changed'};
 result.local=local.matched;
 const attempted=new Set();
 for(;;){
  state=await send({type:'getHistory'});
  const pending=active(),candidates=pending.filter(r=>!r.ruleMatched&&!attempted.has(r.id));
  result.unresolved=pending.length;result.remaining=candidates.length;onProgress({...result});
  reason=status();if(reason)return {...result,reason};
  if(!candidates.length)return result;
  if(!allowAI)return {...result,reason:'rules-only'};
  if(!state.hasKey)return {...result,reason:'no-key'};
  const key=await send({type:'getKey',provider:state.config.provider});
  if(!key)return {...result,reason:'no-key'};
  if(!shouldContinue())return {...result,reason:'stopped'};
  const batch=candidates.slice(0,200);
  const sameDay=state.records.filter(r=>r.day===day).map(r=>({...r,group:r.snapshotGroup||r.group}));
  const response=await dispatchClassification({send,request,state,batch,key,day,shouldContinue,expectedContext:baseline,workspaces:orderedWorkspaces(sameDay,state.config),context:{
   pending:candidates.slice(200,400),
   workspaces:sameDay.filter(r=>r.group!==UNGROUPED)
  }});
  if(response.reason)return {...result,reason:response.reason};
  const plan=response.plan;
  state=await send({type:'getHistory'});
  reason=status();if(reason)return {...result,reason};
  if(!state.hasKey)return {...result,reason:'no-key'};
  const before=new Map(batch.map(r=>[r.id,r]));
  const assignments=plan.assignments.filter(a=>before.has(a.id)).map(a=>{
   const record=before.get(a.id);
   return {...a,baseTitle:record.title,baseGroup:record.group,baseManual:!!record.manualGroup,baseSnapshot:record.snapshotGroup};
  });
  const committed=await send({type:'historyAssign',day,assignments,expectedContext:baseline});
  if(!committed.accepted)return {...result,reason:'changed'};
  result.ai+=committed.applied;batch.forEach(r=>attempted.add(r.id));
  if(committed.applied)for(const rule of plan.rules||[])if(!result.suggestions.some(r=>r.keyword===rule.keyword))result.suggestions.push(rule);
 }
}
