import {renderApplications} from './apps-ui.js';
import {startProjectCase} from './apps-model.mjs';
import {renderDetailField,detailColumnsEditor} from './forms-detail-ui.js';
import {proposeRule,acceptRule} from './forms-rules.mjs';
import {unzipSync} from '/forms-vendor/fflate.js';
import {extractDocumentXML,parseWordXML,formCells} from './forms-docx.mjs';
import {uid,createCase,canEdit,applyOperation,attachFile,validateWorkflow} from './forms-model.mjs';
import {emptyWorkspace,loadWorkspace,saveWorkspace,validateWorkspace,commitWorkspace,upgradeWorkspace} from './forms-store.mjs';
import {FIELD_TYPES,validateField} from './forms-schema.mjs';
import {renderDelivery} from './forms-delivery-ui.js';
import {printableForm} from './forms-print.mjs';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
const select=(items,value)=>{const s=el('select');for(const [v,t] of items){const o=el('option',t);o.value=v;s.append(o);}s.value=value;return s;};
const label=(name,input)=>{const l=el('label',name);l.append(input);return l;};
const download=(name,data,type='application/json')=>{const a=el('a');const u=URL.createObjectURL(new Blob([data],{type}));a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);};
const readData=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('附件读取失败'));r.readAsDataURL(file);});
const kinds={review:'审核',issue:'签发',receipt:'签收'};

export async function mountForms(root,{onContext=()=>{},onNavigate=()=>{}}={}){
 let workspace=emptyWorkspace(),selected=null,kind='templates',query='',role='填报人',busy=false,ready=false,view='forms',appId='',projectId='',inboxRole='';
 const notice=el('p','正在恢复业务工作区…','forms-notice');notice.setAttribute('role','status');
 const top=el('div',undefined,'forms-intro');const intro=el('div');intro.append(el('span','PAPERWORK, IN MOTION','eyebrow'),el('h2','把一套表，变成一个应用。'),el('p','导入业务表格，组织项目、关联单据与待办，一步步确认系统怎样工作。'));
 const actions=el('div',undefined,'forms-toolbar');const upload=el('input');upload.type='file';upload.accept='.docx';upload.multiple=true;upload.hidden=true;upload.id='forms-word-upload';
 const packInput=el('input');packInput.type='file';packInput.accept='.json';packInput.hidden=true;
 const importBtn=button('＋ 导入 Word 表格',()=>upload.click(),'primary');
 actions.append(button('体验整改闭环样例',wrap(async()=>{if(!clean())return;const {rectificationWorkspace}=await import('./forms-demo.mjs');const sample=rectificationWorkspace();const existing=workspace.templates.find(t=>t.id===sample.templates[0].id);await commit(w=>{if(!existing)w.templates.push(sample.templates[0]);w.cases.unshift(sample.cases[0]);});kind='cases';selected=sample.cases[0].id;role=sample.cases[0].submitter;appId='';projectId='';view='forms';draw();say('已添加虚构整改样例，现有业务保留。');})),importBtn,button('导出业务工作包',()=>{if(clean())download('FlowLens-业务工作包.json',JSON.stringify(workspace));}),button('恢复工作包',()=>packInput.click()),upload,packInput);top.append(intro,actions);
 const applicationHost=el('section',undefined,'application-workspace');
 const metrics=el('div',undefined,'forms-metrics');const grid=el('div',undefined,'forms-workspace');const library=el('aside',undefined,'forms-library');const center=el('article',undefined,'forms-center');const inspector=el('aside',undefined,'forms-inspector');grid.append(library,center,inspector);
 const delivery=el('article',undefined,'forms-center forms-delivery');delivery.hidden=true;root.append(top,notice,applicationHost,metrics,grid,delivery);
 actions.prepend(button('应用首页',()=>{if(busy||!clean())return;selected=null;view='forms';draw();onNavigate('forms');}));
 actions.prepend(button('体验多表应用样例',wrap(async()=>{if(!clean())return;const {applicationDemo}=await import('./apps-demo.mjs');const sample=applicationDemo();const existing=workspace.applications.find(a=>a.id===sample.applications[0].id);if(!existing)await commit(w=>{w.templates.push(...sample.templates);w.applications.push(...sample.applications);w.projects.push(...sample.projects);w.cases.unshift(...sample.cases);});appId=sample.applications[0].id;projectId=workspace.projects.find(p=>p.appId===appId)?.id??'';kind='cases';selected=null;view='forms';draw();say('多表应用已就绪，先从项目台账打开监理指令单。');})));
 actions.append(button('下载未保存草稿',()=>download('FlowLens-未保存草稿.json',JSON.stringify({format:'flowlens-unsaved-draft',recordId:kind==='cases'?selected:null,values:kind==='cases'?values():{},workspace},null,2))),button('备份并重新读取',wrap(async()=>{download('FlowLens-读取前草稿.json',JSON.stringify({recordId:selected,values:kind==='cases'?values():{},workspace},null,2));workspace=await loadWorkspace();draw();say('已读取最新存档，原页面输入已下载到草稿文件。');})));
 const utilities=el('details',undefined,'forms-utilities');utilities.append(el('summary','备份与更多'));
 const extra=el('div',undefined,'forms-toolbar');
 for(const control of Array.from(actions.querySelectorAll('button')))if(['体验整改闭环样例','导出业务工作包','恢复工作包','下载未保存草稿','备份并重新读取'].includes(control.textContent))extra.append(control);
 utilities.append(extra);actions.append(utilities);
 function say(message,error=false){notice.textContent=message;notice.classList.toggle('error',error);}
 async function commit(mutate){try{workspace=await commitWorkspace(workspace,mutate);}catch(e){throw Error('未推进已保存状态，当前输入仍保留。可下载未保存草稿。'+e.message);}}
 function selectedItem(){return workspace[kind].find(x=>x.id===selected);}
 function template(){const item=selectedItem();return kind==='cases'?item?.template:item;}
 function clean(){const item=selectedItem();if(kind!=='cases'||!item)return true;const dirty=Object.entries(values()).some(([k,v])=>v!==(item.values[k]??''));if(dirty)say('当前表单有未保存内容，请先保存填写或提交，再切换记录、导入或打印。',true);return !dirty;}
 window.addEventListener('beforeunload',e=>{if(!clean()){e.preventDefault();e.returnValue='';}});
 function wrap(fn){return async()=>{if(!ready||busy)return;try{busy=true;root.inert=true;await fn();}catch(e){say(e.message,true);}finally{busy=false;root.inert=false;}};}
 function openItem(nextKind,id){kind=nextKind;selected=id;view='forms';const record=nextKind==='cases'?workspace.cases.find(c=>c.id===id):null;if(record)role=record.status==='active'?record.template.workflow[record.step].role:record.submitter;draw();center.scrollIntoView({behavior:'smooth',block:'start'});}
 function draw(){
  renderApplications(applicationHost,{workspace,appId,projectId,role:inboxRole,
   guard:()=>!busy&&clean(),say,download,
   onSelect:(nextApp,nextProject)=>{appId=nextApp;projectId=nextProject||workspace.projects.find(p=>p.appId===appId)?.id||'';selected=null;view='forms';draw();},
   onOpen:openItem,onRole:value=>{inboxRole=value;draw();},
   mutate:async mutate=>{if(busy)throw Error('正在保存，请稍候');busy=true;root.inert=true;try{await commit(mutate);draw();}finally{busy=false;root.inert=false;}}
  });
  metrics.replaceChildren(...[[workspace.templates.length,'份模板'],[workspace.cases.length,'份业务'],[workspace.cases.filter(c=>c.status==='active').length,'项办理中'],[workspace.cases.filter(c=>c.status==='complete').length,'项已归档']].map(([n,t])=>{const x=el('div');x.append(el('strong',String(n)),el('span',t));return x;}));
  renderLibrary();renderCenter();renderInspector();renderView();onContext(context());
 }
 function context(){const item=selectedItem();return item?{template:template(),record:kind==='cases'?item:null}:null;}
 function renderView(){const c=context();applicationHost.hidden=view!=='forms'||!!selected;grid.hidden=(view!=='forms'&&!!c)||(!!appId&&!selected);metrics.hidden=!!appId;delivery.hidden=view==='forms'||!c;if(!delivery.hidden)renderDelivery(delivery,c.template,c.record,{view,download,relatedRecords:workspace.cases.filter(r=>r.id===c.record?.relatedId||r.relatedId===c.record?.id),runtimeFiles:['forms-model.mjs','forms-schema.mjs','forms-rules.mjs','forms-acceptance.mjs','forms-verify.mjs']});}
 function renderLibrary(){
  library.replaceChildren();const tabs=el('div',undefined,'forms-library-tabs');for(const [key,name] of [['templates','模板库'],['cases','业务台账']])tabs.append(button(name,()=>{if(busy||!clean())return;kind=key;selected=null;draw();},kind===key?'selected':''));
  const search=el('input');search.placeholder='搜索表号、名称、项目';search.value=query;search.setAttribute('aria-label','搜索业务表单');search.oninput=()=>{query=search.value;renderList();};
  const list=el('div',undefined,'forms-list');library.append(tabs,search,list);
  function renderList(){list.replaceChildren();const scoped=workspace[kind].filter(item=>appId?(kind==='templates'?workspace.applications.find(a=>a.id===appId)?.templateIds.includes(item.id):item.appId===appId&&item.projectId===projectId):(kind==='templates'||!item.appId));const items=scoped.filter(t=>`${t.code??t.template.code} ${t.title} ${t.project??''} ${t.source??''}`.toLowerCase().includes(query.toLowerCase()));for(const item of items){const b=button('',()=>{if(busy||!clean())return;openItem(kind,item.id);},'forms-list-item'+(item.id===selected?' selected':''));b.append(el('small',kind==='templates'?(item.code||'自定义文档'):(item.status==='complete'?'已归档':item.status==='draft'?'填报中':item.template.workflow[item.step].label)),el('strong',item.title),el('span',kind==='templates'?item.source:(item.project||'未填写项目')));list.append(b);}if(!items.length)list.append(el('p',query?'没有匹配记录':'从一份真实的 Word 开始。','forms-empty'));}renderList();
 }
 function renderBlocks(blocks,parent,t,record){
  for(const b of blocks){
   if(b.type==='paragraph'){
    const p=el('div',b.text,'forms-paragraph');if(['center','right'].includes(b.align))p.style.textAlign=b.align;if(b.bold)p.classList.add('bold');
    if(kind==='templates'&&b.text.trim())p.append(button('＋ 填写区',()=>editField(b.id,b.text.slice(0,20)),'forms-map-paragraph'));
    addInput(p,b.id,t,record);parent.append(p);continue;
   }
   const table=el('table',undefined,'forms-table');const colgroup=el('colgroup');const total=b.grid.reduce((a,v)=>a+Number(v),0);for(const width of b.grid){const col=el('col');if(total)col.style.width=`${Number(width)/total*100}%`;colgroup.append(col);}table.append(colgroup);const tbody=el('tbody');
   for(const row of b.rows){const tr=el('tr');for(const c of row){const td=el('td');td.colSpan=c.colspan;td.rowSpan=c.rowspan;td.dataset.cell=c.id;if(c.spacer){tr.append(td);continue;}
     // Paragraph controls are only offered at document level, not duplicated inside cells.
     for(const cb of c.blocks){if(cb.type==='paragraph')td.append(el('div',cb.text,'forms-cell-text'));else renderBlocks([cb],td,t,record);}
     if(kind==='templates'){td.tabIndex=0;td.classList.add('forms-mappable');td.setAttribute('aria-label',`配置填写区 ${c.text.trim().slice(0,30)||c.id}`);td.onclick=e=>{if(e.target.closest('table')===table)editField(c.id,c.text.trim().slice(0,24)||'填写内容');};td.onkeydown=e=>{if(e.target===td&&e.key==='Enter')editField(c.id,c.text.trim().slice(0,24)||'填写内容');};}
     addInput(td,c.id,t,record);tr.append(td);
    }tbody.append(tr);}table.append(tbody);parent.append(table);
  }
 }
 function addInput(parent,id,t,record){
  const f=t.fields.find(x=>x.id===id);if(!f)return;const owner=f.owner==='draft'?(t.submitterRole??'填报人'):t.workflow.find(s=>s.id===f.owner)?.role;
  if(!record){parent.append(el('span',`${f.label}${f.required?' *':''} · ${owner}`,'forms-field-hint'));return;}
  if(f.type==='table'){renderDetailField(parent,f,record.values[id]??'',canEdit(record,f,role));return;}
  let input;const type=f.type??'text';if(type==='select'||type==='boolean'||type==='reference'){const choices=type==='select'?f.options.map(v=>[v,v]):type==='boolean'?[['true','是'],['false','否']]:workspace.cases.filter(c=>c.id!==record.id).map(c=>[c.id,c.title]);const saved=record.values[id]??'';if(saved&&!choices.some(([v])=>v===saved))choices.push([saved,saved]);input=select([['','请选择'],...choices],saved);input.disabled=!canEdit(record,f,role);}else{input=el(type==='text'?'textarea':'input');if(type==='text')input.rows=2;else{input.type=type==='number'?'text':'date';if(type==='number')input.inputMode='decimal';}input.value=record.values[id]??'';}input.dataset.field=id;input.setAttribute('aria-label',f.label);input.placeholder=f.label+(f.required?' *':'');input.readOnly=!canEdit(record,f,role);input.className='forms-value';
  const print=el('div',input.value,'forms-print-value');parent.append(input,print);
 }
 function renderCenter(){
  center.replaceChildren();const item=selectedItem(),t=template();if(!item){center.append(el('div','一套真实业务表格，就是系统的起点。','forms-empty-title'),el('p','支持多份 DOCX 批量导入，按监理表号整理模板。复杂表头、合并单元格和附表保留在一起。'),el('p','先核对导入结构，再确认填写区和办理流程。原件不会被修改，导入不调用 AI。'));return;}
  const header=el('div',undefined,'forms-document-head');header.append(el('span',t.code||'WORD DOCUMENT','eyebrow'),el('h3',item.title),el('p',kind==='templates'?`${t.source} · 模板版本 ${t.version} · ${t.fields.length} 个候选填写区`:`${item.project||'未指定项目'} · 修订 ${item.revision} · ${item.status==='complete'?'已归档':item.status==='draft'?'填报中':t.workflow[item.step].label}`));
  center.append(header);if(t.warnings?.length){const details=el('details');details.append(el('summary',`导入注意事项（${t.warnings.length}）`));for(const w of t.warnings)details.append(el('p',w));center.append(details);}
  const paper=el('div',undefined,'forms-paper');renderBlocks(t.blocks,paper,t,kind==='cases'?item:null);center.append(paper);
 }
 function modal(title){const d=el('dialog',undefined,'forms-dialog');const head=el('div',undefined,'dialog-head');head.append(el('h2',title),button('关闭',()=>d.close()));d.append(head);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return d;}
 function editField(id,suggestion){
  const t=template();if(kind!=='templates')return;const old=t.fields.find(f=>f.id===id);const d=modal('确认这个填写区');const name=el('input');name.value=old?.label??suggestion;name.maxLength=100;
  const type=select(Object.entries(FIELD_TYPES),old?.type??'text');const unit=el('input');unit.value=old?.unit??'';const options=el('input');options.value=old?.options?.join('，')??'';const min=el('input');min.type='number';min.value=old?.min??'';const max=el('input');max.type='number';max.value=old?.max??'';const evidence=el('textarea');evidence.value=old?.evidence??`${t.source} / ${id}`;const confirmed=el('input');confirmed.type='checkbox';confirmed.checked=old?.confirmation==='confirmed';
  const owner=select([['draft','填报人'],...t.workflow.map(s=>[s.id,`${s.label} · ${s.role}`])],old?.owner??'draft');const required=el('input');required.type='checkbox';required.checked=!!old?.required;
  d.append(el('p','保留原文，在选中的位置增加填写区。历史业务使用创建时的模板，不会被本次修改覆盖。'),label('字段名称',name),label('数据类型',type),label('单位（可选）',unit),label('单选选项（逗号分隔）',options),label('最小值（数字字段）',min),label('最大值（数字字段）',max),label('原文位置 / 规则依据',evidence),label('已由业务人员确认',confirmed),label('由哪个阶段填写',owner),label('办理前必须填写',required));
  const detailBox=el('section');const columns=detailColumnsEditor(detailBox,old?.columns??[]);detailBox.hidden=type.value!=='table';type.onchange=()=>detailBox.hidden=type.value!=='table';d.append(detailBox);
  d.append(button('保存填写区',wrap(async()=>{if(!name.value.trim())throw Error('请填写字段名称');const f={id,label:name.value.trim(),owner:owner.value,required:required.checked,type:type.value,unit:unit.value.trim(),evidence:evidence.value,confirmation:confirmed.checked?'confirmed':'pending'};if(f.type==='table')f.columns=columns();if(f.type==='select')f.options=options.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean);if(f.type==='number'){if(min.value!=='')f.min=Number(min.value);if(max.value!=='')f.max=Number(max.value);}validateField(f);await commit(w=>{const target=w.templates.find(x=>x.id===t.id);target.fields=target.fields.filter(x=>x.id!==id);target.fields.push(f);target.version++;});d.close();draw();say('填写区已更新，已有业务不受影响。');}),'primary'));
  if(old)d.append(button('移除此填写区',wrap(async()=>{await commit(w=>{const target=w.templates.find(x=>x.id===t.id);target.fields=target.fields.filter(x=>x.id!==id);target.version++;});d.close();draw();})));
 }
 function configureFlow(){
  const t=template(),d=modal('这份表交给谁办理');const submitter=el('input');submitter.value=t.submitterRole??'填报人';d.append(label('发起角色',submitter));const draft=structuredClone(t.workflow);const list=el('div');d.append(el('p','这是可修改的流程草案，不是从签字栏自动判定的业务规则。请对照原表说明确认；同一角色可出现在多个节点。'),list);
  const rows=[];
  function paint(){list.replaceChildren();rows.length=0;draft.forEach((s,i)=>{const box=el('div',undefined,'forms-flow-edit');const n=el('input');n.value=s.label;n.setAttribute('aria-label',`节点 ${i+1} 名称`);const r=el('input');r.value=s.role;r.setAttribute('aria-label',`节点 ${i+1} 角色`);const k=select(Object.entries(kinds),s.kind);k.setAttribute('aria-label',`节点 ${i+1} 类型`);const back=select([['draft','退回填报'],...draft.slice(0,i).map(x=>[x.id,'退回 '+x.label])],s.returnTo??'draft');back.setAttribute('aria-label',`节点 ${i+1} 退回目标`);rows.push({s,n,r,k,back});box.append(el('b',`${i+1}`),n,r,k,back,button('移除',()=>{sync();draft.splice(i,1);paint();}));list.append(box);});}
  function sync(){rows.forEach(({s,n,r,k,back})=>Object.assign(s,{label:n.value.trim(),role:r.value.trim(),kind:k.value,returnTo:back.value}));}
  d.append(button('＋ 增加办理节点',()=>{sync();draft.push({id:uid(),label:'审核',role:'审核人',kind:'review'});paint();}),button('确认流程',wrap(async()=>{sync();validateWorkflow(draft);const removed=t.fields.filter(f=>f.owner!=='draft'&&!draft.some(s=>s.id===f.owner));if(removed.length)throw Error('被移除节点还有填写区，请先把这些填写区调整到其他阶段：'+removed.map(f=>f.label).join('、'));await commit(w=>{const target=w.templates.find(x=>x.id===t.id);target.workflow=draft;target.submitterRole=submitter.value.trim()||'填报人';target.version++;});d.close();draw();say('流程已确认，仅用于此后创建的业务。');}),'primary'));paint();
 }

 function configureNaturalRule(){
  const t=template(),d=modal('用一句话调整规则');const input=el('textarea');input.setAttribute('aria-label','规则描述');input.placeholder='当复查结论为不通过时退回填报';
  d.append(el('p','本地规则助手支持必填、办理角色和条件退回。输入后查看草案，再确认应用。'),label('规则描述',input));const preview=el('div');d.append(preview);
  d.append(button('生成规则草案',()=>{try{const proposal=proposeRule(t,input.value);preview.replaceChildren(el('h3','将要修改'),el('p',proposal.explanation),el('p','这次修改用于新发起的单据。已有业务沿用创建时的模板快照。'),button('确认应用规则',wrap(async()=>{await commit(w=>{const index=w.templates.findIndex(item=>item.id===t.id);w.templates[index]=acceptRule(w.templates[index],proposal);});d.close();draw();say('规则已确认，创建新单据时生效。');}),'primary'));}catch(e){preview.replaceChildren(el('p',e.message));}}));
 }
 function newCase(){
  const t=template(),d=modal('用这份表发起业务');const title=el('input');title.value=t.title;const project=el('input');project.placeholder='例如：某公路项目 / 第 01 合同段';const submitter=el('input');submitter.value=t.submitterRole??'填报人';if(appId){project.value=workspace.projects.find(p=>p.id===projectId)?.name??'';project.readOnly=true;}
  const related=select([['','不关联'],...workspace.cases.filter(c=>!appId||c.appId===appId&&c.projectId===projectId).map(c=>[c.id,`${c.template.code} ${c.title}`])],'');
  d.append(label('业务名称',title),label('所属项目 / 合同段',project),label('填报角色',submitter),label('关联已有业务（如原指令单）',related),el('p','创建后保存模板快照。请先确认字段和流程；模板默认节点只是推演起点。'),button('创建并填写',wrap(async()=>{if(!title.value.trim()||!submitter.value.trim())throw Error('业务名称和填报角色不能为空');let r;if(appId){const app=workspace.applications.find(a=>a.id===appId);const source=workspace.cases.find(c=>c.id===related.value);const relation=app.relations.find(link=>link.from===source?.template.id&&link.to===t.id);const result=startProjectCase(workspace,{appId,projectId,templateId:t.id,sourceId:source?.id,relationId:relation?.id,role:submitter.value.trim()});r=result.record;if(!result.existing){r.title=title.value;await commit(w=>w.cases.unshift(r));}}else{r=createCase(t,{title:title.value,project:project.value,role:submitter.value.trim(),relatedId:related.value||null});await commit(w=>w.cases.unshift(r));}kind='cases';selected=r.id;role=r.submitter;d.close();draw();say('业务已创建。填写后保存草稿，或提交给下一位办理人。');}),'primary'));
 }
 function values(){const result={};for(const input of center.querySelectorAll('[data-field]'))if(!input.readOnly&&!input.disabled)result[input.dataset.field]=input.value;return result;}
 async function act(type,note){const r=selectedItem();const next=applyOperation(r,{type,role,values:values(),note});for(const f of r.template.fields.filter(f=>f.type==='reference'))if(next.values[f.id]&&!workspace.cases.some(c=>c.id===next.values[f.id]))throw Error('关联业务不存在');await commit(w=>{w.cases[w.cases.findIndex(c=>c.id===r.id)]=next;});draw();say(type==='save'?'表单草稿已保存。':(type==='return'||next.step<r.step)?'已退回配置的办理阶段；原审批意见和历史快照保留。':next.status==='complete'?'业务已归档，可打印或导出。':'同一份表单已交给下一位办理人。');}
 function renderInspector(){
  inspector.replaceChildren();const item=selectedItem(),t=template();if(!item){inspector.append(el('h3','一份表，贯穿全过程'),el('p','01 导入与核对\n02 确认填写区\n03 配置办理人\n04 填写与流转\n05 追溯与归档'),el('p','本地推演，角色切换不是登录认证。正式签署需要打印后手签或接入电子签章。','forms-boundary'));return;}
  inspector.append(el('span','THE SAME DOCUMENT','eyebrow'),el('h3',kind==='templates'?'先确认，再运行':'办理这份业务'));
  if(kind==='templates'){
   inspector.append(el('p','点击原表任意格子，设置名称、负责阶段和必填要求。空白格只是候选区，不能代替业务确认。'),button('配置办理流程',configureFlow),button('用自然语言调整规则',configureNaturalRule),button('用此表发起业务 →',newCase,'primary'));
  }else{
   const roles=[...new Set([item.submitter,...t.workflow.map(s=>s.role)])];if(!roles.includes(role))role=roles[0];const choose=select(roles.map(r=>[r,r]),role);choose.setAttribute('aria-label','表单扮演角色');choose.onchange=()=>{if(busy){choose.value=role;return;}if(!clean()){say('请先保存草稿或提交，再切换角色，避免丢失填写内容。',true);choose.value=role;return;}role=choose.value;renderCenter();renderInspector();};inspector.append(label('扮演角色（本地推演）',choose));
   const note=el('textarea');note.placeholder='办理意见；退回时必须说明原因';note.setAttribute('aria-label','表单办理意见');inspector.append(note);
   const expected=item.status==='draft'?item.submitter:t.workflow[item.step]?.role;const allowed=item.status!=='complete'&&expected===role;
   for(const [type,name] of [['save','保存填写'],[item.status==='draft'?'submit':'advance',item.status==='draft'?'提交办理 →':`${kinds[t.workflow[item.step]?.kind]??'完成'}并继续 →`]]){const b=button(name,wrap(()=>act(type,note.value)),type==='save'?'':'primary');b.disabled=!allowed;inspector.append(b);}
   if(item.status==='active'&&t.workflow[item.step].kind!=='receipt'){const b=button(t.workflow[item.step].returnTo&&t.workflow[item.step].returnTo!=='draft'?'退回上一业务阶段':'退回填报人',wrap(()=>act('return',note.value)));b.disabled=!allowed;inspector.append(b);}
   const attach=el('input');attach.type='file';attach.hidden=true;attach.setAttribute('aria-label','添加业务附件');attach.onchange=wrap(async()=>{const f=attach.files[0];if(!f)return;if(f.size>10*1024*1024)throw Error('单个附件不能超过 10 MB');const total=workspace.cases.reduce((s,c)=>s+c.attachments.reduce((v,a)=>v+a.size,0),0);if(total+f.size>60*1024*1024)throw Error('当前工作区附件已达 60 MB，请导出备份后另建工作包');const next=attachFile(item,{name:f.name,size:f.size,data:await readData(f)},role);await commit(w=>{w.cases[w.cases.findIndex(c=>c.id===item.id)]=next;});renderInspector();onContext(context());say('附件已保存，表内尚未保存的输入请点击“保存填写”。');});
   const ab=button('＋ 添加照片 / 签署件',()=>attach.click());ab.disabled=!allowed;inspector.append(ab,attach);
   for(const a of item.attachments)inspector.append(button(`↧ ${a.name}`,()=>{const bytes=Uint8Array.from(atob(a.data.split(',')[1]),c=>c.charCodeAt(0));download(a.name,bytes,'application/octet-stream');},'forms-attachment'));
   if(t.decisionRules?.length){inspector.append(el('h4','条件退回规则'));for(const rule of t.decisionRules){const field=t.fields.find(f=>f.id===rule.fieldId);inspector.append(el('p',`${field?.label}为“${rule.equals}”时，继续操作会退回${rule.returnTo==='draft'?'填报':t.workflow.find(s=>s.id===rule.returnTo)?.label}。`));}}
   if(item.provenance?.length){const sources=el('details');sources.append(el('summary','查看自动带入的来源'));for(const entry of item.provenance){const f=t.fields.find(f=>f.id===entry.fieldId);sources.append(el('p',`${f?.label??entry.fieldId} ← ${entry.source==='project'?'项目资料':'上游单据修订 '+entry.sourceRevision}\n带入时值 ${entry.value}`));}inspector.append(sources);}
   const related=[...workspace.cases.filter(c=>c.id===item.relatedId||c.relatedId===item.id)];if(related.length){inspector.append(el('h4','关联业务'));for(const c of related)inspector.append(button(c.title,()=>{if(busy||!clean())return;selected=c.id;draw();}));}
   inspector.append(button('下载打印版 HTML',()=>{if(busy||!clean())return;download(`${item.template.code||'业务表单'}-打印版.html`,printableForm(item),'text/html;charset=utf-8');say('打印版已下载。用普通浏览器打开，可从浏览器菜单打印或保存 PDF；请核对分页。');}));
  }
  const flow=el('ol',undefined,'forms-flow');[{id:'draft',label:'填写',role:kind==='cases'?item.submitter:(t.submitterRole??'填报人')},...t.workflow,{id:'archive',label:'归档',role:'保留历史'}].forEach((s,i)=>{const li=el('li');if(kind==='cases'&&(item.status==='complete'?i===t.workflow.length+1:i===item.step+1))li.className='current';li.append(el('strong',s.label),el('small',s.role));flow.append(li);});inspector.append(el('h4','这份表的办理路径'),flow);
  if(kind==='cases'){
   const last=item.events.at(-1);const journey=el('div',undefined,'forms-operation');journey.append(el('strong','刚才发生了什么'),el('p',last?`${last.role} → ${last.from} → ${last.to}\n本地业务记录已保存，修订 ${last.revision}。`:'填写内容后提交，才会保存业务状态并交给下一位。'));inspector.append(journey,el('h4',`办理记录 · ${item.events.length}`));
   for(const e of [...item.events].reverse()){const detail=el('details',undefined,'forms-event');detail.append(el('summary',`${e.role} · ${e.type==='attachment'?'添加附件':e.type==='save'?'保存填写':`${e.from} → ${e.to}`}`),el('p',new Date(e.at).toLocaleString('zh-CN')),el('p',e.note||'无附加意见'));for(const d of e.diff)detail.append(el('p',`${d.field}：${d.before||'空'} → ${d.after||'空'}`));detail.append(button('查看当时表单',()=>{const d=modal(`修订 ${e.revision} · ${e.role}`);const view=el('div',undefined,'forms-paper');const snapshot={...item,values:e.values,status:'complete'};renderBlocks(t.blocks,view,t,snapshot);d.append(view);}));inspector.append(detail);}
  }
  inspector.append(el('p','保留原文与办理记录。本地角色推演不等于真实账号权限，姓名文本不等于电子签章。','forms-boundary'));
 }
 upload.onchange=wrap(async()=>{
  if(!clean()){upload.value='';return;}
  const files=Array.from(upload.files);if(files.length>10)throw Error('一次最多导入 10 份 Word');const imported=[];const reports=[];
  for(const file of files){say(`正在读取 ${file.name}…`);await new Promise(r=>requestAnimationFrame(r));try{const bytes=new Uint8Array(await file.arrayBuffer());const xml=extractDocumentXML(bytes,unzipSync);const parsed=parseWordXML(xml,{name:file.name,sourceId:uid()});imported.push(...parsed.templates);reports.push(`${file.name}：${parsed.stats.templates} 份模板 / ${parsed.stats.tables} 个表格`);}catch(e){reports.push(`${file.name}：未导入，${e.message}`);}}
  await commit(w=>{w.templates.push(...imported);if(appId){const app=w.applications.find(a=>a.id===appId);app.templateIds.push(...imported.map(t=>t.id));}});kind='templates';selected=imported[0]?.id??selected;draw();say(reports.join('；')+'。请核对模板结构，确认填写区与流程。');upload.value='';
 });
 packInput.onchange=wrap(async()=>{if(!clean()){packInput.value='';return;}const file=packInput.files[0];if(!file)return;if(file.size>100*1024*1024)throw Error('工作包不能超过 100 MB');const raw=validateWorkspace(JSON.parse(await file.text()));const next=upgradeWorkspace(raw);const d=modal('恢复业务工作包');d.append(el('p',`将载入 ${next.templates.length} 份模板、${next.cases.length} 份业务。${raw.version<3?'旧版工作包将升级为 v3；原字段按文本保留，不猜测类型，历史值与快照不改变。':''}替换前会自动下载当前工作包作为备份。`),button('备份当前并恢复',wrap(async()=>{download('FlowLens-恢复前备份.json',JSON.stringify(workspace));await commit(w=>{const revision=w.storageRevision;Object.assign(w,next,{storageRevision:revision});});appId=workspace.applications[0]?.id??'';projectId=workspace.projects.find(p=>p.appId===appId)?.id??'';selected=null;view='forms';draw();d.close();say('工作包已恢复。');}),'primary'));packInput.value='';});
 try{workspace=await loadWorkspace();if(document.querySelector('meta[name="flowlens-demo"]')){if(!workspace.templates.length&&!workspace.cases.length){const {applicationDemo}=await import('./apps-demo.mjs');workspace=await saveWorkspace({...applicationDemo(),storageRevision:workspace.storageRevision??0});}kind='cases';selected=workspace.cases[0]?.id??null;role=workspace.cases[0]?.submitter??'填报人';}appId=workspace.applications[0]?.id??'';projectId=workspace.projects.find(p=>p.appId===appId)?.id??'';if(appId)selected=null;ready=true;say('业务工作区已就绪。数据保存在当前浏览器，可导出工作包备份；Word 导入不调用模型。');}catch(e){say('本地存档读取失败，未覆盖原存档：'+e.message,true);importBtn.disabled=true;}
 draw();
 return {context,canLeave:()=>!busy&&clean(),showView:next=>{if(!clean())return false;view=next;renderView();return true;}};
}
