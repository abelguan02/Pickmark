// Synthetic demo UI, isolated headless browser, no external requests or AI fees.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve('extension');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',types[path.extname(name)]||'application/octet-stream');res.end(await fs.readFile(root+name));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'}),network=[],errors=[];
 await context.addInitScript(()=>{localStorage.setItem('pickmark-guide-v1','seen');localStorage.setItem('atlas-language-v1','zh');});
 await context.route('**/*',route=>{if(route.request().url().startsWith(base+'/'))return route.continue();network.push(route.request().url());return route.abort();});
 await context.route('**/offset-ui.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('this.api=api;','this.api=api;window.groupingUI=this;')});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/dashboard.html');await page.locator('.item').first().waitFor();
 await page.evaluate(()=>{
  const ui=groupingUI,state=ui.api.state(),base=state.records[0];
  state.records=[['www.youtube.com','AI 教程','AI与工具',true],['m.youtube.com','音乐现场','影音娱乐',false],['github.com','代码仓库','开发技术',false],['mail.google.com','邮件','工作',false],['maps.google.com','地图','生活',false]].map(([domain,title,group,manualGroup],i)=>({...base,id:'fixture-'+i,day:state.today,title,domain,url:'https://'+domain+'/fixture-'+i,group,snapshotGroup:group,manualGroup}));
  state.tabs=state.records.map((r,i)=>({id:100+i,url:r.url,title:r.title,windowId:1}));
  ui.book={rows:state.records.map((r,i)=>({...r,id:'book-'+i,folder:i%2?'Folder B':'Folder A',folderId:String(i%2)})),groups:['AI与工具','影音娱乐','开发技术','工作','生活'],rules:[],revision:0};
  window.groupingRecordsBefore=structuredClone(state.records);window.groupingBookmarksBefore=structuredClone(ui.book.rows);
  window.groupingMessages=[];const send=ui.api.send;ui.api.send=message=>{groupingMessages.push(message.type);return send(message);};
  ui.api.render();
 });
 const choose=value=>page.locator(`[data-pm-grouping=${value}]`).click();
 await choose('site');assert.equal(await page.evaluate(()=>groupingUI.allowsAuto),false);
 assert.equal(await page.locator('.site-section').count(),4);assert.equal(await page.locator('.item').count(),5);
 assert.equal(await page.locator('[data-pm=regroup]').count(),0);assert.equal(await page.locator('#mono-hero [data-pm=organize]').count(),0);
 await page.locator('[data-pm-filter="youtube.com"]').click();assert.equal(await page.locator('.item').count(),2);
 assert.deepEqual(await page.locator('.item-title').allTextContents(),['AI 教程手动','音乐现场']);
 await page.locator('#mono-search-toggle').click();await page.locator('#search').fill('AI');assert.equal(await page.locator('.item').count(),1);
 await page.locator('#search').fill('');await choose('topic');assert.equal(await page.locator('.site-section').count(),0);
 assert.equal(await page.locator('[data-pm-filter="AI与工具"]').count(),1);
 await page.evaluate(()=>{const ui=groupingUI;if(JSON.stringify(ui.api.state().records)!==JSON.stringify(groupingRecordsBefore))throw Error('Topic data changed during switching');});
 await choose('site');await page.locator('[data-pm-layout=gallery]').click();assert.equal(await page.locator('.gallery-card').count(),5);assert.equal(await page.locator('.site-section').count(),4);
 await page.locator('[data-mode=bookmarks]').click();await choose('site');assert.equal(await page.locator('.site-section').count(),4);assert.equal(await page.locator('[data-pm=book-ai]').count(),0);
 await choose('topic');assert.equal(await page.locator('[data-pm=book-ai]').count(),1);
 assert.deepEqual(await page.evaluate(()=>groupingUI.grouping),{tabs:'site',bookmarks:'topic'});
 assert.deepEqual(await page.evaluate(()=>groupingUI.book.rows),await page.evaluate(()=>groupingBookmarksBefore));
 // The original folder view remains available and does not overwrite grouping.
 await page.locator('[data-pm-view=folders]').click();assert.equal(await page.locator('[data-pm-filter="Folder A"]').count(),1);
 await page.locator('[data-pm-view=smart]').click();assert.equal(await page.locator('[data-pm-filter="AI与工具"]').count(),1);
 await choose('site');
 for(const width of [1280,800,390,320]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Grouping controls overflow at ${width}`);
  for(const value of ['site','topic']){
   const button=page.locator(`[data-pm-grouping=${value}]`),bounds=await button.boundingBox();assert.ok(bounds.width>=60,'Text grouping controls must not use square icon widths');
  }
 }
 await page.setViewportSize({width:1440,height:1000});await page.locator('[data-pm=search-close]').click();await page.screenshot({path:'/tmp/pickmark-020-website.png'});
 await page.evaluate(()=>{
  const ui=groupingUI,base=ui.book.rows[0];ui.book.rows=Array.from({length:301},(_,i)=>({...base,id:'paged-'+i,url:'https://'+(i<150?'youtube.com':'github.com')+'/page-'+i,domain:i<150?'youtube.com':'github.com',title:'Paged '+i}));ui.api.render();
 });
 assert.equal(await page.locator('.item').count(),100);assert.equal(await page.locator('.site-section').count(),1);
 await page.locator('[data-pm-page="1"]').click();assert.equal(await page.locator('.item').count(),100);assert.equal(await page.locator('.site-section').count(),2);
 await page.locator('[data-pm-filter="youtube.com"]').click();assert.equal(await page.locator('.item').count(),100);
 await page.locator('[data-pm-page="1"]').click();assert.equal(await page.locator('.item').count(),50);
 await page.evaluate(()=>{groupingUI.book.rows=structuredClone(groupingBookmarksBefore);groupingUI.api.render();});
 await choose('topic');await page.locator('[data-mode=tabs]').click();
 assert.equal(await page.locator('[data-pm-grouping=site]').getAttribute('aria-pressed'),'true');
 assert.deepEqual(await page.evaluate(()=>groupingMessages.filter(type=>/^(classify|assign|bookAI:)/.test(type))),[]);
 await page.reload();await page.locator('[data-pm-grouping=site]').waitFor();
 assert.equal(await page.locator('[data-pm-grouping=site]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-mode=bookmarks]').click();assert.equal(await page.locator('[data-pm-grouping=topic]').getAttribute('aria-pressed'),'true');
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 console.log('PASS website/topic controls, normalized YouTube groups and separate Google services, filtering/search/gallery, 301-bookmark website pagination, original folders, unchanged topic/manual/bookmark data, independent persisted preferences, no AI messages/external requests, widths 320–1440.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
