import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {previewDocumentState} from '../extension/preview-document.js';

for(const [readyState,body,visibilityState,ready,visible] of [
 ['loading',{},'visible',false,true],['interactive',{},'visible',true,true],
 ['complete',{},'hidden',true,false],['interactive',null,'visible',false,true]
])test(`on-demand state: ${readyState}, body=${!!body}, ${visibilityState}`,()=>{
 const context={document:{readyState,body,visibilityState},location:{href:'https://local.test/page'}};
 const result=vm.runInNewContext(`(${previewDocumentState.toString()})()`,context);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{url:context.location.href,ready,visible});
});
