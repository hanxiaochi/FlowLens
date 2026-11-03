import {validateApplications} from './apps-model.mjs';
import {validateDecisionRules} from './forms-rules.mjs';
import {validateWorkflow,validateSummaryFields} from './forms-model.mjs';
import {validateField,validateFieldValue} from './forms-schema.mjs';
export const emptyWorkspace=()=>({format:'flowlens-forms',version:3,templates:[],cases:[],applications:[],projects:[]});
export function validateWorkspace(value,{allowAttachmentReferences=false,copy=true}={}){
 if(value?.format!=='flowlens-forms'||![1,2,3].includes(value.version)||!Array.isArray(value.templates)||!Array.isArray(value.cases)||value.templates.length>2000||value.cases.length>3000)throw Error('不是有效的业务表单工作包');
 const ids=new Set();let cells=0;
 const string=(s,max=20000)=>{if(typeof s!=='string'||s.length>max)throw Error('工作包文字字段无效');};
 function blocks(list,depth=0){
  if(!Array.isArray(list)||depth>10)throw Error('工作包结构无效');
  for(const b of list){string(b.id,200);if(++cells>500000)throw Error('工作包内容过多');if(b.type==='paragraph'){string(b.text);continue;}
   if(b.type!=='table'||!Array.isArray(b.rows)||!Array.isArray(b.grid))throw Error('表格结构无效');
   for(const row of b.rows){if(!Array.isArray(row))throw Error('表格行无效');for(const c of row){string(c.id,200);string(c.text);if(!Number.isInteger(c.colspan)||c.colspan<1||c.colspan>100||!Number.isInteger(c.rowspan)||c.rowspan<1||c.rowspan>10000)throw Error('合并单元格无效');blocks(c.blocks,depth+1);}}
  }
 }
 function template(t){if(!Number.isSafeInteger(t.version)||t.version<1)throw Error('模板版本无效');string(t.id,200);string(t.title,500);if(t.submitterRole!==undefined){string(t.submitterRole,100);if(!t.submitterRole.trim())throw Error('发起角色不能为空');}string(t.source,500);string(t.code,100);blocks(t.blocks);validateWorkflow(t.workflow);validateDecisionRules(t);
  if(!Array.isArray(t.fields)||t.fields.length>10000)throw Error('字段数量无效');const fieldIds=new Set();
  const blockIds=new Set();const walk=bs=>{for(const b of bs){blockIds.add(b.id);if(b.type==='table')for(const row of b.rows)for(const c of row){blockIds.add(c.id);walk(c.blocks);}}};walk(t.blocks);
  for(const f of t.fields){string(f.id,200);string(f.label,500);validateField(f);if(fieldIds.has(f.id)||!blockIds.has(f.id)||!['draft',...t.workflow.map(x=>x.id)].includes(f.owner))throw Error('填写区关联无效');fieldIds.add(f.id);}
  validateSummaryFields(t);
 }
 for(const t of value.templates){template(t);if(ids.has(t.id))throw Error('模板编号重复');ids.add(t.id);}
 const cases=new Set();for(const r of value.cases){if(!Number.isSafeInteger(r.revision)||r.revision<0)throw Error('记录修订无效');string(r.id,200);if(cases.has(r.id))throw Error('业务编号重复');cases.add(r.id);template(r.template);string(r.title,500);string(r.project,500);string(r.submitter,100);
  if(!['draft','active','complete'].includes(r.status)||!Number.isInteger(r.step)||r.status==='draft'&&r.step!==-1||r.status==='active'&&(r.step<0||r.step>=r.template.workflow.length)||r.status==='complete'&&r.step!==r.template.workflow.length)throw Error('办理状态无效');
  if(!r.values||typeof r.values!=='object'||Array.isArray(r.values)||!Array.isArray(r.events)||!Array.isArray(r.attachments))throw Error('实例记录无效');
  for(const [k,v] of Object.entries(r.values)){string(v);const f=r.template.fields.find(f=>f.id===k);if(!f)throw Error('未知填写字段');validateFieldValue(f,v);}
  for(const e of r.events){string(e.role,100);string(e.at,100);string(e.note);string(e.from,500);string(e.to,500);if(!Array.isArray(e.diff)||!e.values)throw Error('历史记录无效');for(const d of e.diff){string(d.field,500);string(d.before);string(d.after);}}
  for(const a of r.attachments){
   string(a.name,500);
   if(allowAttachmentReferences&&a.data===undefined){
    if(typeof a.blobId!=='string'||!(/^[a-f0-9]{64}$/).test(a.blobId)||!Number.isSafeInteger(a.size)||a.size<0||typeof a.mediaType!=='string'||!/^[\w.+/-]*$/.test(a.mediaType)||typeof a.id!=='string'||!a.id)throw Error('附件引用无效');
   }else if(typeof a.data!=='string'||a.data.length>14*1024*1024||!/^data:[\w.+/-]*;base64,[A-Za-z0-9+/=]*$/.test(a.data))throw Error('附件格式无效');
  }
 }
 for(const r of value.cases)if(r.relatedId&&!cases.has(r.relatedId))throw Error('关联单据不存在');
 validateApplications(value);
 return copy ? structuredClone(value) : value;
}
export function upgradeWorkspace(value,options){const next=validateWorkspace(value,options);next.version=3;next.applications??=[];next.projects??=[];return next;}
export function createWorkspaceStore(factory=globalThis.indexedDB,name='flowlens-business-forms'){
 let connection;
 async function db(){if(!connection)connection=new Promise((resolve,reject)=>{const req=factory.open(name,1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>{connection=null;reject(req.error);};});return connection;}
 async function load(){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>{try{resolve(r.result?upgradeWorkspace(r.result):{...emptyWorkspace(),storageRevision:0});}catch(e){reject(e);}};r.onerror=()=>reject(r.error);});}
 async function save(value,{expectedRevision=value.storageRevision??0}={}){
  const candidate=upgradeWorkspace(value),d=await db();return new Promise((resolve,reject)=>{
   const tx=d.transaction('workspace','readwrite'),store=tx.objectStore('workspace'),read=store.get('current');let failure,result;
   read.onsuccess=()=>{const revision=read.result?.storageRevision??0;if(revision!==expectedRevision){failure=Object.assign(Error('另一标签页已更新工作区。请下载未保存草稿，再重新读取；未覆盖较新数据。'),{code:'WORKSPACE_CONFLICT'});tx.abort();return;}result={...candidate,storageRevision:revision+1};store.put(result,'current');};
   tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure??tx.error);tx.onabort=()=>reject(failure??tx.error??Error('保存事务已取消'));
  });
 }
 return {load,save,close:async()=>{(await db()).close();connection=null;}};
}
let defaultStore;const store=()=>defaultStore??=createWorkspaceStore();
export const loadWorkspace=()=>store().load();
export const saveWorkspace=(value,options)=>store().save(value,options);
// UI replaces its committed state only after persistence succeeds.
export async function commitWorkspace(current,mutate,save=saveWorkspace){const candidate=structuredClone(current);await mutate(candidate);return save(candidate,{expectedRevision:current.storageRevision??0});}
