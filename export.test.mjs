import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {example} from './examples.mjs';import {openApi,sqlSchema} from './export.mjs';import {contract} from './model.mjs';
test('exported PostgreSQL DDL executes and enforces enum, minimum, required, unique and FK rules',async()=>{
 const db=new PGlite();try{
  await db.exec(sqlSchema(example()));
  await db.query('INSERT INTO employees(name,phone,department) VALUES ($1,$2,$3)',['演示员工','DEMO-X','产品设计']);
  await db.query('INSERT INTO leaves(employee,days,status) VALUES ($1,$2,$3)',[1,5,'待主管审批']);
  for(const [sql,args] of [
   ['INSERT INTO employees(name,phone) VALUES ($1,$2)',['','DEMO-Y']],
   ['INSERT INTO employees(name,phone) VALUES ($1,$2)',['演示员工2','DEMO-X']],
   ['INSERT INTO leaves(employee,days,status) VALUES ($1,$2,$3)',[1,-1,'待主管审批']],
   ['INSERT INTO leaves(employee,days,status) VALUES ($1,$2,$3)',[999,1,'待主管审批']],
   ['INSERT INTO leaves(employee,days,status) VALUES ($1,$2,$3)',[1,1,'未知状态']],
   ['DELETE FROM employees WHERE id=$1',[1]]
  ])await assert.rejects(db.query(sql,args));
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM leaves')).rows[0].n,1);
 }finally{await db.close();}
});
test('SQL enum values preserve quotes without changing statement structure',async()=>{
 const m=example('shop'),field=m.entities[0].fields.find(f=>f.type==='select');field.options=["O'Reilly",'普通'];const db=new PGlite();try{await db.exec(sqlSchema(m));await db.query('INSERT INTO products(title,price,status) VALUES ($1,$2,$3)',['样例',12,"O'Reilly"]);assert.equal((await db.query('SELECT status FROM products')).rows[0].status,"O'Reilly");}finally{await db.close();}
});
test('OpenAPI preserves constraints, result schema and distinct actions without overwriting',()=>{
 const m=example();const a=structuredClone(m.actions.find(a=>a.id==='requestLeave'));a.id='requestSpecialLeave';a.label='特殊请假';m.actions.push(a);
 const spec=openApi(m),actions=Object.values(spec.paths).flatMap(path=>Object.values(path));assert.equal(actions.length,m.actions.length);
 assert.equal(new Set(actions.map(a=>a.operationId)).size,m.actions.length);
 assert.equal(contract(m,a).path,'/api/leaves/requestSpecialLeave');
 assert.equal(spec.components.schemas.leaves.properties.days.minimum,0.5);
 assert.ok(spec.components.schemas.employees.required.includes('name'));
 assert.equal(spec.paths['/api/leaves/requestLeave'].post.responses[200].content['application/json'].schema.properties.record.$ref,'#/components/schemas/leaves');
});

