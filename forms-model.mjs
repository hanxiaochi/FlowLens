export const uid=()=>globalThis.crypto.randomUUID();
const clone=x=>structuredClone(x);
export function validateWorkflow(steps){
 if(!Array.isArray(steps)||!steps.length||steps.length>12)throw Error('流程需配置 1–12 个办理节点');
 const ids=new Set();for(const s of steps){if(!s.id||ids.has(s.id)||s.id==='draft'||!s.label?.trim()||!s.role?.trim()||!['review','receipt','issue'].includes(s.kind))throw Error('流程节点需有唯一编号、名称、角色与有效办理类型');ids.add(s.id);}return clone(steps);
}
export function createCase(template,{title='',project='',role='填报人',relatedId=null}={}){
 validateWorkflow(template.workflow);
 if(typeof title!=='string'||title.length>500||typeof project!=='string'||project.length>500||typeof role!=='string'||!role.trim()||role.length>100)throw Error('业务名称、项目或填报角色无效或过长');
 return {id:uid(),title:title.trim()||template.title,project,relatedId,template:clone(template),values:{},attachments:[],submitter:role,status:'draft',step:-1,revision:0,events:[],createdAt:new Date().toISOString()};
}
export function canEdit(record,field,role){return record.status!=='complete'&&((record.status==='draft'&&role===record.submitter&&field.owner==='draft')||(record.status==='active'&&record.template.workflow[record.step]?.role===role&&field.owner===record.template.workflow[record.step].id));}
export function missingRequired(record,owner){return record.template.fields.filter(f=>f.required&&f.owner===owner&&!String(record.values[f.id]??'').trim());}
export function applyOperation(record,{type,role,values={},note='',at=new Date().toISOString()}){
 if(typeof note!=='string'||note.length>20000)throw Error('办理意见不能超过 20000 字');
 const r=clone(record);const diff=[];
 if(r.status==='complete')throw Error('已归档的表单不能修改或继续办理');
 const current=r.status==='draft'?null:r.template.workflow[r.step];
 if((current?.role??r.submitter)!==role)throw Error(`当前需由${current?.role??r.submitter}办理`);
 for(const [key,value] of Object.entries(values)){
  const f=r.template.fields.find(x=>x.id===key);if(!f||!canEdit(r,f,role))throw Error('不能修改其他办理阶段的字段');
  if(typeof value!=='string'||value.length>20000)throw Error('填写内容过长或格式无效');
  if(value!==(r.values[key]??'')){diff.push({field:f.label,before:r.values[key]??'',after:value});r.values[key]=value;}
 }
 const from=r.status==='draft'?'填报':current.label;
 if(type==='return'){
  if(!current||current.kind==='receipt')throw Error('当前节点不支持退回');
  if(!note.trim())throw Error('请填写退回原因');r.status='draft';r.step=-1;
 }else if(type==='submit'||type==='advance'){
  if(type==='submit'&&r.status!=='draft'||type==='advance'&&r.status!=='active')throw Error('当前状态不能执行此操作');
  const missing=missingRequired(r,current?.id??'draft');if(missing.length)throw Error('请填写必填项：'+missing.map(f=>f.label).join('、'));
  r.step++;r.status=r.step>=r.template.workflow.length?'complete':'active';
 }else if(type!=='save')throw Error('未知操作');
 r.revision++;
 const to=r.status==='complete'?'归档':r.status==='draft'?'填报':r.template.workflow[r.step].label;
 r.events.push({id:uid(),type,role,at,note:note.trim(),from,to,revision:r.revision,diff,values:clone(r.values),attachments:r.attachments.map(a=>({id:a.id,name:a.name,size:a.size})),status:r.status,step:r.step});
 return r;
}
export function attachFile(record,attachment,role){
 const expected=record.status==='draft'?record.submitter:record.template.workflow[record.step]?.role;
 if(record.status==='complete'||role!==expected)throw Error('只有当前办理人可添加附件');
 if(!attachment.name||attachment.size>10*1024*1024)throw Error('单个附件不能超过 10 MB');
 const r=clone(record);r.attachments.push({...attachment,id:uid(),role,at:new Date().toISOString()});
 r.revision++;r.events.push({id:uid(),type:'attachment',role,at:new Date().toISOString(),note:attachment.name,from:'附件',to:'附件已保存',revision:r.revision,diff:[],values:clone(r.values),attachments:r.attachments.map(a=>({id:a.id,name:a.name,size:a.size})),status:r.status,step:r.step});return r;
}
