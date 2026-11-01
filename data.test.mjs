import test from 'node:test';
import assert from 'node:assert/strict';
import {example} from './examples.mjs';
import {initialData,validateData,makeRun,stepRun} from './model.mjs';

test('project data rejects missing required values, duplicates, enum violations and dangling references',()=>{
 const m=example();
 for(const mutate of [d=>delete d.employees[0].name,d=>d.employees[1].phone=d.employees[0].phone,d=>d.employees[0].department='不存在的部门',d=>d.leaves.push({id:1,employee:99,days:2,status:'待主管审批'}),d=>d.leaves.push({id:1,employee:1,days:-1,status:'待主管审批'})]){
  const db=initialData(m);mutate(db);const before=structuredClone(db);assert.throws(()=>validateData(m,db));assert.deepEqual(db,before);
 }
});
test('calendar dates are real dates, including leap-year boundaries',()=>{
 const m=example();m.entities[0].fields.push({id:'startDate',label:'入职日期',type:'date'});
 for(const value of ['2025-02-29','2026-02-30','2026-13-01','2026-1-1']){const db=initialData(m);db.employees[0].startDate=value;assert.throws(()=>validateData(m,db),/日期/);}
 const db=initialData(m);db.employees[0].startDate='2024-02-29';assert.deepEqual(validateData(m,db),db);
});
test('invalid defaults and non-field input types fail commit without partial mutation',()=>{
 for(const configure of [m=>m.actions.find(a=>a.id==='requestLeave').defaults.status='未知状态',m=>{m.entities[0].fields.push({id:'enabled',label:'启用',type:'boolean'});m.actions.find(a=>a.id==='addEmployee').fields.push('enabled');}]){
  const m=example();configure(m);const db=initialData(m),before=structuredClone(db),a=m.entities[0].fields.some(f=>f.id==='enabled')?'addEmployee':'requestLeave';
  const input=a==='addEmployee'?{name:'测试',phone:'TEST-NEW',enabled:'not boolean'}:{employee:1,days:2};
  const run=makeRun(m,db,a,input,{role:'管理员'});while(!run.done)stepRun(run,db);
  assert.equal(run.failed,true);assert.deepEqual(db,before);assert.equal(run.log.some(e=>e.write),false);
 }
});
