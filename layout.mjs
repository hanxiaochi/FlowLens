export const BLOCK_TYPES={heading:'标题',text:'说明文字',metric:'数据指标',records:'记录列表',action:'操作按钮',navigate:'页面跳转',form:'输入表单',divider:'分隔线',search:'记录搜索'};
export function validateLayouts(model){
 for(const page of model.pages){
  if(page.navigation!==undefined&&!['top','side'].includes(page.navigation))throw Error('导航位置需要 top 或 side');
  if(page.accent!==undefined&&!/^#[0-9a-fA-F]{6}$/.test(page.accent))throw Error('页面强调色需要六位十六进制颜色');
  if(page.blocks===undefined)continue;
  if(!Array.isArray(page.blocks)||page.blocks.length>40)throw Error('每页最多支持 40 个布局区块');
  if(page.blocks.filter(b=>b.type==='search').length>1)throw Error('每页只支持一个记录搜索区块');
  const ids=new Set();
  for(const block of page.blocks){
   if(typeof block.id!=='string'||!/^[a-z][a-zA-Z0-9_]{0,40}$/.test(block.id)||ids.has(block.id))throw Error('布局区块标识无效或重复');ids.add(block.id);
   if(!Object.hasOwn(BLOCK_TYPES,block.type))throw Error(`不支持的布局区块 ${block.type}`);
   if(block.span!==undefined&&(!Number.isInteger(block.span)||block.span<1||block.span>12))throw Error('区块宽度必须是 1–12');
   if(block.tone!==undefined&&!['neutral','purple','green','peach'].includes(block.tone))throw Error('区块颜色无效');
   for(const key of ['title','text'])if(block[key]!==undefined&&(typeof block[key]!=='string'||block[key].length>2000))throw Error('区块文字需要少于 2000 字');
   if(block.type==='metric'){const entity=model.entities.find(e=>e.id===block.entity);if(!entity)throw Error('指标引用了不存在的实体');if(!['count','sum'].includes(block.operation))throw Error('指标只支持 count/sum');if(block.operation==='sum'&&!entity.fields.some(f=>f.id===block.field&&f.type==='number'))throw Error('求和指标需要数字字段');}
   if(['action','form'].includes(block.type)){const action=model.actions.find(a=>a.id===block.action);if(!action||action.entity!==page.entity||!page.actions.includes(action.id)||action.kind!=='create')throw Error('独立按钮与表单必须绑定本页的创建操作；记录操作由列表承载');}
   if(block.type==='navigate'&&!model.pages.some(p=>p.id===block.page))throw Error('跳转目标页面不存在');
   if(['records','search'].includes(block.type)&&block.fields!==undefined){const entity=model.entities.find(e=>e.id===page.entity);if(!Array.isArray(block.fields)||block.fields.some(id=>!entity.fields.some(f=>f.id===id)))throw Error('列表显示字段引用无效');}
  }
 }
 return model;
}
export function metricValue(block,db){const rows=db[block.entity]??[];return block.operation==='sum'?rows.reduce((total,row)=>total+(Number.isFinite(row[block.field])?row[block.field]:0),0):rows.length;}
export const LAYOUT_GUIDE=`Pages can include navigation:"top"|"side", accent:"#RRGGBB", and blocks:[{id:identifier,type:"heading"|"text"|"metric"|"records"|"action"|"navigate"|"form"|"divider"|"search",span:1..12,title?:string,text?:string,tone?:"neutral"|"purple"|"green"|"peach",entity?:entityId,operation?:"count"|"sum",field?:numericFieldId,action?:actionId,page?:pageId,fields?:fieldId[]}]. Blocks render in order on a responsive 12-column grid. search renders a real text input filtering this page records by displayed field values; at most one search block per page, optional fields limits searchable fields (omit to search all), title is its accessible label and placeholder. Do not recreate search as a text block. A search block replaces the built-in page search. metric needs entity and operation (sum also field); records uses page.entity and optionally field subset; action/form must bind a create action in page.actions; navigate needs target page. For screenshots reproduce visible hierarchy, navigation position, relative widths, headings, metrics, forms and record sections using these blocks. Never replace a supplied layout with an unrelated fixed template. Exact coordinates, charts, images and unsupported interactions must be stated as pending assumptions. For existing pages, preserve their blocks when unrelated changes are requested.`;
