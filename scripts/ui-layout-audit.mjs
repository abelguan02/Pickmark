import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4194';
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN',reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
 const p=await context.newPage(),errors=[],issues=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/dashboard.html');await p.locator('.item').first().waitFor();
 const nav=async view=>{
  if(view==='settings'){await p.locator('#settings').evaluate(e=>e.click());return;}
  if(view==='rules'){await nav('manage');await p.locator('#classification-navigation [data-pm-view=rules]').click();return;}
  if(await p.locator('#menu').isVisible())await p.locator('#menu').click();
  await p.locator(`.nav-dock [data-pm-view=${view}],.nav-primary [data-pm-view=${view}]`).click();
 };
 for(const mode of ['tabs','bookmarks']){
  await p.locator('#brand').evaluate(e=>e.click());await p.locator(`[data-mode=${mode}]`).click();
  if(mode==='bookmarks')await p.locator('#mono-list [data-pm=connect]').click();
  for(const scheme of ['light','dark'])for(const width of [1440,1023,818,390,320]){
   await p.setViewportSize({width,height:844});await p.evaluate(s=>window.atlasColorMode.set(s),scheme);
   for(const view of mode==='tabs'?['workspace','history','manage','rules','settings']:['folders','smart','manage','rules','settings']){
    await nav(view);await p.waitForTimeout(30);
    const bad=await p.evaluate(()=>[...document.querySelectorAll('main button,main input,main select,main textarea,main label,main .help')].filter(e=>e.checkVisibility()&&!e.closest('[hidden]')).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1);}).map(e=>e.id||e.className||e.tagName));
    if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)||bad.length)issues.push({mode,scheme,width,view,bad:bad.slice(0,6)});
    if(view==='settings'){
     if(width<=1100)assert.equal(await p.locator('#settings-form .settings-grid').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1,'Narrow settings should use one column');
     for(const row of await p.locator('#mono-appearance .setting-row').all()){
      const content=await row.locator('div').boundingBox(),button=await row.locator('button').boundingBox();
      assert.ok(Math.abs(content.y-button.y)<1,'Setting toggle should align with its text');
     }
    }
    if((width===390||width===1440)&&mode==='tabs'&&['workspace','rules','settings','review'].includes(view))await p.screenshot({path:`/tmp/pickmark-audit-${view}-${scheme}-${width}.png`,fullPage:true,animations:'disabled'});
    if(['workspace','folders','smart'].includes(view)){
     await p.locator('[data-pm-layout=gallery]').click();
     assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Gallery overflow');
     await p.locator('[data-pm-density=compact]').click();
    }
   }
  }
 }
 await p.setViewportSize({width:390,height:844});await p.locator('#brand').evaluate(e=>e.click());
 for(const scheme of ['light','dark']){
  await p.evaluate(s=>window.atlasColorMode.set(s),scheme);
  await p.locator('.item [data-pm-actions]').first().click();await p.locator('#mono-row-menu [data-pm-edit]').click();
  const dialog=p.locator('#tab-dialog');await dialog.waitFor();
  const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0,'Classification dialog fits narrow screen');
  await p.locator('#tab-form button.primary').scrollIntoViewIfNeeded();assert.ok(await p.locator('#tab-form button.primary').isVisible());await p.keyboard.press('Escape');
 }
 console.log(JSON.stringify({issues,errors}));assert.deepEqual(issues,[]);assert.deepEqual(errors,[]);
 console.log('PASS 110 page/theme/width combinations, visible control bounds and page overflow');
}finally{await browser.close();}
