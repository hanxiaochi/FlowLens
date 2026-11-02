import {createCase,applyOperation,validateWorkflow} from './forms-model.mjs';
export function sampleValue(f){return f.type==='table'?JSON.stringify([Object.fromEntries(f.columns.map(c=>[c.id,sampleValue(c)]))]):f.type==='number'?String(f.min??Math.min(1,f.max??1)):f.type==='date'?'2026-11-02':f.type==='boolean'?'false':f.type==='select'?f.options[0]:f.type==='reference'?'sample-related-id':'验证填写';}
export function verifyTemplate(t){
 validateWorkflow(t.workflow);const results=[];
 const check=(name,fn)=>{try{fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}};
 const ensure=(v,m)=>{if(!v)throw Error(m);};const rejects=fn=>{let failed=false;try{fn();}catch{failed=true;}ensure(failed,'预期拒绝但操作成功');};
 let r=createCase(t);const id=r.id;
 for(let stage=-1;stage<t.workflow.length;stage++){
  const owner=stage<0?'draft':t.workflow[stage].id,role=stage<0?r.submitter:t.workflow[stage].role,type=stage<0?'submit':'advance';
  const values=Object.fromEntries(t.fields.filter(f=>f.owner===owner).map(f=>[f.id,sampleValue(f)]));
  for(const rule of t.decisionRules??[]){if(rule.stageId===owner&&values[rule.fieldId]===rule.equals){const field=t.fields.find(f=>f.id===rule.fieldId);const alternative=field.options?.find(v=>!(t.decisionRules??[]).some(r=>r.stageId===owner&&r.fieldId===field.id&&r.equals===v));if(alternative!==undefined)values[field.id]=alternative;}}
  check(owner+': wrong role',()=>rejects(()=>applyOperation(r,{type,role:role+'-wrong',values})));
  for(const f of t.fields.filter(f=>f.owner===owner&&f.required))check(owner+': required '+f.id,()=>rejects(()=>applyOperation(r,{type,role,values:{...values,[f.id]:''}})));
  if(stage>=0&&t.workflow[stage].kind!=='receipt')check(owner+': return',()=>{rejects(()=>applyOperation(r,{type:'return',role}));const back=applyOperation(r,{type:'return',role,note:'补充资料'});const target=t.workflow[stage].returnTo??'draft';ensure(back.step===(target==='draft'?-1:t.workflow.findIndex(s=>s.id===target)),'退回目标不一致');ensure(back.id===id&&back.events.length===r.events.length+1,'历史或编号丢失');});
  check(owner+': advance and replay',()=>{const before=r;const operation={type,role,values,operationId:'verify-'+owner,expectedRevision:r.revision};r=applyOperation(r,operation);ensure(r.id===id,'编号改变');ensure(JSON.stringify(applyOperation(r,operation))===JSON.stringify(r),'重复操作改变记录');rejects(()=>applyOperation(r,{type:'save',role,expectedRevision:before.revision}));});
 }
 check('archived immutable',()=>{ensure(r.status==='complete','未完成归档');rejects(()=>applyOperation(r,{type:'save',role:r.submitter}));});return {scope:'本地业务规则，未验证生产服务、身份或数据库权限',passed:results.every(x=>x.passed),results};
}
