import {openApi} from './export.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {example} from './examples.mjs';
import {describeAction,initialData,makeRun,stepRun} from './model.mjs';

test('narration uses edited rules and explains the actual branch before committing',()=>{
 for(const [op,threshold,days,matched] of [['gt',4,4,false],['gt',4,5,true],['gte',4,4,true],['eq',4,5,false]]){
  const model=example(),a=model.actions.find(a=>a.id==='managerApprove');a.branch.op=op;a.branch.value=threshold;
  const db=initialData(model);db.leaves=[{id:1,employee:1,days,status:'待主管审批'}];
  const run=makeRun(model,db,a.id,{id:1},{role:'主管'});
  while(run.index<5)stepRun(run,db);
  const entry=run.log.at(-1),target=matched?a.branch.then:a.to;
  assert.equal(entry.decision.matched,matched);assert.equal(entry.decision.target,target);
  assert.match(entry.explain,new RegExp('天数是 '+days));assert.match(entry.explain,/尚未写入/);
  assert.equal(db.leaves[0].status,'待主管审批');
  stepRun(run,db);assert.equal(db.leaves[0].status,target);
  assert.match(openApi(model).paths['/api/leaves/{id}/managerApprove'].patch.description,/4/);
  assert.match(describeAction(model,a),/4/);assert.doesNotMatch(describeAction(model,a),/三天/);
 }
});
test('missing condition data cannot silently select an approval branch',()=>{
 const model=example(),db=initialData(model);db.leaves=[{id:1,employee:1,status:'待主管审批'}];
 const before=structuredClone(db),run=makeRun(model,db,'managerApprove',{id:1},{role:'主管'});
 while(!run.done)stepRun(run,db);
 assert.equal(run.failed,true);assert.match(run.log.at(-1).error,/缺少有效数字/);assert.deepEqual(db,before);
});
