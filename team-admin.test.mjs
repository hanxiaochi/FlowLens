import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,copyFile,chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {openTeamStore} from './team-store.mjs';
import {applicationDemo} from './apps-demo.mjs';

function restore(source,target){return spawnSync(process.execPath,['scripts/team-admin.mjs','restore',source],{cwd:resolve('.'),env:{...process.env,FLOWLENS_DATABASE:target},encoding:'utf8',timeout:15000});}

test('restore preserves a read-only snapshot, publishes only completed data and refuses live logs',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'flowlens-admin-restore-'));
 const source=join(directory,'snapshot.sqlite'),target=join(directory,'restored.sqlite');
 const store=openTeamStore(join(directory,'live.sqlite'));
 try{
  const admin=await store.createUser(null,{username:'restore-test',name:'Restore test',password:'fictional-restore-test'});
  store.importApplication(admin,applicationDemo());await store.login('restore-test','fictional-restore-test');
  await store.backup(source);
  const bytes=await readFile(source);const sidecars={};for(const suffix of ['-wal','-shm'])sidecars[suffix]=existsSync(source+suffix)?await readFile(source+suffix):null;await chmod(source,0o444);
  const ok=restore(source,target);assert.equal(ok.status,0,ok.stderr);
  assert.deepEqual(await readFile(source),bytes);for(const suffix of ['-wal','-shm'])assert.deepEqual(existsSync(source+suffix)?await readFile(source+suffix):null,sidecars[suffix]);
  const result=new DatabaseSync(target,{readOnly:true});try{
   assert.equal(result.prepare('SELECT count(*) n FROM sessions').get().n,0);
   assert.equal(result.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
   assert.equal(result.prepare("SELECT count(*) n FROM maintenance WHERE key='instance'").get().n,0);
   assert.equal(result.prepare("SELECT count(*) n FROM maintenance WHERE key='lastRestore'").get().n,1);
  }finally{result.close();}
  const ready=await readFile(target);assert.notEqual(restore(source,target).status,0);assert.deepEqual(await readFile(target),ready);
  const refused=join(directory,'live-refused.sqlite');assert.notEqual(restore(join(directory,'live.sqlite'),refused).status,0);assert.equal(existsSync(refused),false);
  assert.ok(!(await readdir(directory)).some(name=>name.startsWith('.flowlens-restore-')));
 }finally{store.close();await chmod(source,0o600).catch(()=>{});await rm(directory,{recursive:true,force:true});}
});

test('restore failures during validation and final preparation leave no target or staging data',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'flowlens-admin-failure-'));
 const source=join(directory,'snapshot.sqlite'),target=join(directory,'restored.sqlite');
 const store=openTeamStore(join(directory,'live.sqlite'));
 try{
  await store.createUser(null,{username:'restore-test',name:'Restore test',password:'fictional-restore-test'});await store.backup(source);
  const malformed=join(directory,'malformed.sqlite');await copyFile(source,malformed);
  const broken=new DatabaseSync(malformed);broken.exec('DROP TABLE maintenance; CREATE TABLE maintenance(unexpected TEXT);');broken.close();
  const original=await readFile(malformed);const failed=restore(malformed,target);
  assert.notEqual(failed.status,0);assert.match(failed.stderr,/table maintenance has 1 columns/);assert.equal(existsSync(target),false);assert.deepEqual(await readFile(malformed),original);
  const invalid=join(directory,'invalid.sqlite');await writeFile(invalid,'not a sqlite database');assert.notEqual(restore(invalid,target).status,0);assert.equal(existsSync(target),false);
  assert.ok(!(await readdir(directory)).some(name=>name.startsWith('.flowlens-restore-')));
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});
