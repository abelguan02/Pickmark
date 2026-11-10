import test from 'node:test';
import assert from 'node:assert/strict';
import {siteKey,siteSections,groupingPreferences} from '../extension/grouping.js';

test('website groups combine www and mobile variants while keeping separate services and full hostnames',()=>{
 for(const domain of ['youtube.com','www.youtube.com','m.youtube.com'])assert.equal(siteKey({domain}),'youtube.com');
 for(const domain of ['mail.google.com','maps.google.com','docs.google.com','example.co.uk','www.com','127.0.0.1','[::1]'])assert.equal(siteKey({domain}),domain);
 assert.equal(siteKey({domain:'WWW.YouTube.COM'}),'youtube.com');
});
test('website aggregation preserves topic and manual data and keeps every distinct page',()=>{
 const rows=[{id:'a',domain:'www.youtube.com',group:'AI',manualGroup:true},{id:'b',domain:'github.com',group:'开发'},{id:'c',domain:'m.youtube.com',group:'音乐'}];
 const before=structuredClone(rows),sections=siteSections(rows);
 assert.deepEqual(sections.map(s=>[s.name,s.rows.map(r=>r.id)]),[['github.com',['b']],['youtube.com',['a','c']]]);
 assert.deepEqual(rows,before);assert.equal(sections[1].rows[0],rows[0]);
});
test('grouping preferences default to topics and validate tabs/bookmarks independently',()=>{
 assert.deepEqual(groupingPreferences(),{tabs:'topic',bookmarks:'topic'});
 assert.deepEqual(groupingPreferences({tabs:'site',bookmarks:'topic'}),{tabs:'site',bookmarks:'topic'});
 assert.deepEqual(groupingPreferences({tabs:'invalid',bookmarks:'site'}),{tabs:'topic',bookmarks:'site'});
});
