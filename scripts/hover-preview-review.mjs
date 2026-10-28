import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base='http://127.0.0.1:4196';
try {
 const context=await browser.newContext({viewport:{width:700,height:844}});
 await context.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/dashboard.html');await p.locator('.item').first().waitFor();
 let cases=0;
 for(const mode of ['tabs','bookmarks']){
  await p.locator(`[data-mode=${mode}]`).click();
  if(mode==='bookmarks')await p.locator('[data-pm=connect]').click();
  for(const theme of ['light','dark'])for(const width of [320,390,700,838,1440]){
   await p.setViewportSize({width,height:844});
   await p.evaluate(t=>window.atlasColorMode.set(t),theme);
   await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(200);
   await p.mouse.move(1,1);
   const row=p.locator('.item').first();await row.hover();await p.waitForTimeout(900);
   assert.equal(await p.locator('#inspector').getAttribute('aria-hidden'),'false',`${mode}/${theme}/${width}`);
   const box=await p.locator('#inspector').boundingBox(),r=await row.boundingBox();
   assert.ok(box&&box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=844);
   assert.equal(await p.locator('#inspector').evaluate(e=>getComputedStyle(e).zIndex),'-1','Preview stays underneath rows');
   assert.equal(await row.locator('.row-details').evaluate(e=>getComputedStyle(e,'::before').mixBlendMode),'difference','Retain overlap contrast');
   assert.ok(await p.locator('#inspector .placeholder-art').isVisible());
   let previous=null;
   for(const index of [0,2,6]){
    const current=p.locator('.item').nth(index);await current.hover();await p.waitForTimeout(850);
    const geometry=await current.evaluate(e=>{
     const row=e.getBoundingClientRect(),preview=document.querySelector('#inspector').getBoundingClientRect();
     return {y:preview.top,right:preview.right,rowTop:row.top,rowBottom:row.bottom,bottom:preview.bottom};
    });
    assert.ok(geometry.y>=0&&geometry.bottom<=844,'Grouped preview remains within viewport');
    assert.ok(geometry.y<geometry.rowBottom&&geometry.bottom>geometry.rowTop,'Active row overlaps preview');
    if(previous!==null)assert.ok(geometry.y>=previous-1,'Preview moves down only after traversal');
    previous=geometry.y;
   }
   if(width===700)await p.screenshot({path:`/tmp/hover-preview-${mode}-${theme}.png`});
   await row.locator('[data-pm-actions]').click();assert.ok(await p.locator('#mono-row-menu').isVisible());
   assert.equal(await p.locator('#inspector').getAttribute('aria-hidden'),'true');
   await p.keyboard.press('Escape');cases++;
  }
 }
 await p.setViewportSize({width:700,height:844});await p.locator('.item').nth(2).hover();await p.waitForTimeout(600);
 await p.mouse.wheel(0,120);await p.waitForTimeout(50);
 assert.equal(await p.locator('#inspector').getAttribute('aria-hidden'),'true','Hide during scroll');
 await p.waitForTimeout(850);
 assert.equal(await p.locator('#inspector').getAttribute('aria-hidden'),'false','Resume on settled pointer');
 await p.mouse.move(5,5);await p.waitForTimeout(50);
 assert.equal(await p.locator('#inspector').getAttribute('aria-hidden'),'true');
 // Seed a synthetic cached screenshot in the isolated module, never capture a real site.
 await context.route('**/offset-ui.js',async route=>{
  const response=await route.fetch();let source=await response.text();
  const sample='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#356acc"/><text x="40" y="80" fill="white" font-size="30">SIMULATED PREVIEW</text></svg>');
  // Seed the row actually being rendered, independently of demo URL paths.
  assert.ok(source.includes('previewMarkup(r,blocked=false){'),'Preview fixture insertion point exists');
  source=source.replace('previewMarkup(r,blocked=false){',`previewMarkup(r,blocked=false){this.cacheThumbnail(r.url,${JSON.stringify(sample)});`);
  await route.fulfill({response,body:source});
 });
 await p.reload();await p.locator('.item').first().waitFor();await p.mouse.move(1,1);await p.locator('.item').first().hover();await p.waitForTimeout(900);
 assert.ok(await p.locator('#inspector img').isVisible());
 assert.ok(await p.locator('#inspector img').evaluate(e=>e.complete&&e.naturalWidth===640));
 await p.screenshot({path:'/tmp/hover-preview-cached.png'});
 await p.locator('.item').nth(4).hover();await p.waitForTimeout(900);
 const overlap=await p.locator('.item').nth(4).boundingBox(),preview=await p.locator('#inspector').boundingBox();
 assert.ok(preview.y<overlap.y+overlap.height&&preview.y+preview.height>overlap.y,'Preview overlaps the active lower row');
 await p.screenshot({path:'/tmp/hover-preview-overlap.png'});
 assert.deepEqual(errors,[]);console.log(`PASS ${cases} source/theme/width combinations, menus, scroll, pointer leave and simulated cached image`);
} finally {await browser.close();}
