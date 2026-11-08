import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {demoWorkspace} from './forms-demo.mjs';
import {applyOperation} from './forms-model.mjs';

test('fictional public sample completes review and receipt with required stage fields',()=>{
 const w=demoWorkspace();let r=w.cases[0];
 r=applyOperation(r,{type:'submit',role:'填报人'});
 assert.throws(()=>applyOperation(r,{type:'advance',role:'专业监理'}),/监理意见/);
 r=applyOperation(r,{type:'advance',role:'专业监理',values:{'review-note':'仅演示'}});
 r=applyOperation(r,{type:'advance',role:'资料员'});assert.equal(r.status,'complete');assert.equal(r.id,w.cases[0].id);
});

test('static demo has resolvable assets, no server or key files, and no credential strings',async()=>{
 execFileSync(process.execPath,['scripts/build-demo.mjs']);
 const root=resolve('dist');const files=[];async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else files.push(path);}}await walk(root);
 for(const path of files){assert.ok(!/server\.mjs$|\.env|\.docx$|\.git[\\/]/.test(path));const text=await readFile(path,'utf8');assert.ok(!/sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}/.test(text),'Credential-like material found in '+path);
  if(/\.(?:m?js)$/.test(path))for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){await readFile(resolve(dirname(path),match[2]));}
 }
 const html=await readFile(join(root,'index.html'),'utf8');assert.match(html,/name="flowlens-demo"/);assert.ok(!/(?:src|href)="\//.test(html));assert.ok(!html.includes('"/vendor/'));
 const js=await readFile(join(root,'studio.js'),'utf8');assert.match(js,/if\(publicDemo\).*公开演示不连接模型服务/);assert.match(js,/\$\('settings-dialog'\)\.remove/);
});


test('design and team page labels match the source package version', async () => {
 const {version}=JSON.parse(await readFile('package.json','utf8'));
 const studio=await readFile('studio.html','utf8'), team=await readFile('team.html','utf8');
 assert.ok(studio.includes('<title>FlowLens '+version+' ·'));
 assert.ok(studio.includes('<span>v'+version+'</span>'));
 assert.ok(team.includes('<title>FlowLens '+version+' ·'));
 assert.ok(team.includes('<span>'+version+' · 团队协作</span>'));
});
