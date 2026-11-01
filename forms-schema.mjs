export const FIELD_TYPES={text:'文字',number:'数字',date:'日期',select:'单选',boolean:'是 / 否',reference:'关联业务编号'};
export function validateField(field){
 const type=field.type??'text';if(!Object.hasOwn(FIELD_TYPES,type))throw Error('未知字段类型');
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
 if(type==='date')s.format='date';if(type==='select')s.enum=[...field.options];if(type==='number'){if(field.min!==undefined)s.minimum=field.min;if(field.max!==undefined)s.maximum=field.max;}
 if(type==='reference')s['x-reference']='business_records.id';return s;
}
export function typedValues(template,values){return Object.fromEntries(template.fields.filter(f=>values[f.id]?.trim()).map(f=>{const value=values[f.id];validateFieldValue(f,value);return [f.id,f.type==='number'?Number(value):f.type==='boolean'?value==='true':value];}));}
