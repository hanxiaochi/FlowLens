import {validateDecisionRules} from './forms-rules.mjs';
import {validateFieldValue,missingDetailValues} from './forms-schema.mjs';
export const uid=()=>globalThis.crypto.randomUUID();
const clone=x=>structuredClone(x);
export function validateWorkflow(steps){
 if(!Array.isArray(steps)||!steps.length||steps.length>12)throw Error('流程需配置 1–12 个办理节点');
 const ids=new Set();for(const s of steps){if(!s.id||ids.has(s.id)||['draft','archive'].includes(s.id)||!s.label?.trim()||!s.role?.trim()||!['review','receipt','issue'].includes(s.kind))throw Error('流程节点需有唯一编号、名称、角色与有效办理类型');if(s.returnTo&&s.returnTo!=='draft'&&!ids.has(s.returnTo))throw Error('退回目标必须是填报或之前的办理阶段');ids.add(s.id);}return clone(steps);
}
export function createCase(template,{title='',project='',role='填报人',relatedId=null}={}){
 validateWorkflow(template.workflow);
 validateSummaryFields(template);
 validateDecisionRules(template);
 if(typeof title!=='string'||title.length>500||typeof project!=='string'||project.length>500||typeof role!=='string'||!role.trim()||role.length>100)throw Error('业务名称、项目或填报角色无效或过长');
 return {id:uid(),title:title.trim()||template.title,project,relatedId,template:clone(template),values:{},attachments:[],submitter:role,status:'draft',step:-1,revision:0,events:[],createdAt:new Date().toISOString()};
}
export function canEdit(record,field,role){return record.status!=='complete'&&((record.status==='draft'&&role===record.submitter&&field.owner==='draft')||(record.status==='active'&&record.template.workflow[record.step]?.role===role&&field.owner===record.template.workflow[record.step].id));}
export function missingRequired(record,owner){return record.template.fields.filter(f=>{const value=Object.hasOwn(record.values,f.id)?record.values[f.id]:'';return f.owner===owner&&((f.required&&!String(value).trim())||missingDetailValues(f,value));});}
export function applyOperation(record,{type,role,values={},note='',at=new Date().toISOString(),expectedRevision=record.revision,operationId=uid()}){
 if(typeof operationId!=='string'||!operationId.trim()||operationId.length>200)throw Error('操作编号无效');
 const previous=record.events.find(e=>e.operationId===operationId);if(previous){if(previous.role!==role||previous.type!==type)throw Error('操作编号已用于其他办理');return clone(record);}
 if(expectedRevision!==record.revision)throw Error('记录版本已改变，请重新读取后办理');
 if(typeof note!=='string'||note.length>20000)throw Error('办理意见不能超过 20000 字');
 const r=clone(record);const diff=[];
 if(r.status==='complete')throw Error('已归档的表单不能修改或继续办理');
 const current=r.status==='draft'?null:r.template.workflow[r.step];
 if((current?.role??r.submitter)!==role)throw Error(`当前需由${current?.role??r.submitter}办理`);
 for(const [key,raw] of Object.entries(values)){
  const f=r.template.fields.find(x=>x.id===key);if(!f||!canEdit(r,f,role))throw Error('不能修改其他办理阶段的字段');
  const value=raw===null?'':(f.type==='number'&&typeof raw==='number'||f.type==='boolean'&&typeof raw==='boolean')?String(raw):raw;
  validateFieldValue(f,value);
  const before=Object.hasOwn(r.values,key)?r.values[key]:'';
  if(value!==before){diff.push({field:f.label,before,after:value});Object.defineProperty(r.values,key,{value,enumerable:true,writable:true,configurable:true});}
 }
 const from=r.status==='draft'?'填报':current.label;
 if(type==='return'){
  if(!current||current.kind==='receipt')throw Error('当前节点不支持退回');
  if(!note.trim())throw Error('请填写退回原因');r.step=current.returnTo&&current.returnTo!=='draft'?r.template.workflow.findIndex(s=>s.id===current.returnTo):-1;r.status=r.step<0?'draft':'active';
 }else if(type==='submit'||type==='advance'){
  if(type==='submit'&&r.status!=='draft'||type==='advance'&&r.status!=='active')throw Error('当前状态不能执行此操作');
  const missing=missingRequired(r,current?.id??'draft');if(missing.length)throw Error('请填写必填项：'+missing.map(f=>f.label).join('、'));
  const decision=(r.template.decisionRules??[]).find(rule=>rule.stageId===current?.id&&r.values[rule.fieldId]===rule.equals);
  if(decision){if(!note.trim())throw Error('条件触发退回，请填写办理意见作为原因');r.step=decision.returnTo==='draft'?-1:r.template.workflow.findIndex(stage=>stage.id===decision.returnTo);r.status=r.step<0?'draft':'active';}
  else{r.step++;r.status=r.step>=r.template.workflow.length?'complete':'active';}
 }else if(type!=='save')throw Error('未知操作');
 r.revision++;
 const to=r.status==='complete'?'归档':r.status==='draft'?'填报':r.template.workflow[r.step].label;
 r.events.push({id:uid(),operationId,type,role,at,note:note.trim(),from,to,revision:r.revision,diff,values:clone(r.values),attachments:r.attachments.map(a=>({id:a.id,name:a.name,size:a.size})),status:r.status,step:r.step});
 return r;
}
export function attachFile(record,attachment,role){
 const expected=record.status==='draft'?record.submitter:record.template.workflow[record.step]?.role;
 if(record.status==='complete'||role!==expected)throw Error('只有当前办理人可添加附件');
 if(!attachment.name||attachment.size>10*1024*1024)throw Error('单个附件不能超过 10 MB');
 const r=clone(record);r.attachments.push({...attachment,id:uid(),role,at:new Date().toISOString()});
 r.revision++;r.events.push({id:uid(),type:'attachment',role,at:new Date().toISOString(),note:attachment.name,from:'附件',to:'附件已保存',revision:r.revision,diff:[],values:clone(r.values),attachments:r.attachments.map(a=>({id:a.id,name:a.name,size:a.size})),status:r.status,step:r.step});return r;
}

export function validateSummaryFields(template) {
  const selected = template.summaryFields;
  if (selected === undefined) return;
  if (!Array.isArray(selected) || selected.length > 3 || new Set(selected).size !== selected.length || Array.from(selected).some(id => typeof id !== 'string' || !template.fields.some(field => field.id === id))) {
    throw Error('摘要最多选择三个不同且存在的填写区');
  }
}

export function summarizeRecord(record) {
  const summary = [];
  const selected = record.template.summaryFields;
  const fields = selected?.length ? selected.map(id => record.template.fields.find(field => field.id === id)) : record.template.fields;
  for (const field of fields) {
    const value = Object.hasOwn(record.values, field.id) ? record.values[field.id] : undefined;
    if (value === undefined || value === null || String(value).trim() === '') continue;
    let text = String(value);
    if (field.type === 'table') {
      try {
        const rows = JSON.parse(text);
        text = Array.isArray(rows) ? `${rows.length} 行明细` : '请打开单据查看明细';
      } catch { text = '请打开单据查看明细'; }
    }
    if (field.type === 'boolean') {
      if (text === 'true') text = '是';
      if (text === 'false') text = '否';
    }
    text = text.replace(/\s+/gu, ' ').trim();
    const characters = Array.from(text);
    summary.push({label: Array.from(field.label).slice(0, 60).join(''), text: characters.slice(0, 120).join('') + (characters.length > 120 ? '…' : '')});
    if (summary.length === 3) break;
  }
  return summary;
}
