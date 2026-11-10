import {classificationContext} from './core.js';

// Ignore collection bookkeeping, but invalidate changes to any data used by AI.
export const requestRecordsSignature=records=>JSON.stringify(records.map(r=>[
 r.id,r.day,r.url,r.title,r.domain,r.group,!!r.manualGroup,r.snapshotGroup,r.ruleMatched,r.aiTitle
]));

export async function dispatchClassification({send,request,state,batch,key,workspaces,context,day,shouldContinue,expectedContext}){
 const ids=[...new Set([...batch,...context.pending,...context.workspaces].map(r=>r.id))];
 const referenced=records=>ids.map(id=>records.find(r=>r.id===id)).filter(Boolean);
 const expectedRecords=requestRecordsSignature(referenced(state.records));
 const fresh=await send({type:day?'getHistory':'get'});
 if(!fresh.config.recording)return {reason:'paused'};
 if(expectedContext!==classificationContext(fresh.config,fresh.preference||'')||expectedRecords!==requestRecordsSignature(referenced(fresh.records)))return {reason:'changed'};
 if(!fresh.hasKey)return {reason:'no-key'};
 if(!shouldContinue(fresh))return {reason:'stopped'};
 if(request){
  // Dependency-injected requests use the same preflight as the real worker path.
  return {plan:await request(batch,fresh.config.rules,key,fresh.config.model,AbortSignal.timeout(90000),workspaces,fresh.config.provider,fresh.preference||'',context)};
 }
 // The worker repeats validation and starts fetch on its serialized queue.
 return send({type:'classify',day,ids,batchIds:batch.map(r=>r.id),pendingIds:context.pending.map(r=>r.id),workspaceIds:context.workspaces.map(r=>r.id),expectedContext,expectedRecords});
}
