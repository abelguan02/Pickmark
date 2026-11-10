import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const scenario of ['ai','rules-only','no-key']){
  const page=await browser.newPage({locale:'zh-CN',viewport:{width:1400,height:1000}}),errors=[];let calls=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({hasKey})=>{
   const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
   const local={},session={},tabs=[];let boot;
   const storage=data=>({async get(keys){return structuredClone(Object.fromEntries((keys===null?Object.keys(data):Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])));},async getBytesInUse(keys=null){const encoder=new TextEncoder();return [...new Set(keys===null?Object.keys(data):Array.isArray(keys)?keys:[keys])].filter(k=>Object.hasOwn(data,k)).reduce((sum,k)=>sum+encoder.encode(k).length+encoder.encode(JSON.stringify(data[k])).length,0);},async set(patch){Object.assign(data,structuredClone(patch));},async remove(keys){keys.forEach(k=>delete data[k]);},async setAccessLevel(){}});
   window.historyTest={local,tabs,created:0};
   window.chrome={storage:{local:storage(local),session:storage(session),onChanged:event()},sidePanel:{async setPanelBehavior(){}},windows:{async update(){}},tabs:{onCreated:event(),onRemoved:event(),onUpdated:event(),onActivated:event(),async query(){return structuredClone(tabs);},async create(tab){historyTest.created++;tabs.push({...tab,id:100+tabs.length});return tabs.at(-1);},async update(){}},runtime:{id:'history-test',getURL:p=>new URL(p,location.origin).href,onInstalled:event(),onStartup:event(),onMessage:event(),async sendMessage(message){
    boot??=(async()=>{
     const {defaults,dayKey}=await import('./core.js');
     const day=dayKey(Date.now()-86400000),today=dayKey(),older=dayKey(Date.now()-2*86400000);
     const row={day,title:'Research page',domain:'example.test',group:'待整理',snapshotGroup:'待整理'};
     local.config={...defaults(),rules:[{keyword:'Guide',group:'Docs'}]};local.apiKeys={deepseek:hasKey?'intercepted-test-key':''};
     local.records=[{...row,id:'local',title:'Guide page',url:'https://example.test/guide'},{...row,id:'remote',url:'https://example.test/research'},{...row,id:'manual',url:'https://example.test/manual',manualGroup:true},{...row,id:'done',url:'https://example.test/done',group:'Existing',snapshotGroup:'Existing'},{...row,id:'older',day:older,url:'https://example.test/older'},{...row,id:'today',day:today,url:'https://example.test/today',group:'Current',snapshotGroup:'Current',aiTitle:row.title}];
     tabs.push({id:1,url:'https://example.test/today',title:row.title});
     await import('./background.js');
    })();await boot;
    return new Promise(resolve=>chrome.runtime.onMessage.listeners[0](message,{id:'history-test',url:location.href},resolve));
   }}};
  },{hasKey:scenario!=='no-key'});
  await page.route('https://api.deepseek.com/**',async route=>{
   calls++;const body=JSON.parse(route.request().postData()),input=JSON.parse(body.messages[1].content);
   assert.deepEqual(input.tabs.map(r=>r.id),['remote']);
   await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({assignments:[{id:'remote',group:'Research'}],suggestedRules:[]})}}]})});
  });
  await page.goto(`${process.env.PREVIEW_URL||'http://127.0.0.1:4173'}/dashboard.html`);
  await page.locator('.item').first().waitFor();await page.locator('[data-pm-view="history"]').click();
  assert.equal(await page.locator('#organize-history').textContent(),'补分类（2）');
  assert.equal(calls,0);assert.equal(await page.evaluate(()=>historyTest.created),0);
  await page.locator('#organize-history').click();await page.locator('#history-dialog[open]').waitFor();
  assert.equal(await page.locator('#history-preview > div').count(),2);assert.equal(calls,0);
  await page.locator('[data-close="history-dialog"]').first().click();assert.equal(calls,0);
  await page.locator('#organize-history').click();
  if(scenario==='rules-only')await page.locator('#history-use-ai').uncheck();
  if(scenario==='no-key')assert.equal(await page.locator('#history-use-ai').isDisabled(),true);
  await page.locator('#history-confirm').click();
  await page.waitForFunction(()=>historyTest.local.records.find(r=>r.id==='local').snapshotGroup==='Docs');
  if(scenario==='ai')await page.waitForFunction(()=>historyTest.local.records.find(r=>r.id==='remote').snapshotGroup==='Research');
  await page.waitForFunction(()=>!document.querySelector('#history-progress').hidden&&/完成|本地规则/.test(document.querySelector('#history-progress').textContent));
  assert.equal(calls,scenario==='ai'?1:0);assert.equal(await page.evaluate(()=>historyTest.created),0);
  const rows=await page.evaluate(()=>historyTest.local.records);
  assert.equal(rows.find(r=>r.id==='manual').manualGroup,true);assert.equal(rows.find(r=>r.id==='manual').snapshotGroup,'待整理');
  assert.equal(rows.find(r=>r.id==='done').snapshotGroup,'Existing');assert.equal(rows.find(r=>r.id==='older').group,'待整理');assert.equal(rows.find(r=>r.id==='today').group,'Current');
  await page.locator('#more-menu').evaluate(e=>e.open=true);await page.locator('#language-en').click();assert.match(await page.locator('#organize-history').textContent(),/Classify unsorted/);
  await page.locator('#more-menu').evaluate(e=>e.open=true);await page.locator('#language-zh').click();
  for(const width of [390,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.locator('#more-menu').evaluate(e=>e.open=true);await page.locator('[data-color-choice="dark"]').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('History UI passed with real workflow/worker and mocked Chrome/network: confirmation, cancellation, rules-only, missing key, closed pages, preservation, no tab opens, bilingual labels and narrow themes.');
}finally{await browser.close();}
