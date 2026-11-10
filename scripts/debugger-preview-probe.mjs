// Run headless by default. --headed requires the user's current idle consent.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const headed=process.argv.includes('--headed');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'pickmark-debugger-probe-'));
const colors=[[184,35,61],[31,91,178],[154,73,179],[217,116,29]];
const extension=path.join(root,'extension');
await fs.mkdir(extension);
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Pickmark debugger prototype',version:'1.0',permissions:['tabs','debugger'],background:{service_worker:'worker.js'}}));
await fs.copyFile(new URL('./debugger-preview-worker.js',import.meta.url),path.join(extension,'worker.js'));
const server=http.createServer((req,res)=>{
 const index=Number(new URL(req.url,'http://localhost').searchParams.get('color')||0)%colors.length;
 res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
 res.end(`<!doctype html><html style="background:rgb(${colors[index]});height:100%"><head><title>Local screenshot fixture ${index}</title></head><body><h1>Background screenshot prototype</h1><canvas width="160" height="160" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)"></canvas><script>setTimeout(()=>{const c=document.querySelector('canvas').getContext('2d');c.fillStyle='rgb(20,200,120)';c.fillRect(0,0,160,160);document.documentElement.dataset.ready='yes';},200);</script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let context;
const report={mode:headed?'headed':'headless',cases:[]};
const geometry=w=>Object.fromEntries(['left','top','width','height','state'].map(key=>[key,w[key]]));
try{
 context=await chromium.launchPersistentContext(path.join(root,'profile'),{headless:!headed,viewport:null,
  ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{channel:'chromium'}),
  ignoreDefaultArgs:['--enable-automation','--disable-extensions','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],
  args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
 report.browser=context.browser()?.version();
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 const owner=await worker.evaluate(url=>chrome.windows.create({url,focused:true,width:1100,height:850}),base+'/owner');
 // Headless Chrome on this host does not enter a real maximized state.
 // Only a headed run can satisfy that acceptance criterion.
 for(const state of (headed?['normal','maximized']:['normal'])){
  await worker.evaluate(async({id,state})=>{await chrome.windows.update(id,{state});await new Promise(r=>setTimeout(r,1000));},{id:owner.id,state});
  const result=await worker.evaluate(({id,urls})=>captureProbe(id,urls),{id:owner.id,urls:Array.from({length:8},(_,i)=>`${base}/page?color=${i%4}&run=${i}`)});
  report.cases.push({state,...result});
  assert.equal(result.before.state,state);
  assert.deepEqual(geometry(result.after),geometry(result.before),'Window geometry must stay unchanged');
  assert.equal(result.activeAfter,result.activeBefore);
  assert.deepEqual(result.remainingTargets,[],'Temporary target must be removed');
  assert.deepEqual(result.events,[],'No tab activation or Chrome window focus events during the batch');
  for(const [i,item] of result.results.entries()){
   assert.ok(item.width>100&&item.height>100);
   assert.deepEqual(item.background,colors[i%4],'Current page pixels, not a stale or foreground image');
   assert.deepEqual(item.canvas,[20,200,120],'Dynamic canvas must be rendered');
   assert.equal(item.active,result.activeBefore);
   assert.deepEqual(geometry(item.window),geometry(result.before));
   assert.equal(item.window.focused,result.before.focused);
  }
  console.log(`PASS ${report.mode} ${state}: ${result.results.length} correct screenshots, no focus/activation events, unchanged window, detached and closed`);
 }
}finally{
 await fs.writeFile(path.join(os.tmpdir(),`pickmark-debugger-${report.mode}.json`),JSON.stringify(report,null,2));
 try{await context?.close();}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
}
