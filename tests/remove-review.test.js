import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../extension/',import.meta.url);
test('shipped UI and resources remove review while preserving the resume calendar and optional previews',()=>{
 for(const file of ['review.js','review-model.js','swimlane.js','activity.js','activity-worker.js','media.js'])assert.equal(fs.existsSync(new URL(file,root)),false,file);
 const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
 assert.equal(manifest.content_scripts,undefined);assert.ok(!manifest.permissions.includes('idle'));assert.ok(manifest.permissions.includes('scripting'));assert.ok(manifest.permissions.includes('alarms'));
 assert.deepEqual(manifest.optional_host_permissions,['<all_urls>']);
 const html=fs.readFileSync(new URL('dashboard.html',root),'utf8');
 assert.doesNotMatch(html,/id="(?:daily-review|review-dashboard|review-metrics|idle-seconds)"/);
 for(const id of ['day','recap','restore-day','organize-history'])assert.ok(html.includes(`id="${id}"`),id);
 for(const file of ['style.css','offset-theme.css','offset-live.css']){
  const css=fs.readFileSync(new URL(file,root),'utf8');
  assert.equal((css.match(/\/\*/g)||[]).length,(css.match(/\*\//g)||[]).length,`${file}: balanced comments`);
  assert.doesNotMatch(css,/\.rv-|\.review-(?:card|dashboard|metrics)|\.swimlane/);
 }
});
