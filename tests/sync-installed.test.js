import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pickmark-sync-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'extension'),target=path.join(root,'dist/Pickmark-0.1.20');
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(target,{recursive:true});
  fs.mkdirSync(path.join(root,'scripts'));
  const script=new URL('../scripts/sync-installed.py',import.meta.url);
  if(fs.existsSync(script))fs.copyFileSync(script,path.join(root,'scripts/sync-installed.py'));
  const manifest={manifest_version:3,name:'Pickmark',version:'0.1.21'};
  fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({...manifest,version:'0.1.20'}));
  fs.writeFileSync(path.join(source,'background.js'),'new code');
  fs.writeFileSync(path.join(target,'background.js'),'old code');
  return {root,source,target,run:()=>spawnSync('python3',[path.join(root,'scripts/sync-installed.py')],{encoding:'utf8'})};
}

test('sync updates the existing installation without deleting extra files or touching profile data',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.target,'keep.txt'),'existing installation extras');
  fs.mkdirSync(path.join(f.root,'chrome-profile'));
  const settings=path.join(f.root,'chrome-profile/settings.json');
  fs.writeFileSync(settings,'{"saved":"preserve"}');
  const result=f.run();assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(path.join(f.target,'background.js'),'utf8'),'new code');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target,'manifest.json'))).version,'0.1.21');
  assert.equal(fs.readFileSync(path.join(f.target,'keep.txt'),'utf8'),'existing installation extras');
  assert.equal(fs.readFileSync(settings,'utf8'),'{"saved":"preserve"}');
  const before=fs.statSync(path.join(f.target,'background.js')).mtimeMs;
  assert.equal(f.run().status,0);
  assert.equal(fs.statSync(path.join(f.target,'background.js')).mtimeMs,before,'unchanged files need no rewrite');
});

test('a missing original installation is an error, not a new installation',t=>{
  const f=fixture(t);fs.rmSync(f.target,{recursive:true});
  const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/原安装目录/);
  assert.equal(fs.existsSync(f.target),false);
});

test('changing extension identity is rejected before overwriting program files',t=>{
  const f=fixture(t);
  const manifest=JSON.parse(fs.readFileSync(path.join(f.target,'manifest.json')));manifest.key='different-identity';
  fs.writeFileSync(path.join(f.target,'manifest.json'),JSON.stringify(manifest));
  const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/身份/);
  assert.equal(fs.readFileSync(path.join(f.target,'background.js'),'utf8'),'old code');
});

test('a symlink in the installation cannot redirect writes outside its directory',t=>{
  const f=fixture(t),outside=path.join(f.root,'external.js');fs.writeFileSync(outside,'preserve');
  fs.unlinkSync(path.join(f.target,'background.js'));fs.symlinkSync(outside,path.join(f.target,'background.js'));
  const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/链接/);
  assert.equal(fs.readFileSync(outside,'utf8'),'preserve');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target,'manifest.json'))).version,'0.1.20');
});
