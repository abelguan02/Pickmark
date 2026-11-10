import test from 'node:test';
import assert from 'node:assert/strict';
import {FAV} from '../extension/offset-icons.js';
import {OffsetUI} from '../extension/offset-ui.js';

const row=(domain,title='Video title')=>({id:'site',domain,title,url:`https://${domain}/watch?v=test`,group:'Media'});
const render=record=>OffsetUI.prototype.row.call({},record,false,'workspace');

test('www YouTube rows show the site name and a Y badge with the existing YouTube color',()=>{
 const record=row('www.youtube.com');
 assert.match(render(record),/<strong>youtube<\/strong>/);
 assert.match(FAV(record),/>Y<\/span>/);
 assert.match(FAV(record),/--fc:#FF0033/);
 assert.match(render(record),/www\.youtube\.com/,'the full hostname remains visible in metadata');
 assert.equal(record.domain,'www.youtube.com');
});

test('www and bare hostnames share their badge and display name',()=>{
 for(const domain of ['youtube.com','github.com','example.org']){
  assert.equal(FAV(row('www.'+domain)),FAV(row(domain)));
  const label=domain.split('.')[0];
  assert.match(render(row('www.'+domain)),new RegExp(`<strong>${label}</strong>`));
 }
});

test('meaningful subdomains and existing explicit display labels remain intact',()=>{
 assert.match(render(row('mail.google.com')),/<strong>mail<\/strong>/);
 const record=row('www.youtube.com','YouTube · Video title');
 assert.match(render(record),/<strong>YouTube<\/strong>/);
 assert.match(FAV(record),/>Y<\/span>/);
});

test('extension rows request the Chrome favicon for the exact HTTP page without third-party URLs',()=>{
 const previous=globalThis.chrome;
 globalThis.chrome={runtime:{getURL:path=>'chrome-extension://test/'+path}};
 try{
  const record=row('www.youtube.com');record.url+='&list=a#part';
  const html=FAV(record);
  assert.match(html,/class="site-favicon"/);
  const src=html.match(/src="([^"]+)"/)[1].replaceAll('&amp;','&');
  const url=new URL(src);
  assert.equal(url.origin,'null');assert.equal(url.protocol,'chrome-extension:');
  assert.equal(url.hostname,'test');assert.equal(url.pathname,'/_favicon/');
  assert.equal(url.searchParams.get('pageUrl'),record.url);assert.equal(url.searchParams.get('size'),'32');
  assert.match(html,/loading="lazy"/);assert.doesNotMatch(html,/onerror=/);
  assert.doesNotMatch(FAV({...record,url:'javascript:alert(1)'}),/<img/);
 }finally{if(previous===undefined)delete globalThis.chrome;else globalThis.chrome=previous;}
});
