import {contract,describeAction} from './model.mjs';
function fieldSchema(f){
 const s=f.type==='number'?{type:'number'}:f.type==='reference'?{type:'integer',minimum:1}:f.type==='boolean'?{type:'boolean'}:f.type==='select'?{type:'string',enum:[...f.options]}:f.type==='date'?{type:'string',format:'date'}:{type:'string'};
 s.description=f.label;if(f.min!==undefined)s.minimum=f.min;if(!f.required)s.nullable=true;
 if(f.required&&['text','select','date'].includes(f.type))s.minLength=1;
 if(f.unique)s['x-flowlens-unique']=true;if(f.target)s['x-flowlens-reference']=f.target;
 return s;
}
const ref=id=>({$ref:'#/components/schemas/'+id});
export function openApi(model){
 const paths={},schemas={};
 for(const e of model.entities)schemas[e.id]={type:'object',required:['id',...e.fields.filter(f=>f.required).map(f=>f.id)],properties:{id:{type:'integer',minimum:1},...Object.fromEntries(e.fields.map(f=>[f.id,fieldSchema(f)]))}};
 for(const a of model.actions){
  const c=contract(model,a),path=c.path.replace(':id','{id}'),entity=model.entities.find(e=>e.id===a.entity);
  paths[path]??={};const op={operationId:a.id,summary:a.label,description:describeAction(model,a)+' 允许角色：'+a.roles.join('、'),tags:[c.module],'x-flowlens-roles':a.roles,'x-flowlens-rules':{kind:a.kind,...(a.kind==='transition'?{stateField:a.stateField,from:a.from,to:a.to,branch:a.branch}:{}),...(a.defaults?{defaults:a.defaults}:{})},responses:{200:{description:a.kind==='delete'?'已删除，record 为删除前记录':'操作成功',content:{'application/json':{schema:{type:'object',required:['ok','record'],properties:{ok:{type:'boolean',enum:[true]},record:ref(a.entity)}}}}},400:{description:'输入校验失败'},403:{description:'权限不足'},409:{description:'状态、唯一值或关联冲突'}}};
  if(a.kind!=='create')op.parameters=[{name:'id',in:'path',required:true,schema:{type:'integer',minimum:1}}];
  if(a.fields.length){const fields=entity.fields.filter(f=>a.fields.includes(f.id));op.requestBody={required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,properties:Object.fromEntries(fields.map(f=>[f.id,fieldSchema(f)])),required:fields.filter(f=>f.required).map(f=>f.id)}}}};}
  if(paths[path][c.method.toLowerCase()])throw Error('接口路径冲突：'+c.method+' '+path);
  paths[path][c.method.toLowerCase()]=op;
 }
 return {openapi:'3.0.3',info:{title:model.name,version:'1.0.0',description:'FlowLens 设计契约。实现时将未填写的可选字段规范化为 null；补充真实认证、记录权限与部署配置。'},paths,components:{schemas}};
}
export function sqlSchema(model){
 const quote=id=>'"'+id.replaceAll('"','""')+'"',literal=v=>"'"+String(v).replaceAll("'","''")+"'";
 let out='-- FlowLens PostgreSQL schema draft. Review before running.\n-- No database has been modified.\n-- Normalize empty optional form values to NULL before INSERT/UPDATE.\n-- Permissions and transition rules require backend implementation.\n\n';
 for(const e of model.entities){
  out+=`CREATE TABLE ${quote(e.id)} (\n  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`;
  for(const f of e.fields){const col=quote(f.id),type=f.type==='number'?'NUMERIC':f.type==='reference'?'BIGINT':f.type==='boolean'?'BOOLEAN':f.type==='date'?'DATE':'TEXT';
   out+=`,\n  ${col} ${type}${f.required?' NOT NULL':''}${f.unique?' UNIQUE':''}`;
   if(f.type==='select')out+=` CHECK (${col} IN (${f.options.map(literal).join(', ')}))`;
   if(f.type==='number'&&f.min!==undefined)out+=` CHECK (${col} >= ${f.min})`;
   if(f.required&&f.type==='text')out+=` CHECK (${col} <> '')`;
  }
  out+='\n);\n\n';
 }
 for(const e of model.entities)for(const f of e.fields)if(f.type==='reference')out+=`ALTER TABLE ${quote(e.id)} ADD FOREIGN KEY (${quote(f.id)}) REFERENCES ${quote(f.target)}(id) ON DELETE RESTRICT;\n`;
 return out;
}
