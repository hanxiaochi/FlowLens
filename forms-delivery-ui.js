import {formSystem,formOpenApi,formSql,formBrief,acceptanceCases} from './forms-system.mjs';
import {zipSync,strToU8} from './forms-vendor/fflate.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function renderDelivery(host,template,record,{view='design',download,runtimeFiles=[]}={}){
 host.replaceChildren();const d=formSystem(template,record);host.append(el('span','ONE BUSINESS, EVERY VIEW','eyebrow'),el('h2',d.title),el('p',`当前业务定义 ${d.id} · 模板版本 ${d.version}。下面所有字段、路径与交付文件均来自这份表。`));
 const boundary=el('p',d.limits.join(' '),'forms-operation');host.append(boundary);
 if(view==='experience'){
  host.append(el('h3','这次操作实际发生了什么'));
  const event=record?.events.at(-1);host.append(el('p',event?`${event.role}：${event.from} → ${event.to}，记录修订 ${event.revision}。`:'先回到业务表单，填写并提交一份记录。'));
  const steps=el('ol');for(const s of ['浏览器收集当前阶段的输入','本地规则检查角色、字段类型、必填与状态','IndexedDB 事务检查工作区版本','业务记录与事件快照一起保存','事务成功后展示新的办理状态'])steps.append(el('li',s));host.append(steps,el('p','没有向真实服务器发送业务请求。接口草案用于下一步实现，3D 部署用于解释未来架构。'));
  if(event){const pre=el('pre',JSON.stringify({recordId:record.id,operationId:event.operationId??'旧记录未保存操作ID',revision:event.revision,changes:event.diff,typedValues:d.current.values},null,2),'forms-contract-code');host.append(pre);}return;
 }
 host.append(el('h3','同一份记录的办理路径'));const path=el('div',undefined,'forms-system-path');for(const n of d.nodes){const node=el('div',undefined,'forms-system-node');node.append(el('strong',n.label),el('small',n.role));path.append(node);}host.append(path);
 const returns=d.edges.filter(e=>e.action==='return');host.append(el('p','退回路径：'+returns.map(e=>`${d.nodes.find(n=>n.id===e.from)?.label} → ${d.nodes.find(n=>n.id===e.to)?.label}`).join('；')));
 host.append(el('h3','字段 → 数据列 → 规则依据'));const table=el('table',undefined,'forms-schema-table');const head=el('tr');for(const s of ['原表字段 / ID','数据类型','办理阶段','SQL 列','确认与依据'])head.append(el('th',s));table.append(head);
 for(const f of d.fields){const row=el('tr');for(const s of [`${f.label}\n${f.id}`,`${f.type}${f.unit?' / '+f.unit:''}${f.required?' · 阶段必填':''}`,d.nodes.find(n=>n.id===f.owner)?.label??f.owner,d.columns[f.id],`${f.confirmation==='confirmed'?'已人工确认':'待确认'}\n${f.evidence}`])row.append(el('td',s));table.append(row);}const scroll=el('div',undefined,'forms-paper');scroll.append(table);host.append(scroll);
 host.append(el('h3','数据关系'),el('p',`项目标识 → business_records（${d.current?.id??'业务编号'}） → ${d.table}（本表字段）\nbusiness_records → business_events（事件快照）\n关联业务通过 related_id 引用原单；不会自动批准或改变另一份记录。`));
 if(view==='handoff'){
  const counts=d.fields.filter(f=>f.confirmation!=='confirmed').length;host.append(el('h3',`交付检查 · ${counts} 个字段待确认`),el('p','包含当前定义、接口草案、SQL、验收案例和可运行的本地规则验证器。不会把另一套员工示例放进交付包。原件版式保留在 definition.json；运行器不提供 Web 服务。'));
  const files={'definition.json':JSON.stringify({template,record},null,2),'system.json':JSON.stringify(d,null,2),'openapi.json':JSON.stringify(formOpenApi(template,record),null,2),'schema.sql':formSql(template),'acceptance.json':JSON.stringify(acceptanceCases(template),null,2),'README.md':formBrief(template,record)+'\n## 本地验证器\n需要 Node.js 22+。在本目录运行 `node verify.mjs`。验证模板必填、角色、退回和幂等规则；数据库权限与部署需另行实现。\n'};
  const actions=el('div',undefined,'forms-toolbar');for(const [name,data] of Object.entries(files)){const b=el('button','下载 '+name);b.onclick=()=>download(name,data,name.endsWith('.json')?'application/json':'text/plain;charset=utf-8');actions.append(b);}
  const zip=el('button','下载完整交付包 ZIP','primary');zip.onclick=async()=>{zip.disabled=true;try{const bundle=Object.fromEntries(Object.entries(files).map(([name,data])=>[name,strToU8(data)]));for(const file of runtimeFiles){const res=await fetch(new URL(file,import.meta.url));if(!res.ok)throw Error('运行器文件读取失败');bundle[file==='forms-verify.mjs'?'verify.mjs':file]=strToU8(await res.text());}download('FlowLens-业务交付.zip',zipSync(bundle),'application/zip');}catch(e){host.append(el('p',e.message));}finally{zip.disabled=false;}};actions.prepend(zip);host.append(actions);
 }
 const details=el('details');details.append(el('summary','查看当前业务接口草案'),el('pre',JSON.stringify(formOpenApi(template,record),null,2),'forms-contract-code'));host.append(details);
}
