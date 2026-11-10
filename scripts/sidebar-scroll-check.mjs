// Many-category navigation in a disposable demo context. No real tabs/bookmarks.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4196';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:720},locale:'zh-CN'});
 await context.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await context.route('**/offset-ui.js',async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text()).replace('this.api=api;','this.api=api;window.sidebarReview=this;')});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/dashboard.html');await page.locator('.item').first().waitFor();
 await page.evaluate(()=>{
  const ui=sidebarReview,state=ui.api.state(),groups=Array.from({length:60},(_,i)=>`分类 ${String(i+1).padStart(2,'0')}${i===51?' / "AI" & 研究':''}`);
  const rows=groups.map((group,i)=>({id:'sidebar-'+i,url:'https://synthetic.example/'+i,title:'Example · Synthetic page '+i,domain:'synthetic.example',group,snapshotGroup:group,folder:group,day:state.today,manualGroup:i===0}));
  state.records=rows;state.tabs=rows.map(({id,url})=>({id,url}));state.hasKey=false;
  Object.assign(state.config,{workspaces:groups,workspaceOrder:groups,rules:[]});
  ui.book={rows:structuredClone(rows),groups:[...groups],rules:[],icons:{},revision:1};ui.api.render();
 });
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 async function openRail(){if(await page.evaluate(()=>innerWidth<=800&&!document.querySelector('#rail').classList.contains('open')))await page.locator('#menu').click();}
 const category=name=>page.locator(`#nav [data-pm-filter^="${name}"]`);
 async function geometry(name){return category(name).evaluate(button=>{
  const scroll=button.closest('.nav-scroll'),r=button.getBoundingClientRect(),s=scroll.getBoundingClientRect();
  return {scroll:scroll.scrollTop,y:r.y,top:s.top,bottom:s.bottom,rowBottom:r.bottom};
 });}
 async function checkSelection(name,before,label){
  await settle();await openRail();
  const after=await geometry(name);
  assert.ok(Math.abs(after.scroll-before.scroll)<=1,`${label}: scroll changed ${before.scroll} → ${after.scroll}`);
  assert.ok(Math.abs(after.y-before.y)<=1,`${label}: clicked category moved ${before.y} → ${after.y}`);
  assert.ok(after.y>=after.top-1&&after.rowBottom<=after.bottom+1,`${label}: selected category remains visible`);
  assert.equal(await category(name).evaluate(e=>e.classList.contains('active')),true);
  assert.ok((await page.locator('#mono-list .scope strong').innerText()).includes(name));
  assert.equal(await page.locator('#mono-list .item').count(),1,'Only the chosen category is displayed');
 }
 let cases=0;
 for(const source of ['tabs','folders','smart'])for(const lang of ['zh','en'])for(const theme of ['light','dark'])for(const width of [390,1280])for(const density of ['compact','comfortable']){
  await page.setViewportSize({width,height:720});
  await page.locator('#language-'+lang).evaluate(e=>e.click());await page.evaluate(value=>atlasColorMode.set(value),theme);
  await page.evaluate(({source,density})=>{
   const ui=sidebarReview;document.querySelector('#nav-filter').value='';
   ui.mode=source==='tabs'?'tabs':'bookmarks';ui.bookView=source==='tabs'?'folders':source;
   ui.filters={tabs:'',bookmarks:''};ui.density=density;ui.api.render();
  },{source,density});
  await settle();await openRail();
  assert.equal(await page.locator('.nav-scroll').evaluate(e=>e.scrollHeight>e.clientHeight),true);
  const name='分类 52',label=`${source}/${lang}/${theme}/${width}/${density}`;
  await category(name).scrollIntoViewIfNeeded();const before=await geometry(name);
  await category(name).click();await checkSelection(name,before,label);
  const next='分类 53';await category(next).scrollIntoViewIfNeeded();await category(next).focus();
  const keyboard=await geometry(next);await page.keyboard.press('Enter');await checkSelection(next,keyboard,label+'/keyboard');
  if(width>800)assert.equal(await category(next).evaluate(e=>e===document.activeElement),true,'Keyboard focus survives the render');
  await page.evaluate(()=>sidebarReview.api.render());await checkSelection(next,keyboard,label+'/refresh');
  await page.locator('#nav-filter').fill('分类 4');
  await category('分类 45').scrollIntoViewIfNeeded();const filtered=await geometry('分类 45');
  await category('分类 45').click();await checkSelection('分类 45',filtered,label+'/search');
  assert.equal(await page.locator('#nav-filter').inputValue(),'分类 4');
  assert.equal(await page.locator('#nav [data-pm-filter]:visible').count(),11,'Search remains applied after rendering, plus All');
  cases++;
 }
 assert.deepEqual(errors,[]);
 console.log(`PASS ${cases} source/language/theme/width/density cases with 60 categories: lower-row click, keyboard selection, refresh, search, visible selection and independent list filtering.`);
}finally{await browser.close();}
