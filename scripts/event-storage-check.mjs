import assert from 'node:assert/strict';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const context=await chromium.launchPersistentContext('',{
 ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),
 headless:true,ignoreDefaultArgs:['--disable-extensions'],
 args:[`--load-extension=${path.resolve('extension')}`,`--disable-extensions-except=${path.resolve('extension')}`]
});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 const extensionId=new URL(worker.url()).hostname,url='https://event-storage.test/page';
 await context.route('https://event-storage.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Test page</title><h1>Storage regression fixture</h1>'}));
 const first=await context.newPage();await first.goto(url);
 const second=await context.newPage();await second.goto(url);await second.evaluate(()=>document.title='Second copy');
 const dashboard=await context.newPage(),errors=[];dashboard.on('pageerror',error=>errors.push(error.message));
 await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
 await dashboard.locator('#pickmark-guide [data-skip]').click();
 const message=input=>dashboard.evaluate(async input=>{
  const response=await chrome.runtime.sendMessage(input);if(response.error)throw Error(response.error);return response.value;
 },input);
 await dashboard.locator('#mono-list .item').first().waitFor();
 let state=await message({type:'get'});
 assert.equal(state.records.filter(row=>row.url===url).length,1);
 const secondId=state.tabs.findLast(tab=>tab.url===url).id;
 await dashboard.evaluate(()=>{
  globalThis.storageMetrics={recordChanges:0};
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.records)storageMetrics.recordChanges++;});
 });
 await second.evaluate(()=>{for(let i=0;i<40;i++)document.title='Burst '+i;});
 await dashboard.waitForFunction(()=>storageMetrics.recordChanges>0);
 assert.equal((await message({type:'get'})).records.find(row=>row.url===url).title,'Burst 39');
 const burst=await dashboard.evaluate(()=>({...storageMetrics}));
 assert.ok(burst.recordChanges>0&&burst.recordChanges<=2,JSON.stringify(burst));
 const before=burst.recordChanges;
 await message({type:'get'});await message({type:'get'});
 assert.equal(await dashboard.evaluate(()=>storageMetrics.recordChanges),before);
 await dashboard.locator('[data-pm="refresh"]').click();
 await dashboard.waitForFunction(()=>document.querySelector('#mono-list .item-title')?.textContent.includes('Burst 39'));
 const row=dashboard.locator('#mono-list .item').first();await row.locator('.item-main').focus();
 await Promise.all([second.waitForEvent('close'),row.locator('.item-main').press('Delete')]);
 assert.equal(first.isClosed(),false);
 state=await message({type:'get'});assert.equal(state.tabs.some(tab=>tab.id===secondId),false);
 const record=state.records.find(row=>row.url===url),firstId=state.tabs.find(tab=>tab.url===url).id;
 await message({type:'patch',id:record.id,value:{group:'Human'}});
 await message({type:'assign',assignments:[{id:record.id,group:'Incomplete AI'}]});
 assert.equal((await message({type:'get'})).records.find(row=>row.id===record.id).group,'Human');
 await first.goto('https://event-storage.test/changed');
 await assert.rejects(message({type:'closeTab',id:record.id,tabId:firstId}));
 assert.equal(first.isClosed(),false);
 assert.deepEqual(errors,[]);
 console.log(`Real extension regression passed: ${burst.recordChanges} persisted records change(s) for 40 title changes, unchanged syncs leave records stable, keyboard close targets the displayed duplicate, stale close and incomplete AI assignments are rejected.`);
}finally{await context.close();}
