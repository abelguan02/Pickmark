import test from 'node:test';
import assert from 'node:assert/strict';
import {organizeOpenTabs} from '../extension/organize-workflow.js';
import {defaults,applyLocalRules,canAssign} from '../extension/core.js';
function fixture(count=451){
 const state={config:defaults(),today:'2026-09-17',hasKey:true,records:Array.from({length:count},(_,i)=>({id:String(i),day:'2026-09-17',url:`https://example.com/${i}`,domain:'example.com',title:`Page ${i}`,group:'待整理'}))};state.tabs=state.records.map(r=>({url:r.url}));
 const send=async message=>{
  if(message.type==='get')return structuredClone(state);
  if(message.type==='getKey')return 'fixture-key';
  if(message.type==='applyRules'){const result=applyLocalRules(state.records,state.config.rules,message.ids);state.records=result.records;return {matched:result.matched};}
  if(message.type==='assign'){for(const a of message.assignments){const r=state.records.find(r=>r.id===a.id);if(canAssign(r,a)){r.group=a.group;r.aiTitle=r.title;}}return true;}
 };
 return {state,send};
}
const plan=records=>({assignments:records.map(r=>({id:r.id,group:'研究'})),rules:[]});
test('switching away from topic organization while AI is pending does not apply its late assignments',async()=>{
 const f=fixture(2);let topic=true;
 const result=await organizeOpenTabs({send:f.send,shouldContinue:()=>topic,request:async records=>{topic=false;return plan(records);}});
 assert.equal(result.reason,'stopped');assert.ok(f.state.records.every(r=>r.group==='待整理'));
});
test('open-tab classification never sends stale pages when privacy changes while retrieving the key',async()=>{
 for(const change of [s=>{s.config.excluded=['example.com'];s.records=[];},s=>{s.config.recording=false;},s=>{s.records=[];s.config.recording=false;},s=>{s.records=[];},s=>{s.hasKey=false;},s=>{s.records[0].manualGroup=true;}]){
  const f=fixture(2);let requests=0;
  const send=async m=>{const response=await f.send(m);if(m.type==='getKey')change(f.state);return response;};
  const result=await organizeOpenTabs({send,request:async rows=>{requests++;return plan(rows);}});
  assert.equal(requests,0);assert.ok(['changed','paused','no-key'].includes(result.reason));
 }
});
test('one click handles 451 open pages in three batches and reuses existing workspaces',async()=>{
 const {state,send}=fixture();const sizes=[];
 const result=await organizeOpenTabs({send,request:async(records,rules,key,model,signal,names)=>{sizes.push(records.length);if(sizes.length>1)assert.ok(names.includes('研究'));return plan(records);}});
 assert.deepEqual(sizes,[200,200,51]);assert.equal(result.ai,451);assert.equal(result.remaining,0);
 assert.ok(state.records.every(r=>r.group==='研究'));
 const again=await organizeOpenTabs({send,request:()=>assert.fail('cached pages must not call AI')});assert.equal(again.ai,0);
});
test('rules work without a Key; only unmatched pages need AI and manual groups remain',async()=>{
 const {state,send}=fixture(3);state.hasKey=false;state.config.rules=[{keyword:'Page',group:'免费规则'}];state.records[1].manualGroup=true;state.records[1].group='人工';
 const result=await organizeOpenTabs({send,request:()=>assert.fail('no request expected')});assert.equal(result.local,2);assert.equal(result.reason,'complete');assert.equal(state.records[1].group,'人工');
 state.config.rules=[];state.records.push({id:'new',day:state.today,url:'https://new.example',domain:'new.example',title:'New',group:'待整理'});state.tabs.push({url:'https://new.example'});
 assert.equal((await organizeOpenTabs({send})).reason,'no-key');
});
test('failed batches preserve completed work and next click resumes remaining pages',async()=>{
 const {send}=fixture();let calls=0;
 await assert.rejects(organizeOpenTabs({send,request:async records=>{if(++calls===2)throw new Error('offline');return plan(records);}}),/offline/);
 const sizes=[];const result=await organizeOpenTabs({send,request:async records=>{sizes.push(records.length);return plan(records);}});
 assert.deepEqual(sizes,[200,51]);assert.equal(result.ai,251);
});
test('changed settings discard late results; hidden state stops additional batches',async()=>{
 const {state,send}=fixture(2);
 const result=await organizeOpenTabs({send,request:async records=>{state.config.provider='openai';return plan(records);}});
 assert.equal(result.reason,'changed');assert.ok(state.records.every(r=>r.group==='待整理'));
 assert.equal((await organizeOpenTabs({send,shouldContinue:()=>false,request:()=>assert.fail()})).reason,'stopped');
});
test('Key lifecycle changes discard late tab AI and its suggested rules',async()=>{
 const f=fixture(2);
 const result=await organizeOpenTabs({...f,request:async rows=>{
  f.state.config.settingsRevision=2;
  return {...plan(rows),rules:[{keyword:'page',group:'Old AI'}]};
 }});
 assert.equal(result.reason,'changed');assert.equal(result.ai,0);assert.deepEqual(result.suggestions,[]);
 assert.ok(f.state.records.every(r=>r.group==='待整理'));
});
test('a commit conflict after the final refresh does not report stale AI suggestions',async()=>{
 const f=fixture(1);
 const send=async message=>message.type==='assign'?false:f.send(message);
 const result=await organizeOpenTabs({send,request:async rows=>({...plan(rows),rules:[{keyword:'page',group:'Stale'}]})});
 assert.equal(result.reason,'changed');assert.equal(result.ai,0);assert.deepEqual(result.suggestions,[]);
 assert.equal(f.state.records[0].group,'待整理');
});
test('AI receives applied preferences and discards results when preferences change',async()=>{
 const {state,send}=fixture(2);state.preference='按项目分类';
 const result=await organizeOpenTabs({send,request:async(records,rules,key,model,signal,names,provider,preference)=>{assert.equal(preference,'按项目分类');state.preference='按主题分类';return plan(records);}});
 assert.equal(result.reason,'changed');assert.ok(state.records.every(r=>r.group==='待整理'));
});
test('explicit regroup includes manual pages even with an old local-rule marker',async()=>{
 const {state,send}=fixture(1);Object.assign(state.records[0],{manualGroup:true,ruleMatched:true,group:'手动调整',aiTitle:state.records[0].title});
 let calls=0;const result=await organizeOpenTabs({send,force:true,request:async records=>{calls++;return plan(records);}});
 assert.equal(calls,1);assert.equal(result.ai,1);assert.equal(state.records[0].group,'研究');
});
test('new evidence reopens accumulated uncertain pages while preserving established and manual groups',async()=>{
 const {state,send}=fixture(5);
 for(const r of state.records)r.aiTitle=r.title;
 state.records[1].group='旧主题';
 state.records[2].manualGroup=true;
 state.records[3].group='规则主题';state.config.rules=[{keyword:'Page 3',group:'规则主题'}];
 state.records[4].title='New topic';
 let calls=0;
 const result=await organizeOpenTabs({send,request:async(records,rules,key,model,signal,names,provider,preference,context)=>{
  calls++;assert.deepEqual(records.map(r=>r.id),['0','4']);
  assert.ok(context.workspaces.some(r=>r.group==='旧主题'));
  return {assignments:records.map(r=>({id:r.id,group:r.id==='0'?'新主题':'待整理'})),rules:[]};
 }});
 assert.equal(calls,1);assert.equal(result.unresolved,2);
 assert.equal(state.records[0].group,'新主题');assert.equal(state.records[1].group,'旧主题');
 assert.equal(state.records[2].group,'待整理');assert.equal(state.records[3].group,'规则主题');
 await organizeOpenTabs({send,request:()=>assert.fail('unchanged uncertainty must not loop')});
});
test('backlog review sees new evidence across batches and resumes after interruption',async()=>{
 const {state,send}=fixture(202);
 for(const r of state.records.slice(0,201))r.aiTitle=r.title;
 let calls=0;
 await assert.rejects(organizeOpenTabs({send,request:async(records,rules,key,model,signal,names,provider,preference,context)=>{
  calls++;
  if(calls===2)throw new Error('offline');
  assert.equal(records.length,200);assert.equal(context.pending[0].id,'201');
  return plan(records);
 }}),/offline/);
 const batches=[];
 await organizeOpenTabs({send,request:async records=>{batches.push(records.map(r=>r.id));return plan(records);}});
 assert.deepEqual(batches,[['200','201']]);
});

test('switching UI language while AI is running discards results from the previous language',async()=>{
 const {setLanguage}=await import('../extension/i18n.js');
 const {state,send}=fixture(1);
 try{
  setLanguage('zh');
  const result=await organizeOpenTabs({send,request:async records=>{setLanguage('en');return plan(records);}});
  assert.equal(result.reason,'changed');assert.equal(state.records[0].group,'待整理');
 }finally{setLanguage('zh');}
});
