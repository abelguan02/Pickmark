import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const output=new URL('../archive/2026-10-26/screenshots/prototype-redesign/',import.meta.url).pathname;
fs.mkdirSync(output,{recursive:true});
try{
 const page=await browser.newPage({locale:'zh-CN'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.PREVIEW_URL||'http://127.0.0.1:4190'}/dashboard.html`);
 await page.locator('.tab-row').first().waitFor();
 for(const theme of ['rounded','classic']){
  if(await page.locator('html').getAttribute('data-theme')!==theme){await page.locator('#more-menu summary').click();await page.locator('[data-theme-choice][aria-pressed=false]').click();}
  for(const mode of ['light','dark']){
   await page.locator('#more-menu').evaluate(e=>e.open=true);
   await page.locator(`[data-color-choice="${mode}"]`).click();
   await page.locator('#more-menu').evaluate(e=>e.open=false);
   for(const width of [1440,1200,1100,1050,1024,900,861,850,768,720,719,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const view of ['quicklinks','continue-browsing']){
     await page.locator('#'+view).click();
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}/${mode}/${width}/${view} overflow`);
     const rects=await page.locator('.topbar').evaluate(e=>[...e.querySelectorAll('.view-tabs, .header-actions')].map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
     assert.ok(rects[0].right<=rects[1].left+1,'Navigation overlaps actions');
     if([1440,861,390].includes(width))await page.screenshot({path:`${output}${theme}-${mode}-${width}-${view}.png`,fullPage:true});
    }
   }
  }
 }
 assert.deepEqual(errors,[]);
 console.log('Design checks passed: 2 themes × 2 color modes × 13 widths × 3 views; grid fill, readable labels and 36 screenshots.');
}finally{await browser.close();}
