export const FIELD_TYPES={text:'文字',number:'数字',date:'日期',select:'单选',boolean:'是 / 否',reference:'关联业务编号',table:'重复明细表'};
export function validateField(field){
 const type=field.type??'text';
 if(type==='table'){
  if(!Array.isArray(field.columns)||!field.columns.length||field.columns.length>20)throw Error('明细需要 1–20 列');
  const ids=new Set();for(const column of field.columns){if(!column.id||!column.label?.trim()||ids.has(column.id)||['table','reference'].includes(column.type))throw Error('明细列名称、编号或类型无效');ids.add(column.id);validateField(column);}
 }
 if(!Object.hasOwn(FIELD_TYPES,type))throw Error('未知字段类型');
 if(field.unit!==undefined&&(typeof field.unit!=='string'||field.unit.length>40))throw Error('单位过长');
 if(type==='select'&&(!Array.isArray(field.options)||!field.options.length||field.options.length>100||field.options.some(v=>typeof v!=='string'||!v.trim()||v.length>200)||new Set(field.options).size!==field.options.length))throw Error('单选需要不重复的选项');
 for(const key of ['min','max'])if(field[key]!==undefined&&!Number.isFinite(field[key]))throw Error('数值范围无效');
 if(field.min!==undefined&&field.max!==undefined&&field.min>field.max)throw Error('最小值不能大于最大值');
 if(field.confirmation!==undefined&&!['pending','confirmed'].includes(field.confirmation))throw Error('确认状态无效');
 if(field.evidence!==undefined&&(typeof field.evidence!=='string'||field.evidence.length>2000))throw Error('规则依据过长');
 return field;
}
export function validateFieldValue(field,value){
 validateField(field);if(typeof value!=='string'||value.length>20000)throw Error(`${field.label}：填写内容过长或格式无效`);
 if(!value.trim())return;
 const type=field.type??'text';
 if(type==='table'){
  let rows;try{rows=JSON.parse(value);}catch{throw Error(field.label+'：明细数据格式无效');}
  if(!Array.isArray(rows)||rows.length>100)throw Error('每个明细最多 100 行');
  for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row))throw Error('明细行无效');for(const [key,cell] of Object.entries(row)){const column=field.columns.find(c=>c.id===key);if(!column)throw Error('未知明细列');validateFieldValue(column,cell);}}
 }
 if(type==='number'){
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())||!Number.isFinite(Number(value)))throw Error(`${field.label}：请输入有效数字`);
  if(field.min!==undefined&&Number(value)<field.min||field.max!==undefined&&Number(value)>field.max)throw Error(`${field.label}：超出允许范围`);
 }
 if(type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error(`${field.label}：请输入有效日期 YYYY-MM-DD`);
 if(type==='select'&&!field.options.includes(value))throw Error(`${field.label}：请选择已有选项`);
 if(type==='boolean'&&!['true','false'].includes(value))throw Error(`${field.label}：请选择是或否`);
 if(type==='reference'&&!/^[\w-]{1,200}$/.test(value))throw Error(`${field.label}：业务编号无效`);
}
export function fieldSchema(field){
 const type=field.type??'text';const s={title:field.label,type:type==='number'?'number':type==='boolean'?'boolean':'string','x-field-id':field.id,'x-owner-stage':field.owner,'x-unit':field.unit??'','x-source':field.evidence??'', 'x-confirmation':field.confirmation??'pending'};
 if(type==='table'){s.type='array';s.maxItems=100;s.items={type:'object',additionalProperties:false,properties:Object.fromEntries(field.columns.map(c=>[c.id,{anyOf:[fieldSchema(c),{const:''}]}]))};s['x-required-columns']=field.columns.filter(c=>c.required).map(c=>c.id);}
 if(type==='date')s.format='date';if(type==='select')s.enum=[...field.options];if(type==='number'){if(field.min!==undefined)s.minimum=field.min;if(field.max!==undefined)s.maximum=field.max;}
 if(type==='reference')s['x-reference']='business_records.id';return s;
}
export function typedValues(template,values){return Object.fromEntries(template.fields.filter(f=>values[f.id]?.trim()).map(f=>{const value=values[f.id];validateFieldValue(f,value);return [f.id,f.type==='table'?JSON.parse(value).map(row=>typedValues({fields:f.columns},row)):f.type==='number'?Number(value):f.type==='boolean'?value==='true':value];}));}

export function missingDetailValues(field, value) {
 if (field.type !== 'table') return false;
 const rows = value?.trim() ? JSON.parse(value) : [];
 return (field.required && rows.length === 0) || rows.some(row => field.columns.some(column => column.required && !String(row[column.id] ?? '').trim()));
}
