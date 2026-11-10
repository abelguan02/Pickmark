import test from 'node:test';
import assert from 'node:assert/strict';
import {planPreviewEntries,PREVIEW_BYTES,PREVIEW_ITEMS,previewExclusion} from '../extension/thumbnail-policy.js';
const rows=(count,bytes=100000)=>Array.from({length:count},(_,i)=>({url:`https://cache.test/${i}`,at:Date.now()-i,bytes,sources:[]}));
test('independent image budget accommodates more than 100 images and 1.5 MB',()=>{
 const data=rows(300);const kept=planPreviewEntries(data,null);assert.equal(kept.length,300);assert.equal(kept.reduce((n,e)=>n+e.bytes,0),30_000_000);
 assert.equal(PREVIEW_BYTES,50_000_000);assert.equal(PREVIEW_ITEMS,500);
});
test('byte and item caps preserve the current list or reject before writing',()=>{
 const data=rows(500,100000),incoming={url:'https://new.test/',at:Date.now()+1,bytes:100000,sources:[]};
 assert.equal(planPreviewEntries(data,incoming).length,500);
 assert.throws(()=>planPreviewEntries(data,incoming,{preserveUrls:data.map(e=>e.url)}),e=>e.code==='PREVIEW_LIMIT');
 const large=rows(400,200000);assert.equal(planPreviewEntries(large,null).length,250);
});
test('skip causes distinguish email, excluded domain and unsupported pages',()=>{
 assert.equal(previewExclusion('https://mail.google.com/'),'email');assert.equal(previewExclusion('https://private.test/',['private.test']),'excluded');
 assert.equal(previewExclusion('chrome://settings/'),'unsupported');assert.equal(previewExclusion('https://normal.test/'),null);
});
