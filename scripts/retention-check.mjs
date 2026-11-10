import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cleanupSnapshot} from '../extension/cleanup.js';
import {defaults,dayKey} from '../extension/core.js';
const results=[];
for(const count of [100,1000,10000]){
 const records=Array.from({length:count},(_,i)=>({id:String(i),day:dayKey(Date.now()-(i%90)*86400000),url:'https://synthetic.test/'+i,title:'Synthetic '+i,group:'Saved',manualGroup:i===0}));
 records[0].day=dayKey(Date.now()-100*86400000);records[0].group='Human';
 const start=performance.now(),p=cleanupSnapshot({config:defaults(),records},[{url:records[0].url}]);const ms=performance.now()-start;
 assert.equal(p.records.find(r=>r.url===records[0].url).group,'Human');assert.ok(p.records.length<=5000);assert.equal(p.visits,undefined);results.push({count,ms:+ms.toFixed(2),kept:p.records.length});
}
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await b.newPage({viewport:{width:1024,height:1000},locale:'zh-CN'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:4193';await p.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());await p.goto(base+'/dashboard.html');await p.locator('.item').first().waitFor();
 await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('atlas-demo')),original=d.records[0],old=new Date(Date.now()-60*86400000);const day=[old.getFullYear(),String(old.getMonth()+1).padStart(2,'0'),String(old.getDate()).padStart(2,'0')].join('-');d.records=Array.from({length:10000},(_,i)=>({...original,id:'old'+i,url:'https://synthetic.test/'+i,day}));d.records.push({...original,id:'open-manual',day,group:'Protected manual',manualGroup:true});d.visits=[{...original,day}];localStorage.setItem('atlas-demo',JSON.stringify(d));});
 await p.reload();await p.locator('[data-pm-view=settings]').click();await p.locator('#retention-days').waitFor();assert.equal(await p.locator('#retention-days').inputValue(),'30');
 p.once('dialog',d=>d.dismiss());await p.locator('#clear-old-history').click();assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('atlas-demo')).records.length),10001);
 p.once('dialog',d=>d.accept());await p.locator('#clear-old-history').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('atlas-demo')).records.length<10001);
 let d=await p.evaluate(()=>JSON.parse(localStorage.getItem('atlas-demo')));assert.ok(d.records.some(r=>r.group==='Protected manual'&&r.manualGroup));assert.ok(!d.records.some(r=>r.url.startsWith('https://synthetic.test/')));
 await p.locator('#retention-days').selectOption('7');p.once('dialog',d=>d.accept());await p.locator('#save-settings').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('atlas-demo')).config.retentionDays===7);
 await p.locator('[data-pm-view=settings]').click();assert.equal(await p.locator('#retention-days').inputValue(),'7');await p.locator('#language-en').click();assert.match(await p.locator('#storage-controls h3').innerText(),/Data and storage/);
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>document.querySelector('#rail-close').click());await p.waitForTimeout(250);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#storage-controls').scrollIntoViewIfNeeded();await p.locator('#storage-controls').screenshot({path:'docs/offset-live/retention-settings.png'});assert.deepEqual(errors,[]);
 console.log('PASS: confirmation cancellation, old history deletion, current manual preservation, saved retention, language and narrow layout.');
}finally{await b.close();}
fs.writeFileSync('docs/offset-live/retention-performance.json',JSON.stringify({note:'Synthetic data only; pure cleanup timing, not total browser memory',results},null,2));console.log(JSON.stringify(results));
