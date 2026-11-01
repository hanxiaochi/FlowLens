import {describeAction} from './model.mjs';
import {entityGraph,workflowGraph,workflowOptions,layeredLayout} from './diagrams.mjs';
const NS='http://www.w3.org/2000/svg';
const svg=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function wrapSvg(width,height,label){const root=svg('svg',{viewBox:`0 0 ${width} ${height}`,width,height,role:'group','aria-label':label});return root;}
function clickable(group,label,onClick){group.setAttribute('tabindex','0');group.setAttribute('role','button');group.setAttribute('aria-label',label);group.style.cursor='pointer';group.onclick=onClick;group.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();onClick();}};}
function wrapText(parent,text,x,y,max=15,color='#6e587f'){const value=String(text);for(let i=0;i<Math.min(3,Math.ceil(value.length/max));i++)parent.append(svg('text',{x,y:y+i*17,fill:color,'font-size':12},value.slice(i*max,(i+1)*max)+(i===2&&value.length>max*3?'…':'')));}
function saveSvg(root,name){const blob=new Blob([new XMLSerializer().serializeToString(root)],{type:'image/svg+xml;charset=utf-8'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function controls(card,root,name){
 const bar=el('div',undefined,'diagram-controls'),minus=el('button','−'),plus=el('button','＋'),zoom=el('span','100%'),fit=el('button','一屏总览'),actual=el('button','原始大小'),download=el('button','导出 SVG ↗');let scale=1;
 minus.setAttribute('aria-label','缩小图表');plus.setAttribute('aria-label','放大图表');
 const update=()=>{root.style.width=Number(root.getAttribute('width'))*scale+'px';root.style.height=Number(root.getAttribute('height'))*scale+'px';zoom.textContent=Math.round(scale*100)+'%';};
 const fitView=()=>{const width=root.parentElement?.clientWidth;if(width>0){scale=Math.min(1,(width-24)/Number(root.getAttribute('width')));update();}};
 minus.onclick=()=>{scale=Math.max(.2,scale-.15);update();};plus.onclick=()=>{scale=Math.min(2,scale+.15);update();};fit.onclick=fitView;actual.onclick=()=>{scale=1;update();};download.onclick=()=>saveSvg(root,name);
 bar.append(minus,zoom,plus,fit,actual,download);card.append(bar);
 const observer=new ResizeObserver(entries=>{if(entries.some(e=>e.contentRect.width>0)){fitView();observer.disconnect();}});observer.observe(card);
}
export function renderER(host,model){
 host.replaceChildren();host.append(el('h3','数据之间，怎样联系？'),el('p','沿连线查看字段引用。多个申请可以属于同一位员工；这与页面上看起来有几张表无关。'));
 const graph=entityGraph(model),columns=graph.nodes.length<=2?2:3,positions=new Map();let y=40;for(let i=0;i<graph.nodes.length;i+=columns){const row=graph.nodes.slice(i,i+columns);row.forEach((n,j)=>positions.set(n.id,{x:35+j*350,y,w:260,h:66+n.fields.length*29}));y+=Math.max(...row.map(n=>66+n.fields.length*29))+100;}
 const root=wrapSvg(columns*350+30,Math.max(260,y),'数据实体关系图'),details=el('div','点击一条关系或一个字段，查看它的意义。','diagram-detail');
 const layer=svg('g');root.append(layer);
 for(const edge of graph.edges){const from=positions.get(edge.source),to=positions.get(edge.target),source=graph.nodes.find(n=>n.id===edge.source),index=source.fields.findIndex(f=>f.id===edge.field);const sy=from.y+67+index*29,ty=to.y+67;let x1=from.x+from.w,x2=to.x,path;
  if(from.x<to.x)path=`M${x1} ${sy} C${x1+45} ${sy} ${x2-45} ${ty} ${x2} ${ty}`;
  else if(from.x>to.x){x1=from.x;x2=to.x+to.w;path=`M${x1} ${sy} C${x1-45} ${sy} ${x2+45} ${ty} ${x2} ${ty}`;}
  else{const side=from.x+from.w+40;path=`M${x1} ${sy} C${side} ${sy} ${side} ${ty} ${to.x+to.w} ${ty}`;x2=to.x+to.w;}
  const g=svg('g'),line=svg('path',{d:path,stroke:'#9271ae','stroke-width':2,fill:'none'});g.append(svg('path',{d:path,stroke:'transparent','stroke-width':16,fill:'none'}),line,svg('text',{x:x1+(from.x>to.x?-16:6),y:sy-9,fill:'#89609f','font-size':11},'多'),svg('text',{x:x2+(from.x>to.x?8:-32),y:ty-9,fill:'#89609f','font-size':11},edge.targetCardinality));clickable(g,`${edge.source}.${edge.field} 关联 ${edge.target}`,()=>{details.textContent=`${model.entities.find(e=>e.id===edge.source).label}的“${edge.label}”引用${model.entities.find(e=>e.id===edge.target).label}主键。${edge.required?'每条记录必须关联一个对象。':'可以不关联；有关联时指向一个对象。'}多个来源记录可以指向同一个对象。删除被引用的对象会被模拟器阻止。`;});layer.append(g);
 }
 for(const node of graph.nodes){const p=positions.get(node.id),g=svg('g');g.append(svg('rect',{x:p.x,y:p.y,width:p.w,height:p.h,rx:16,fill:'#fdfbff',stroke:'#d9cae5'}),svg('rect',{x:p.x+1,y:p.y+1,width:p.w-2,height:42,rx:15,fill:'#eee5f5'}),svg('text',{x:p.x+16,y:p.y+27,fill:'#705185','font-size':14},node.label+' · '+node.id));node.fields.forEach((f,i)=>{const row=svg('g'),fy=p.y+67+i*29;row.append(svg('text',{x:p.x+15,y:fy,fill:'#7e698e','font-size':11},(f.primary?'◆ ':f.type==='reference'?'↗ ':'')+f.label),svg('text',{x:p.x+p.w-15,y:fy,fill:'#a590b3','font-size':10,'text-anchor':'end'},f.primary?'PK':f.type+(f.unique?' · UNIQUE':'')));clickable(row,node.label+'字段'+f.label,()=>{details.textContent=`${node.label}.${f.id}：${f.label}，${f.type}${f.required?'，必填':''}${f.unique?'，不可重复':''}${f.target?'，关联 '+model.entities.find(e=>e.id===f.target).label:''}。`;});g.append(row);});root.append(g);}
 const scroll=el('div',undefined,'diagram-scroll');scroll.append(root);controls(host,root,'FlowLens-数据关系.svg');host.append(scroll,details);if(graph.edges.length){const links=el('div',undefined,'diagram-controls');for(const edge of graph.edges){const source=model.entities.find(e=>e.id===edge.source),target=model.entities.find(e=>e.id===edge.target),button=el('button',source.label+' · '+edge.label+' → '+target.label);button.onclick=()=>{details.textContent=`${source.label}的“${edge.label}”引用${target.label}主键。${edge.required?'每条记录必须关联一个对象。':'关联可为空。'}多个来源记录可以指向同一个对象；删除被引用的对象会被模拟器阻止。`;};links.append(button);}host.append(links);}if(!graph.edges.length)host.append(el('p','当前实体之间尚未定义关联字段。','caption'));
}
export function renderWorkflow(host,model,onEdit,selected=null){
 host.replaceChildren();host.append(el('h3','业务状态如何一步步变化？'),el('p','状态、操作和条件分支来自同一份执行模型。点击操作节点可查看权限并修改分支阈值。'));
 const options=workflowOptions(model);if(!options.length){host.append(el('p','当前模型还没有状态转换操作。可通过自然语言提出审批或处理流程，生成后会在这里展示。'));return;}
 const select=el('select');select.setAttribute('aria-label','选择业务状态流程');for(const o of options)select.append(new Option(o.label,o.entity+'.'+o.field));if(selected&&options.some(o=>o.entity+'.'+o.field===selected))select.value=selected;select.onchange=()=>{renderWorkflow(host,model,onEdit,select.value);host.dispatchEvent(new Event('flow-view-change'));};host.append(select);
 const [entity,field]=select.value.split('.'),graph=workflowGraph(model,entity,field),layout=layeredLayout(graph),root=wrapSvg(layout.width,layout.height,'业务状态与条件分支图');const defs=svg('defs'),marker=svg('marker',{id:'flowArrow',markerWidth:8,markerHeight:8,refX:6,refY:3,orient:'auto'});marker.append(svg('path',{d:'M0,0 L6,3 L0,6',fill:'#aa8cbc'}));defs.append(marker);root.append(defs);
 root.dataset.entity=entity;root.dataset.field=field;const trace=el('p','尚未执行；这里显示的是所有可能的路径。','workflow-trace');trace.setAttribute('role','status');host.append(trace);
 const details=el('div','选择任意操作节点，查看它负责的事情。','diagram-detail');
 function describe(actionId){const a=model.actions.find(a=>a.id===actionId);details.replaceChildren(el('h3',a.label),el('p',describeAction(model,a)),el('p','允许角色：'+(a.roles.join('、')||'无')));if(a.kind==='transition')details.append(el('p',a.from.join(' / ')+' → '+a.to));if(a.branch){const entityModel=model.entities.find(e=>e.id===a.entity),fieldModel=entityModel.fields.find(f=>f.id===a.branch.field);details.append(el('p',`条件满足 → ${a.branch.then}；否则 → ${a.to}`));const label=el('label',fieldModel.label+'阈值'),input=el('input');input.type='number';input.step='any';input.value=a.branch.value;input.setAttribute('aria-label','流程条件阈值');label.append(input);const button=el('button','更新条件与模拟规则');button.onclick=()=>{if(input.value===''||!Number.isFinite(Number(input.value)))return;onEdit(a.id,Number(input.value),select.value);};details.append(label,button);}}
 for(const edge of graph.edges){const s=layout.points.get(edge.source),t=layout.points.get(edge.target);const x1=s.x+s.width,y1=s.y+s.height/2,x2=t.x,y2=t.y+t.height/2;let path;if(x2>x1)path=`M${x1} ${y1} C${x1+28} ${y1} ${x2-28} ${y2} ${x2} ${y2}`;else {const sx=s.x+s.width/2,tx=t.x+t.width/2,yy=Math.max(s.y+s.height,t.y+t.height)+25;path=`M${sx} ${s.y+s.height} C${sx} ${yy} ${tx} ${yy} ${tx} ${t.y+t.height}`;}const g=svg('g',{'data-flow-edge':edge.id,'data-flow-action':edge.actionId});g.append(svg('path',{d:path,fill:'none',stroke:'transparent','stroke-width':15}),svg('path',{d:path,fill:'none',stroke:edge.branch==='yes'?'#7f9b63':'#baa4cb','stroke-width':1.7,'marker-end':'url(#flowArrow)'}));const text=edge.label.length>12?edge.label.slice(0,11)+'…':edge.label;g.append(svg('text',{x:(x1+x2)/2,y:(y1+y2)/2-7,'text-anchor':'middle',fill:'#92739f','font-size':9},text));clickable(g,edge.label,()=>describe(edge.actionId));root.append(g);}
 for(const n of graph.nodes){const p=layout.points.get(n.id),g=svg('g',{'data-flow-node':n.id});if(n.kind==='decision')g.append(svg('path',{d:`M${p.x+90} ${p.y-12} L${p.x+190} ${p.y+40} L${p.x+90} ${p.y+92} L${p.x-10} ${p.y+40} Z`,fill:'#f6e7ce',stroke:'#dbc39c'}));else g.append(svg('rect',{x:p.x,y:p.y,width:p.width,height:p.height,rx:n.kind==='state'?28:12,fill:n.kind==='state'?'#edf3e4':n.kind==='create'?'#e7e2f4':'#f6f0fb',stroke:'#d6c8e2'}));wrapText(g,n.label,p.x+17,p.y+29,12);if(n.condition)wrapText(g,n.condition,p.x+17,p.y+55,14,'#aa8354');if(n.actionId)clickable(g,n.label,()=>describe(n.actionId));else clickable(g,n.label,()=>{details.textContent=`“${n.label}”是${model.entities.find(e=>e.id===entity).label}的一个状态。只有满足来源状态和权限的操作才能改变它。`;});root.append(g);}
 const scroll=el('div',undefined,'diagram-scroll');scroll.append(root);controls(host,root,'FlowLens-业务流程.svg');host.append(scroll,details);
}

export function updateWorkflowTrace(host,model,run,entry){
 host.querySelectorAll('.flow-current,.flow-result,.flow-failed').forEach(n=>n.classList.remove('flow-current','flow-result','flow-failed'));
 const banner=host.querySelector('.workflow-trace'),root=host.querySelector('svg');if(!banner||!root)return;
 const action=model.actions.find(a=>a.id===run?.action);
 if(!action||!entry||action.entity!==root.dataset.entity||action.stateField!==root.dataset.field){banner.textContent='尚未执行这个状态流程；这里显示的是所有可能的路径。';return;}
 const log=run.log.filter(e=>e.index<=entry.index),decision=log.find(e=>e.decision)?.decision,committed=log.some(e=>e.write),failed=!!entry.error;
 for(const n of host.querySelectorAll('[data-flow-node]')){
  if(n.dataset.flowNode==='action:'+action.id)n.classList.add(failed?'flow-failed':'flow-current');
  if(decision&&n.dataset.flowNode==='state:'+decision.target)n.classList.add(committed?'flow-result':'flow-current');
 }
 for(const edge of host.querySelectorAll('[data-flow-edge]')){
  if(edge.dataset.flowAction!==action.id||!decision)continue;
  const id=edge.dataset.flowEdge,chosen=id===action.id+':from:'+decision.from||id===action.id+':to'||id===action.id+':'+(decision.matched?'yes':'no');
  if(chosen)edge.classList.add(committed?'flow-result':'flow-current');
 }
 banner.textContent=action.label+' · '+(failed?'执行中止：'+entry.error:decision?(committed?'已写入：':'已决定，尚未写入：')+decision.from+' → '+decision.target:entry.title+'；尚未决定目标状态。');
}
