import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const c=await browser.newContext();
 await c.addInitScript(()=>localStorage.setItem('pickmark-guide-v1','seen'));
 await c.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4196/')?r.continue():r.abort());
 // Expose only the disposable demo instance. Closing is replaced with a recorder.
 await c.route('**/offset-ui.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('this.api=api;','this.api=api;window.reviewUI=this;')});});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));let cases=0;
 for(const width of [390,700,1440])for(const mode of ['tabs','bookmarks']){
  await p.setViewportSize({width,height:600});await p.goto('http://127.0.0.1:4196/dashboard.html');
  await p.waitForFunction(()=>window.reviewUI&&document.querySelector('.item'));
  await p.evaluate(()=>{window.closedRows=[];window.reviewUI.api.close=r=>window.closedRows.push(r.id);});
  if(mode==='bookmarks'){await p.locator('[data-mode=bookmarks]').click();await p.locator('[data-pm=connect]').click();}
  await p.locator('.item').first().hover();await p.keyboard.press('ArrowDown');
  for(let i=0;i<10;i++)await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(1100);
  const focus=await p.evaluate(()=>{const id=document.activeElement.closest('[data-row]').dataset.row;return window.reviewUI.rows.find(r=>r.id===id);});
  assert.ok(await p.evaluate(()=>scrollY>0),'Navigation must trigger scrolling');
  assert.equal(await p.evaluate(()=>window.reviewUI.selected.id),focus.id,'Scroll must not let parked mouse steal selection');
  await p.keyboard.press('Space');assert.equal(await p.locator('#mono-preview h2').textContent(),focus.title);await p.keyboard.press('Escape');
  for(const key of ['Delete','Backspace'])await p.keyboard.press(key);
  assert.deepEqual(await p.evaluate(()=>window.closedRows),mode==='tabs'?[focus.id,focus.id]:[]);
  // Move the mouse deliberately: hover may resume, but keyboard actions still use focus.
  const other=p.locator('.item').nth(8);await other.hover();await p.waitForTimeout(850);
  const otherId=await other.getAttribute('data-row');assert.equal(await p.evaluate(()=>window.reviewUI.selected.id),otherId);
  assert.equal(await p.evaluate(()=>document.activeElement.closest('[data-row]').dataset.row),focus.id);
  await p.keyboard.press('Space');assert.equal(await p.locator('#mono-preview h2').textContent(),focus.title);await p.keyboard.press('Escape');
  await other.hover();await p.mouse.move((await other.boundingBox()).x+40,(await other.boundingBox()).y+20);await p.waitForTimeout(850);
  for(const key of ['Delete','Backspace'])await p.keyboard.press(key);
  assert.deepEqual(await p.evaluate(()=>window.closedRows),mode==='tabs'?[focus.id,focus.id,focus.id,focus.id]:[]);
  await p.evaluate(()=>document.activeElement.blur());await p.keyboard.press('Delete');
  assert.equal(await p.evaluate(()=>window.closedRows.length),mode==='tabs'?4:0,'No focused row means no close');cases++;
 }
 assert.deepEqual(errors,[]);console.log(`PASS ${cases} mixed-input scenarios: keyboard scroll, hover handoff, focus-based Space/Delete/Backspace and bookmark protection`);
}finally{await browser.close();}
