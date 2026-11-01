import {validateLayouts,LAYOUT_GUIDE} from './layout.mjs';
const safeId=x=>typeof x==='string'&&/^[a-z][a-zA-Z0-9_]{0,40}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x);
const fail=m=>{throw new Error(m);};
export function validateModel(raw){
 if(!raw||typeof raw!=='object')fail('项目必须是对象');
 const m=structuredClone(raw);if(m.version!==2)fail('需要 version: 2');
 if(typeof m.name!=='string'||!m.name.trim()||m.name.length>100)fail('请填写项目名称（不超过 100 字）');
 for(const k of ['entities','pages','actions','roles','assumptions'])if(!Array.isArray(m[k]))fail(`${k} 必须是数组`);
 if(!m.entities.length||m.entities.length>20||!m.pages.length||m.pages.length>30||m.actions.length>80)fail('需要 1–20 个数据实体、1–30 个页面，至多 80 个操作');
 if(!m.roles.length||m.roles.some(r=>typeof r!=='string'||!r.trim()))fail('角色不能为空');
 const unique=(arr,label)=>{const ids=new Set();for(const x of arr){if(!safeId(x.id)||ids.has(x.id))fail(`${label}标识重复或非法：${x.id}`);ids.add(x.id);}return ids;};
 const entities=unique(m.entities,'实体'),actions=unique(m.actions,'操作');unique(m.pages,'页面');
 for(const e of m.entities){if(typeof e.label!=='string'||!e.label||!Array.isArray(e.fields)||!e.fields.length||e.fields.length>30)fail('每个实体需要名称和 1–30 个字段');unique(e.fields,'字段');if(e.fields.some(f=>f.id==='id'))fail('id 为内置主键，请不要重复定义');for(const f of e.fields){if(typeof f.label!=='string'||!f.label||!['text','number','select','date','boolean','reference'].includes(f.type))fail(`字段 ${f.id} 类型无效`);if(f.type==='select'&&(!Array.isArray(f.options)||!f.options.length||f.options.some(v=>typeof v!=='string')))fail(`字段 ${f.id} 缺少有效选项`);if(f.type==='reference'&&!entities.has(f.target))fail(`字段 ${f.id} 关联实体不存在`);if(f.min!==undefined&&!Number.isFinite(f.min))fail('数字下限必须为有限数');}e.seed??=[];if(!Array.isArray(e.seed)||e.seed.length>100||e.seed.some(r=>!r||typeof r!=='object'||Array.isArray(r)))fail('样例数据无效或过多');}
 for(const a of m.actions){const e=m.entities.find(e=>e.id===a.entity);if(!e)fail(`操作 ${a.id} 引用了不存在的数据表`);if(!['create','update','delete','transition'].includes(a.kind))fail(`操作 ${a.id} 类型无效`);if(!a.label||!Array.isArray(a.roles)||a.roles.some(r=>!m.roles.includes(r)))fail(`操作 ${a.id} 角色无效`);if(!Array.isArray(a.fields)||a.fields.some(id=>!e.fields.some(f=>f.id===id)))fail(`操作 ${a.id} 字段引用无效`);if(a.kind==='transition'&&(!a.stateField||!e.fields.some(f=>f.id===a.stateField)||!Array.isArray(a.from)||typeof a.to!=='string'))fail(`操作 ${a.id} 状态转换不完整`);if(a.branch){if(!e.fields.some(f=>f.id===a.branch.field)||!['gt','gte','eq'].includes(a.branch.op)||!Number.isFinite(a.branch.value)||typeof a.branch.then!=='string')fail(`操作 ${a.id} 条件分支无效`);}if(a.defaults&&Object.keys(a.defaults).some(id=>!e.fields.some(f=>f.id===id)))fail('默认值引用了不存在字段');}
 for(const p of m.pages){if(!p.label||!entities.has(p.entity)||!Array.isArray(p.actions)||p.actions.some(a=>!actions.has(a)||m.actions.find(x=>x.id===a).entity!==p.entity))fail(`页面 ${p.id} 关联无效`);p.layout??='table';if(!['table','cards'].includes(p.layout))fail('页面布局只支持 table/cards');}
 for(const a of m.assumptions)if(typeof a.text!=='string'||!['pending','confirmed'].includes(a.status))fail('假设需要文字和 pending/confirmed 状态');
 for(const a of m.actions){const e=m.entities.find(e=>e.id===a.entity);if(a.kind==='transition'){const state=e.fields.find(f=>f.id===a.stateField);if(state.type!=='select')fail('状态转换必须绑定选项字段');if([...a.from,a.to,...(a.branch?[a.branch.then]:[])].some(v=>!state.options.includes(v)))fail(`操作 ${a.id} 使用了未定义的状态`);}if(a.branch&&e.fields.find(f=>f.id===a.branch.field).type!=='number')fail('数值分支必须引用数字字段');}
 m.description??='';m.source??='手工设计';validateLayouts(m);validateData(m,initialData(m),{constraints:false});return m;
}
export function initialData(m){const db={};for(const e of m.entities){db[e.id]=e.seed.map((r,i)=>({...r,id:i+1}));}return db;}
export function dataIssues(m,db,{constraints=true}={}){
 const errors=[];if(!db||typeof db!=='object'||Array.isArray(db))return ['存档缺少数据'];
 for(const e of m.entities){
  const rows=db[e.id];if(!Array.isArray(rows)||rows.length>10000){errors.push(`存档数据 ${e.id} 无效`);continue;}
  const ids=new Set(),uniques=new Map(e.fields.filter(f=>f.unique).map(f=>[f.id,new Set()]));
  for(const r of rows){
   if(!r||typeof r!=='object'||Array.isArray(r)||!Number.isSafeInteger(r.id)||r.id<1||ids.has(r.id)){errors.push(`${e.label} 存档数据主键无效`);continue;}ids.add(r.id);
   for(const f of e.fields){
    const v=r[f.id],label=`${e.label} #${r.id} 的 ${f.label}`,missing=v===undefined||v===null||v==='';
    if(missing){if(constraints&&f.required)errors.push(`${label} 缺少必填值`);continue;}
    if(['text','select','date'].includes(f.type)&&typeof v!=='string')errors.push(`${label} 必须是文字`);
    if(['number','reference'].includes(f.type)&&!Number.isFinite(v))errors.push(`${label} 必须是数字`);
    if(f.type==='boolean'&&typeof v!=='boolean')errors.push(`${label} 必须是布尔值`);
    if(!constraints)continue;
    if(f.type==='select'&&!f.options.includes(v))errors.push(`${label} 不在选项中`);
    if(f.type==='date'&&(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))errors.push(`${label} 不是有效日期`);
    if(f.min!==undefined&&typeof v==='number'&&v<f.min)errors.push(`${label} 小于下限`);
    if(f.unique){const values=uniques.get(f.id);if(values.has(v))errors.push(`${e.label}.${f.label} 不满足唯一约束`);values.add(v);}
    if(f.type==='reference'&&(!Number.isSafeInteger(v)||!db[f.target]?.some?.(row=>row?.id===v)))errors.push(`${label} 引用不存在的记录`);
   }
  }
 }
 return [...new Set(errors)];
}
export function validateData(m,db,options){const errors=dataIssues(m,db,options);if(errors.length)fail(errors.slice(0,6).join('；'));return structuredClone(db);}
export function contract(m,a){const e=m.entities.find(e=>e.id===a.entity);return {method:a.kind==='create'?'POST':a.kind==='delete'?'DELETE':'PATCH',path:`/api/${a.entity}${a.kind==='create'?'':'/:id'}${a.kind==='transition'||m.actions.filter(other=>other.entity===a.entity&&other.kind===a.kind).length>1?'/'+a.id:''}`,module:e.label+'服务',request:e.fields.filter(f=>a.fields.includes(f.id)).map(f=>({name:f.id,type:f.type,required:!!f.required})),roles:a.roles,response:'{ ok, record }',errors:['400 信息不完整','403 无权限','409 数据或状态冲突']};}
export function describeAction(model,action){
 const entity=model.entities.find(e=>e.id===action.entity);
 if(action.kind==='transition'){
  const base=`仅当状态为“${action.from.join('”或“')}”时可以执行。`;
  if(!action.branch)return base+`执行后变为“${action.to}”。`;
  const b=action.branch,label=entity.fields.find(f=>f.id===b.field).label,op={gt:'大于',gte:'大于或等于',eq:'等于'}[b.op];
  return base+`如果${label}${op} ${b.value}，转为“${b.then}”；否则转为“${action.to}”。`;
 }
 return action.kind==='create'?`在${entity.label}中新增一条记录。`:action.kind==='update'?`修改${entity.label}的指定记录，保留其他记录。`:`删除${entity.label}的指定记录；仍被其他记录引用时不能删除。`;
}
export function transitionDecision(model,action,row){
 const b=action.branch;let matched=null,target=action.to,explain=`从“${row[action.stateField]}”转为“${target}”，等待提交。`;
 if(b){const actual=row[b.field];if(!Number.isFinite(actual))throw Error('条件字段缺少有效数字，无法决定审批分支');matched=b.op==='gt'?actual>b.value:b.op==='gte'?actual>=b.value:actual===b.value;target=matched?b.then:action.to;const label=model.entities.find(e=>e.id===action.entity).fields.find(f=>f.id===b.field).label,op={gt:'大于',gte:'大于或等于',eq:'等于'}[b.op];explain=`${label}是 ${actual}；“${op} ${b.value}”${matched?'成立':'不成立'}，因此选择“${target}”。此时尚未写入数据库。`;}
 return {from:row[action.stateField],target,matched,explain};
}
export function makeRun(m,db,actionId,input,context){
 const a=m.actions.find(x=>x.id===actionId);if(!a)fail('操作不存在');const e=m.entities.find(x=>x.id===a.entity),api=contract(m,a);const s=[];const add=(node,title,explain,execute)=>s.push({node,title,explain,execute});
 add('device','收集页面上的信息','你的设备把按钮操作和表单整理成请求。',()=>({payload:input}));
 add('device','先检查表单','在发出请求之前，先检查必填和数据类型。',()=>{for(const id of a.fields){const f=e.fields.find(x=>x.id===id),v=input[id];if(f.required&&(v===undefined||v===''||v===null))throw Error(`请填写${f.label}`);if(v!==undefined&&v!==''&&v!==null){if(f.type==='number'&&(!Number.isFinite(v)||(f.min!==undefined&&v<f.min)))throw Error(`${f.label}不是有效数字`);if(f.type==='select'&&!f.options.includes(v))throw Error(`${f.label}选项无效`);}}return {payload:{checked:a.fields}};});
 add('network','找到服务器，建立连接','域名帮助定位服务；HTTPS 保护传输。此处执行的是网络条件模拟。',()=>{if(context.offline)throw Error('设备断网，请求没有离开你的设备');if(context.remote&&context.localOnly)throw Error('手机访问不到仅本机可用的服务，需要可达的托管环境');if(context.dnsFailure)throw Error('域名解析失败，设备找不到服务器地址');return {payload:{protocol:'HTTPS',...api}};});
 add('server','服务器验证身份与权限','服务器会再次检查你的操作资格，而不是只相信页面。',()=>{if(context.serverDown)throw Error('服务器未运行，无法处理请求');if(!a.roles.includes(context.role))throw Error(`“${context.role}”没有执行“${a.label}”的权限`);return {payload:{role:context.role,allowed:a.roles,instance:context.serverName??'业务服务器'}};});
 add('database','读取并核对现有数据','检查重复值、关联记录与当前状态，避免写入矛盾的数据。',()=>{if(context.dbDown)throw Error('数据库不可用，服务无法完成数据校验');const row=db[e.id].find(x=>x.id===input.id);if(a.kind!=='create'&&!row)throw Error('找不到要操作的记录');if(a.kind==='transition'&&!a.from.includes(row[a.stateField]))throw Error(`当前状态“${row[a.stateField]}”不允许此操作`);for(const f of e.fields){if(!a.fields.includes(f.id))continue;const v=input[f.id];if(f.unique&&v!==undefined&&v!==''&&db[e.id].some(r=>r[f.id]===v&&r.id!==input.id))throw Error(`${f.label}已存在`);if(f.type==='reference'&&v&&!db[f.target].some(r=>r.id===Number(v)))throw Error(`${f.label}引用的记录不存在`);}if(a.kind==='delete'){for(const other of m.entities)for(const f of other.fields)if(f.type==='reference'&&f.target===e.id&&db[other.id].some(r=>Number(r[f.id])===input.id))throw Error(`该记录仍被${other.label}引用，不能删除`);}return {payload:row??{result:'校验通过'}};});
 let decision=null;
 add('server','按照业务规则决定下一步',describeAction(m,a),()=>{if(a.kind==='transition'){decision=transitionDecision(m,a,db[e.id].find(r=>r.id===input.id));return {payload:decision,explain:decision.explain,decision};}return {payload:a.defaults??{operation:a.kind}};});
 add('database','提交数据变更','只有执行到这里才修改模拟数据；失败的前置检查不会写入数据。',()=>{if(context.dbDown)throw Error('数据库不可用');const candidate=structuredClone(db),rows=candidate[e.id],idx=rows.findIndex(r=>r.id===input.id);let result;const values=Object.fromEntries(a.fields.filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));if(a.kind==='create'){result={...a.defaults,...values,id:Math.max(0,...rows.map(r=>r.id))+1};rows.push(result);}else if(a.kind==='update'){result={...rows[idx],...values};rows[idx]=result;}else if(a.kind==='delete'){result=rows.splice(idx,1)[0];}else{result={...rows[idx],[a.stateField]:decision.target};rows[idx]=result;}validateData(m,candidate);db[e.id]=rows;return {payload:result,write:true};});
 add('server','把结果发回设备','服务器返回处理结果，页面不需要猜测操作是否成功。',()=>({payload:{ok:true}}));
 add('network','响应沿网络返回','结果通过连接返回客户端；这里没有发起第二次数据写入。',()=>({payload:{direction:'response'}}));
 add('device','页面显示最新结果','页面重新展示记录。你看到的界面与右侧数据来自同一个模型。',()=>({payload:{refresh:e.id}}));
 return {steps:s,index:-1,done:false,failed:false,action:a.id,log:[]};
}
export function stepRun(run,db){if(run.done)return null;const s=run.steps[++run.index];const before=structuredClone(db);let result;try{result=s.execute();}catch(e){run.failed=true;run.done=true;result={error:e.message};}if(run.index===run.steps.length-1)run.done=true;const entry={node:s.node,title:result.error?'这一步没有通过':s.title,explain:result.error||s.explain,...result,before,after:structuredClone(db),index:run.index};run.log.push(entry);return entry;}
export function changeSummary(before,after){const out=[];for(const key of ['name','description','roles','entities','pages','actions','assumptions'])if(JSON.stringify(before[key])!==JSON.stringify(after[key]))out.push(key);return out;}
export const MODEL_GUIDE=`Return ONLY a JSON object, no markdown. Schema: {version:2,name:string,description:string,source:"AI 草案",roles:string[],entities:[{id:englishIdentifier,label:string,fields:[{id:englishIdentifier,label:string,type:"text"|"number"|"select"|"date"|"boolean"|"reference",required?:boolean,unique?:boolean,min?:number,options?:string[],target?:entityId}],seed:object[]}],pages:[{id:englishIdentifier,label:string,entity:entityId,layout:"table"|"cards",actions:actionId[]}],actions:[{id:englishIdentifier,label:string,entity:entityId,kind:"create"|"update"|"delete"|"transition",fields:fieldId[],roles:string[],description:string,defaults?:object,stateField?:fieldId,from?:string[],to?:string,branch?:{field:fieldId,op:"gt"|"gte"|"eq",value:number,then:string}}],assumptions:[{text:string,status:"pending"}]}. All identifiers start lowercase ASCII and contain only letters/digits/underscore; do NOT define an id field (primary key is automatic). Every referenced entity/action/field must exist. Pages must only reference actions of their own entity. For transition, fields:[], stateField/from/to required; branch optionally overrides to. Support CRUD and conditional approval only. The engine enforces simulated role permissions, required/type/minimum/unique/reference constraints and state transitions; it does not implement real authentication, record ownership, inventory decrements, date arithmetic or arbitrary cross-field conditions. Page text and assumptions must describe only actual implemented behavior and must not claim those absent restrictions. A page has functional record search; use a search block to position it. If text says a field can be edited, include it in an update action. For new required fields in revisions, include safe explicit create-action defaults when suitable; existing records are backfilled only after a user confirms the migration preview, never claim it happened automatically. For requirements not representable, explicitly list limitations in assumptions, never invent supported execution. Reference fields target another entity and store numeric IDs. Seed must be fictional and minimal. Use Chinese visible labels. If image supplied, reconstruct its visible pages, fields and actions using the page block grid and table/cards record views, note uncertain visual/behavior guesses in assumptions; never claim pixel-perfect layout. If revising a model preserve identifiers and existing seed when possible. All assumptions pending. Never emit executable code. ${LAYOUT_GUIDE}`;


