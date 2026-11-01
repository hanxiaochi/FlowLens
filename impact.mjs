import {validateModel,initialData,dataIssues} from './model.mjs';
export function analyzeChange(before,after,db,{backfillDefaults=false}={}){
 const result={changes:[],warnings:[],errors:[],affectedPages:[],affectedActions:[],removedRecords:0,removedValues:0};
 const changedEntities=new Set();
 for(const old of before.entities){const next=after.entities.find(e=>e.id===old.id),rows=db[old.id]??[];
  if(!next){result.removedRecords+=rows.length;result.warnings.push(`移除数据实体“${old.label}”，${rows.length} 条记录将从当前项目移除（恢复点仍保留）`);changedEntities.add(old.id);continue;}
  for(const f of old.fields){const n=next.fields.find(x=>x.id===f.id);if(!n){const count=rows.filter(r=>r[f.id]!==undefined&&r[f.id]!==null&&r[f.id]!=='').length;result.removedValues+=count;result.warnings.push(`移除 ${old.label}.${f.label}：影响 ${count} 个已有值`);changedEntities.add(old.id);}else if(JSON.stringify(f)!==JSON.stringify(n)){result.changes.push(`${old.label}.${f.label} 的定义已修改`);changedEntities.add(old.id);}}
  for(const f of next.fields.filter(f=>!old.fields.some(o=>o.id===f.id))){result.changes.push(`新增字段 ${next.label}.${f.label}`);changedEntities.add(old.id);}
 }
 for(const e of after.entities.filter(e=>!before.entities.some(x=>x.id===e.id))){result.changes.push(`新增数据实体 ${e.label}`);changedEntities.add(e.id);}
 for(const a of after.actions){const old=before.actions.find(x=>x.id===a.id);if(!old||JSON.stringify(old)!==JSON.stringify(a)||changedEntities.has(a.entity))result.affectedActions.push(a.id);}
 for(const p of after.pages){const old=before.pages.find(x=>x.id===p.id);if(!old||JSON.stringify(old)!==JSON.stringify(p)||changedEntities.has(p.entity)||p.actions.some(a=>result.affectedActions.includes(a))||(p.blocks??[]).some(b=>changedEntities.has(b.entity)))result.affectedPages.push(p.id);}
 const data=Object.fromEntries(after.entities.map(e=>[e.id,db[e.id]?db[e.id].map(r=>Object.fromEntries(['id',...e.fields.map(f=>f.id)].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))):initialData(after)[e.id]]));
 const backfills=[];
 for(const entity of after.entities){
  const old=before.entities.find(e=>e.id===entity.id);if(!old)continue;
  for(const field of entity.fields.filter(f=>!old.fields.some(o=>o.id===f.id))){
   const candidates=after.actions.filter(a=>a.entity===entity.id&&a.kind==='create'&&Object.hasOwn(a.defaults??{},field.id)).map(a=>a.defaults[field.id]);
   if(!candidates.length||candidates.some(v=>JSON.stringify(v)!==JSON.stringify(candidates[0])))continue;
   const value=candidates[0],rows=data[entity.id].filter(r=>r[field.id]===undefined);
   if(!rows.length)continue;
   backfills.push({entity:entity.id,field:field.id,value,count:rows.length,label:`${entity.label}.${field.label}`});
   if(backfillDefaults)for(const row of rows)row[field.id]=structuredClone(value);
  }
 }
 result.backfills=backfills;
 result.errors.push(...dataIssues(after,data));
 result.errors=[...new Set(result.errors)];return {...result,data};
}
export function prepareMigration(before,next,db,options){const after=validateModel(next);const impact=analyzeChange(before,after,db,options);if(impact.errors.length)throw Error(impact.errors.slice(0,4).join('；'));return {model:after,data:impact.data,impact};}
