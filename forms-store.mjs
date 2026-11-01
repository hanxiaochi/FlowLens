import {validateWorkflow} from './forms-model.mjs';
export const emptyWorkspace=()=>({format:'flowlens-forms',version:1,templates:[],cases:[]});
export function validateWorkspace(value){
 if(value?.format!=='flowlens-forms'||value.version!==1||!Array.isArray(value.templates)||!Array.isArray(value.cases)||value.templates.length>2000||value.cases.length>3000)throw Error('不是有效的业务表单工作包');
 const ids=new Set();let cells=0;
 const string=(s,max=20000)=>{if(typeof s!=='string'||s.length>max)throw Error('工作包文字字段无效');};
 function blocks(list,depth=0){
  if(!Array.isArray(list)||depth>10)throw Error('工作包结构无效');
  for(const b of list){string(b.id,200);if(++cells>500000)throw Error('工作包内容过多');if(b.type==='paragraph'){string(b.text);continue;}
   if(b.type!=='table'||!Array.isArray(b.rows)||!Array.isArray(b.grid))throw Error('表格结构无效');
   for(const row of b.rows){if(!Array.isArray(row))throw Error('表格行无效');for(const c of row){string(c.id,200);string(c.text);if(!Number.isInteger(c.colspan)||c.colspan<1||c.colspan>100||!Number.isInteger(c.rowspan)||c.rowspan<1||c.rowspan>10000)throw Error('合并单元格无效');blocks(c.blocks,depth+1);}}
  }
 }
 function template(t){string(t.id,200);string(t.title,500);string(t.source,500);string(t.code,100);blocks(t.blocks);validateWorkflow(t.workflow);
  if(!Array.isArray(t.fields)||t.fields.length>10000)throw Error('字段数量无效');const fieldIds=new Set();
  const blockIds=new Set();const walk=bs=>{for(const b of bs){blockIds.add(b.id);if(b.type==='table')for(const row of b.rows)for(const c of row){blockIds.add(c.id);walk(c.blocks);}}};walk(t.blocks);
  for(const f of t.fields){string(f.id,200);string(f.label,500);if(fieldIds.has(f.id)||!blockIds.has(f.id)||!['draft',...t.workflow.map(x=>x.id)].includes(f.owner))throw Error('填写区关联无效');fieldIds.add(f.id);}
 }
 for(const t of value.templates){template(t);if(ids.has(t.id))throw Error('模板编号重复');ids.add(t.id);}
 const cases=new Set();for(const r of value.cases){string(r.id,200);if(cases.has(r.id))throw Error('业务编号重复');cases.add(r.id);template(r.template);string(r.title,500);string(r.project,500);string(r.submitter,100);
  if(!['draft','active','complete'].includes(r.status)||!Number.isInteger(r.step)||r.status==='draft'&&r.step!==-1||r.status==='active'&&(r.step<0||r.step>=r.template.workflow.length)||r.status==='complete'&&r.step!==r.template.workflow.length)throw Error('办理状态无效');
  if(!r.values||typeof r.values!=='object'||Array.isArray(r.values)||!Array.isArray(r.events)||!Array.isArray(r.attachments))throw Error('实例记录无效');
  for(const [k,v] of Object.entries(r.values)){string(v);if(!r.template.fields.some(f=>f.id===k))throw Error('未知填写字段');}
  for(const e of r.events){string(e.role,100);string(e.at,100);string(e.note);string(e.from,500);string(e.to,500);if(!Array.isArray(e.diff)||!e.values)throw Error('历史记录无效');for(const d of e.diff){string(d.field,500);string(d.before);string(d.after);}}
  for(const a of r.attachments){string(a.name,500);if(typeof a.data!=='string'||a.data.length>14*1024*1024||!/^data:[\w.+/-]*;base64,[A-Za-z0-9+/=]*$/.test(a.data))throw Error('附件格式无效');}
 }
 for(const r of value.cases)if(r.relatedId&&!cases.has(r.relatedId))throw Error('关联单据不存在');
 return structuredClone(value);
}
let connection;
async function db(){if(!connection)connection=new Promise((resolve,reject)=>{const req=indexedDB.open('flowlens-business-forms',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});return connection;}
export async function loadWorkspace(){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>resolve(r.result?validateWorkspace(r.result):emptyWorkspace());r.onerror=()=>reject(r.error);});}
export async function saveWorkspace(value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('workspace','readwrite');t.objectStore('workspace').put(value,'current');t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error??Error('保存已取消'));});}
