import test from 'node:test';
import {setLanguage} from '../extension/i18n.js';
setLanguage('zh'); // Keep translated error assertions independent of system language.
import assert from 'node:assert/strict';
import {organize,testConnection} from '../extension/ai.js';
import {PROVIDERS,sessionKeys} from '../extension/providers.js';
import fs from 'node:fs';
const record={id:'a',title:'Test',domain:'example.com',url:'https://example.com/private'};
function reply(provider,value){return new Response(JSON.stringify(provider==='anthropic'?{content:[{type:'text',text:JSON.stringify(value)}]}:{choices:[{message:{content:JSON.stringify(value)}}]}));}
test('all providers route to their own endpoints and parse JSON without sending full URLs',async t=>{
 for(const p of PROVIDERS){
  t.mock.method(globalThis,'fetch',async(url,init)=>{
   assert.equal(url,p.url);assert.equal(init.redirect,'error');assert.ok(!init.body.includes('/private'));
   const body=JSON.parse(init.body);assert.equal(body.model,p.model);
   if(p.id==='anthropic'){assert.equal(init.headers['x-api-key'],'test-key');assert.equal(init.headers.Authorization,undefined);assert.ok(body.system);assert.equal(body.messages.length,1);}
   else{assert.equal(init.headers.Authorization,'Bearer test-key');assert.equal(body.response_format.type,'json_object');}
   if(p.id==='openai'){assert.equal(body.max_completion_tokens,8192);assert.equal(body.max_tokens,undefined);}
   if(p.id==='qwen')assert.equal(body.enable_thinking,false);
   if(p.id==='moonshot')assert.deepEqual(body.thinking,{type:'disabled'});
   return reply(p.id,{assignments:[{id:'a',group:'工作'}]});
  });
  assert.equal((await organize([record],[],'test-key',p.model,undefined,[],p.id)).assignments[0].group,'工作');
 }
});
test('connection test verifies JSON for every provider and includes no user data',async t=>{
 for(const p of PROVIDERS){
  t.mock.method(globalThis,'fetch',async(url,init)=>{
   assert.equal(url,p.url);assert.ok(!init.body.includes('example.com'));assert.ok(!init.body.includes('confirmedRules'));
   return reply(p.id,{ok:true});
  });
  assert.equal(typeof (await testConnection(p.id,'test-key',p.model)).latency,'number');
 }
 globalThis.fetch=async()=>reply('deepseek',{ok:false});
 await assert.rejects(testConnection('deepseek','key','model'),/格式测试/);
 globalThis.fetch=async()=>new Response('',{status:403});
 await assert.rejects(testConnection('deepseek','key','model'),/访问权限/);
 globalThis.fetch=async()=>{throw new TypeError('network');};
 await assert.rejects(testConnection('deepseek','key','model'),/检查网络/);
 const controller=new AbortController();controller.abort(new DOMException('Timeout','TimeoutError'));
 await assert.rejects(testConnection('deepseek','key','model',controller.signal),/超时/);
 await assert.rejects(testConnection('unknown','key','model'),/不支持/);
 await assert.rejects(testConnection('deepseek','','model'),/API Key/);
});
test('legacy Key migration is DeepSeek-only and cleared keys do not resurrect',()=>{
 assert.deepEqual(sessionKeys({apiKey:'old-key'}),{deepseek:'old-key'});
 assert.deepEqual(sessionKeys({apiKey:'old-key',apiKeys:{deepseek:'',openai:'new-key'}}),{deepseek:'',openai:'new-key'});
});
test('manifest permissions and CSP cover exactly the supported provider origins',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json',import.meta.url)));
 const origins=PROVIDERS.map(p=>new URL(p.url).origin);
 assert.deepEqual(manifest.host_permissions,origins.map(o=>o+'/*'));
 assert.equal(manifest.content_security_policy.extension_pages,"script-src 'self'; object-src 'self'; connect-src "+origins.join(' '));
});
test('theme context sends bounded titles and domains without private URLs or reference ids',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const body=JSON.parse(init.body),payload=JSON.parse(body.messages[1].content);
  assert.match(body.messages[0].content,/默认采用粗分类/);
  assert.match(body.messages[0].content,/4至8个大类/);
  assert.match(body.messages[0].content,/只有一两页的细话题优先并入相关大类/);
  assert.doesNotMatch(body.messages[0].content,/即使只有一两页，只要主题明确也可以创建/);
  assert.deepEqual(payload.pendingContext,[{title:'New topic',domain:'example.com'}]);
  assert.equal(payload.workspaceExamples[0].group,'学习');
  assert.equal(payload.workspaceExamples[0].pages.length,3);
  assert.ok(!init.body.includes('/secret'));assert.ok(!init.body.includes('reference-id'));
  return reply('deepseek',{assignments:[{id:'a',group:'新主题'}]});
 });
 const reference={id:'reference-id',title:'New topic',domain:'example.com',url:'https://example.com/secret',group:'学习'};
 await organize([record],[],'key','model',undefined,['学习'],'deepseek','',{pending:[reference],workspaces:Array(10).fill(reference)});
});
