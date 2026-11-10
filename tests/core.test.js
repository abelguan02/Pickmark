import test from 'node:test';
import {setLanguage} from '../extension/i18n.js';
setLanguage('zh'); // Error-copy assertions use a fixed locale, independent of the test host.
import assert from 'node:assert/strict';
import {defaults,dayKey,collect,eligible,normalizeDomain,excludedUrl,validatePlan,aiPayload,autoCandidates,canAssign} from '../extension/core.js';
import {organize} from '../extension/ai.js';
import {demoState} from '../extension/demo.js';
test('exclusion matches subdomains but never suffix lookalikes',()=>{
 assert.equal(normalizeDomain(' HTTPS://Mail.Google.Com '),'mail.google.com');
 assert.equal(excludedUrl('https://a.mail.google.com/inbox',['mail.google.com']),true);
 assert.equal(excludedUrl('https://mail.google.com./inbox',['mail.google.com']),true);
 assert.equal(normalizeDomain('localhost'),'localhost');
 assert.equal(excludedUrl('https://notmail.google.com/inbox',['mail.google.com']),false);
 for(const domain of ['mail.google.com/path','https://user:secret@example.com','https://example.com?token=x','']) {if(domain)assert.throws(()=>normalizeDomain(domain));}
 assert.equal(eligible({url:'https://example.com',incognito:true},defaults()),false);
 assert.equal(eligible({url:'chrome://settings'},defaults()),false);
});
test('collect deduplicates exact URLs per local day; activation does not imply read',()=>{
 const time=new Date(2026,8,15,10).getTime();const config=defaults();
 let records=collect([], [{id:1,url:'https://example.com/a',title:'One'},{id:2,url:'https://example.com/a',title:'Two'}],config,time,1);
 assert.equal(records.length,1);assert.equal(records[0].activations,1);assert.equal(Object.hasOwn(records[0],'status'),false);
 records[0].group='我的任务';
 records=collect(records,[{id:1,url:'https://example.com/a',title:'New'}],config,time+1000,1);
 assert.equal(records[0].group,'我的任务');assert.equal(records[0].activations,2);
 records=collect(records,[{id:1,url:'https://example.com/a'}],config,time+86400000);
 assert.equal(records.length,2);assert.equal(records[1].day,dayKey(time+86400000));assert.equal(records[1].group,'我的任务');
});
test('approved rules apply locally and exclusions remove existing records',()=>{
 const config={...defaults(),rules:[{keyword:'web-guide',group:'技术学习'}]};
 const records=collect([],[{id:1,url:'https://github.com/repo',title:'WEB-guide'}],config);
 assert.equal(records[0].group,'技术学习');
 assert.deepEqual(collect(records,[],{...config,excluded:['github.com']}),[]);
});
test('retention prunes dates older than 30 calendar days',()=>{
 const now=new Date(2026,8,15,10).getTime();
 const records=collect([],[{url:'https://example.com',title:'old'}],defaults(),now-30*86400000);
 assert.equal(collect(records,[],defaults(),now).length,0);
});
test('AI payload omits URL paths, queries, reading state, and behavior',()=>{
 const payload=aiPayload([{id:'a',title:'Title',domain:'example.com',url:'https://example.com/private?token=secret',activations:2,status:'已处理'}]);
 assert.deepEqual(payload,[{id:'a',title:'Title',domain:'example.com'}]);
});
test('AI validation rejects hallucinated, duplicate, missing IDs and bad groups',()=>{
 for(const assignments of [[{id:'other',group:'Work'}],[{id:'a',group:''}],[],[{id:'a',group:'Work'},{id:'a',group:'Work'}]])assert.throws(()=>validatePlan({assignments},['a']));
 assert.deepEqual(validatePlan({assignments:[{id:'a',group:' 工作 '}],suggestedRules:[{keyword:'ab',group:'工作'},{keyword:'x',group:'工作'}]},['a']),{assignments:[{id:'a',group:'工作'}],rules:[{keyword:'ab',group:'工作'}]});
});
test('39-title demo has no fabricated reading activity',()=>{
 const demo=demoState();assert.equal(demo.records.length,39);assert.equal(new Set(demo.tabs.map(t=>t.url)).size,39);assert.equal(new Set(demo.records.map(r=>r.group)).size,6);assert.ok(demo.records.every(r=>r.activations===0&&!Object.hasOwn(r,'status')));
});
test('DeepSeek request uses constrained metadata and handles failures',async t=>{
 const records=[{id:'a',title:'Title',domain:'example.com',url:'https://example.com/private'}];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');
  assert.equal(init.headers.Authorization,'Bearer test-key');
  assert.ok(!init.body.includes('/private'));
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({assignments:[{id:'a',group:'研究'}]})}}]}));
 });
 assert.equal((await organize(records,[],'test-key','deepseek-flash')).assignments[0].group,'研究');
 globalThis.fetch=async()=>new Response('',{status:401});
 await assert.rejects(organize(records,[],'key','model'),/API Key 无效/);
 globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'not JSON'}}]}));
 await assert.rejects(organize(records,[],'key','model'),/有效 JSON/);
 await assert.rejects(organize(records,[],'','model'),/API Key/);
});

test('auto AI handles only new or changed unpinned pages and caches uncertain results',()=>{
 const records=[
  {id:'new',title:'A',group:'待整理'},
  {id:'cached',title:'A',aiTitle:'A',group:'待整理'},
  {id:'changed',title:'B',aiTitle:'A',group:'研究'},
  {id:'manual',title:'B',aiTitle:'A',group:'研究',manualGroup:true},
  {id:'local-rule',title:'B',group:'本地规则匹配'}
 ];
 assert.deepEqual(autoCandidates(records).map(r=>r.id),['new','changed']);
});
test('late AI responses cannot override title changes or manual workspace moves',()=>{
 const record={title:'A',group:'研究',manualGroup:false};
 const assignment={baseTitle:'A',baseGroup:'研究',baseManual:false};
 assert.ok(canAssign(record,assignment));
 assert.ok(!canAssign({...record,title:'B'},assignment));
 assert.ok(!canAssign({...record,group:'我的任务',manualGroup:true},assignment));
 assert.ok(!canAssign(undefined,assignment));
});

test('AI assignments require every baseline field with its original type',()=>{
 const record={title:'A',group:'研究',manualGroup:false};
 const base={baseTitle:'A',baseGroup:'研究',baseManual:false};
 for(const key of Object.keys(base)){const assignment={...base};delete assignment[key];assert.ok(!canAssign(record,assignment),key);}
 for(const baseManual of [undefined,0,'',null])assert.ok(!canAssign(record,{...base,baseManual}));
 assert.ok(!canAssign({...record,manualGroup:true},{group:'覆盖'}));
});

test('unchanged collection keeps rows stable between minute checkpoints and preserves activation events',()=>{
 const now=new Date(2026,8,15,10).getTime(),config=defaults();
 const tabs=[{id:1,url:'https://same.test/',title:'First'},{id:2,url:'https://same.test/',title:'Last'}];
 const records=collect([],tabs,config,now),before=structuredClone(records);
 const unchanged=collect(records,tabs,config,now+1000);
 assert.deepEqual(unchanged,before);assert.equal(unchanged[0],records[0]);
 const checkpoint=collect(records,tabs,config,now+60000);
 assert.equal(checkpoint[0].lastSeen,now+60000);assert.deepEqual(records,before);
 const active=collect(records,tabs,config,now+2000,1);
 assert.equal(active[0].activations,1);assert.equal(active[0].lastActivated,now+2000);
 assert.equal(active[0].title,'Last');assert.deepEqual(records,before);
});

test('indexed collection preserves first-title rules, last nonempty titles and previous-day manual groups',()=>{
 const now=new Date(2026,8,15,10).getTime(),config={...defaults(),rules:[{keyword:'first',group:'Rule'}]};
 const old={id:'old',day:dayKey(now-86400000),url:'https://old.test/',title:'Old',group:'Human',manualGroup:true,aiTitle:'Old'};
 const tabs=[{id:1,url:'https://new.test/',title:'First'},{id:2,url:'https://new.test/',title:'Last'},{id:3,url:'https://new.test/',title:''},{id:4,url:old.url,title:'New title'}];
 const collected=collect([old],tabs,config,now,2);
 assert.equal(collected.length,3);assert.equal(collected[1].title,'Last');assert.equal(collected[1].group,'Rule');assert.equal(collected[1].activations,1);
 assert.equal(collected[2].group,'Human');assert.equal(collected[2].manualGroup,true);assert.equal(collected[2].aiTitle,'Old');
});

test('rule editing preserves priority and rejects duplicate keywords atomically', async()=>{
 const {updateRules,classify}=await import('../extension/core.js');
 const rules=[{keyword:'video',group:'视频'},{keyword:'example',group:'研究'}];
 const edited=updateRules(rules,{type:'rule',base:rules[0],value:{keyword:' VIDEO ',group:' 创作 '}});
 assert.deepEqual(edited,[{keyword:'VIDEO',group:'创作'},rules[1]]);
 assert.equal(classify('video example','example.com',edited),'创作');
 assert.deepEqual(updateRules(rules,{type:'rule',value:{keyword:'VIDEO',group:'新分组'}}),[{keyword:'VIDEO',group:'新分组'},rules[1]]);
 assert.throws(()=>updateRules(rules,{type:'rule',base:rules[0],value:{keyword:'EXAMPLE',group:'冲突'}}),/已有规则/);
 for(const value of [{keyword:' ',group:'研究'},{keyword:'ok',group:''},{keyword:'x'.repeat(81),group:'研究'},null])assert.throws(()=>updateRules(rules,{type:'rule',value}));
 assert.deepEqual(rules,[{keyword:'video',group:'视频'},{keyword:'example',group:'研究'}]);
});

test('rule operations target expected values after reordering and reject stale edits', async()=>{
 const {updateRules,classify}=await import('../extension/core.js');
 const rules=[{keyword:'video',group:'视频'},{keyword:'example',group:'研究'}];
 const moved=updateRules(rules,{type:'reorderRules',expected:rules,keyword:'example',target:'video'});
 assert.equal(classify('video example','example.com',moved),'研究');
 assert.deepEqual(updateRules(moved,{type:'deleteRule',base:rules[0]}),[rules[1]]);
 assert.deepEqual(updateRules(moved,{type:'reorderRules',expected:moved,keyword:'example',target:'example'}),moved);
 const changed=updateRules(rules,{type:'rule',base:rules[0],value:{keyword:'video',group:'创作'}});
 for(const type of ['deleteRule','rule'])assert.throws(()=>updateRules(changed,{type,base:rules[0],direction:1,value:{keyword:'video',group:'覆盖'}}),/其他窗口/);
 assert.throws(()=>updateRules(rules,{type:'deleteRule',index:0}),/请选择/);
});

test('drag sorting preserves other items and refuses stale rule lists',async()=>{
 const {updateRules,reorderByKey,orderedWorkspaces}=await import('../extension/core.js');
 const rules=[{keyword:'first',group:'甲'},{keyword:'second',group:'乙'},{keyword:'third',group:'丙'}];
 assert.deepEqual(updateRules(rules,{type:'reorderRules',expected:rules,keyword:'third',target:'first'}),[rules[2],rules[0],rules[1]]);
 assert.throws(()=>updateRules(rules.slice(1),{type:'reorderRules',expected:rules,keyword:'third',target:'second'}),/其他窗口/);
 assert.deepEqual(reorderByKey(['甲','乙','丙'],'甲','丙'),['乙','丙','甲']);
 assert.throws(()=>reorderByKey(['甲'],'甲','已删除'),/不存在/);
 assert.deepEqual(orderedWorkspaces([{group:'甲'},{group:'新卡片'}],{rules,workspaceOrder:['丙','乙','甲','已删除']}),['丙','乙','甲','新卡片']);
});

test('workspace management persists empty spaces and migrates records and rules atomically',async()=>{
 const {manageWorkspace,orderedWorkspaces}=await import('../extension/core.js');
 const original={config:{...defaults(),rules:[{keyword:'video',group:'创作'}],workspaceOrder:['创作','学习']},records:[{id:'a',url:'https://example.com',day:'2026-09-16',group:'创作'},{id:'b',url:'https://example.com',day:'2026-09-17',group:'创作'},{id:'c',group:'学习'}]};
 const created=manageWorkspace(original,{action:'create',name:'空工作区',expectedRevision:0});
 assert.ok(orderedWorkspaces(created.records,created.config).includes('空工作区'));
 const renamed=manageWorkspace(created,{action:'rename',name:'创作',target:'视频制作',expectedRevision:1});
 assert.deepEqual(renamed.config.workspaceOrder,['视频制作','学习']);assert.equal(renamed.config.rules[0].group,'视频制作');
 const removed=manageWorkspace(renamed,{action:'delete',name:'视频制作',target:'学习',expectedRevision:2});
 assert.equal(removed.records.length,3);
 assert.equal(removed.records[0].group,'学习');assert.equal(removed.records[0].manualGroup,true);assert.equal(removed.config.rules[0].group,'学习');
 assert.ok(!orderedWorkspaces(removed.records,removed.config).includes('视频制作'));
 assert.equal(original.records[0].group,'创作');
 const emptyDeleted=manageWorkspace(removed,{action:'delete',name:'空工作区',target:'待整理',expectedRevision:3});
 assert.ok(!orderedWorkspaces(emptyDeleted.records,emptyDeleted.config).includes('空工作区'));
 for(const message of [{action:'delete',name:'学习',target:'不存在',expectedRevision:4},{action:'delete',name:'学习',target:'学习',expectedRevision:4},{action:'rename',name:'学习',target:'待整理',expectedRevision:4},{action:'create',name:'学习',expectedRevision:4},{action:'delete',name:'学习',target:'待整理',expectedRevision:0}])assert.throws(()=>manageWorkspace(emptyDeleted,message));
});

test('manual rule creation respects the backup format limit without preventing edits',async()=>{
 const {updateRules}=await import('../extension/core.js');
 const rules=Array.from({length:1000},(_,i)=>({keyword:`keyword-${i}`,group:'研究'}));
 assert.throws(()=>updateRules(rules,{type:'rule',value:{keyword:'new-keyword',group:'新增'}}),/1,000/);
 const edited=updateRules(rules,{type:'rule',base:rules[0],value:{keyword:rules[0].keyword,group:'改名'}});
 assert.equal(edited.length,1000);assert.equal(edited[0].group,'改名');
});

test('legacy reading status migration preserves page data and workspace snapshots',async()=>{
 const {removeReadingStatus}=await import('../extension/core.js');
 const page={id:'legacy',url:'https://example.com/history',title:'保留标题',group:'当前工作区',snapshotGroup:'历史工作区',day:'2026-09-17',firstSeen:10,activations:3,manualGroup:true};
 const legacy={...page,status:'已处理',snapshotStatus:'进行中'};
 const migrated=removeReadingStatus([legacy]);
 assert.deepEqual(migrated,[page]);assert.equal(legacy.status,'已处理');
 assert.equal(removeReadingStatus(migrated)[0],migrated[0]);
});
