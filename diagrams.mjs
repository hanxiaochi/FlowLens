export function entityGraph(model){
 const nodes=model.entities.map(e=>({id:e.id,label:e.label,fields:[{id:'id',label:'主键',type:'integer',primary:true},...e.fields]}));
 const edges=model.entities.flatMap(e=>e.fields.filter(f=>f.type==='reference').map(f=>({id:e.id+'.'+f.id,source:e.id,target:f.target,field:f.id,label:f.label,sourceCardinality:'多',targetCardinality:f.required?'1':'0..1',required:!!f.required})));
 return {nodes,edges};
}
export function workflowOptions(model){return model.entities.flatMap(e=>e.fields.filter(f=>model.actions.some(a=>a.entity===e.id&&a.kind==='transition'&&a.stateField===f.id)).map(f=>({entity:e.id,field:f.id,label:e.label+' · '+f.label})));}
export function workflowGraph(model,entityId,fieldId){
 const entity=model.entities.find(e=>e.id===entityId),field=entity?.fields.find(f=>f.id===fieldId);if(!field)return {nodes:[],edges:[]};
 const nodes=field.options.map(value=>({id:'state:'+value,label:value,kind:'state'})),edges=[];
 for(const a of model.actions.filter(a=>a.entity===entityId)){
  if(a.kind==='create'&&a.defaults?.[fieldId]!==undefined){const id='action:'+a.id;nodes.push({id,label:a.label,kind:'create',actionId:a.id,roles:a.roles});edges.push({id:a.id+':initial',source:id,target:'state:'+a.defaults[fieldId],label:'创建后',actionId:a.id});}
  if(a.kind!=='transition'||a.stateField!==fieldId)continue;
  const id='action:'+a.id,branch=a.branch;const fieldLabel=branch?entity.fields.find(f=>f.id===branch.field).label:'';const comparison=branch?({gt:'大于',gte:'大于等于',eq:'等于'}[branch.op]):'';
  nodes.push({id,label:a.label,kind:branch?'decision':'action',actionId:a.id,roles:a.roles,condition:branch?`${fieldLabel}${comparison} ${branch.value}`:undefined});
  for(const from of a.from)edges.push({id:a.id+':from:'+from,source:'state:'+from,target:id,label:a.roles.join(' / ')||'无人有权限',actionId:a.id});
  if(branch){edges.push({id:a.id+':yes',source:id,target:'state:'+branch.then,label:'是',branch:'yes',actionId:a.id},{id:a.id+':no',source:id,target:'state:'+a.to,label:'否',branch:'no',actionId:a.id});}
  else edges.push({id:a.id+':to',source:id,target:'state:'+a.to,label:'处理后',actionId:a.id});
 }
 return {nodes,edges};
}
// Collapse strongly-connected components first, so loops remain valid without an infinite layout pass.
export function layeredLayout(graph){
 const ids=new Set(graph.nodes.map(n=>n.id)),adj=new Map([...ids].map(id=>[id,[]]));for(const e of graph.edges)if(ids.has(e.source)&&ids.has(e.target))adj.get(e.source).push(e.target);
 const indexes=new Map(),low=new Map(),stack=[],onStack=new Set(),components=[];let index=0;
 function visit(v){indexes.set(v,index);low.set(v,index++);stack.push(v);onStack.add(v);for(const w of adj.get(v)){if(!indexes.has(w)){visit(w);low.set(v,Math.min(low.get(v),low.get(w)));}else if(onStack.has(w))low.set(v,Math.min(low.get(v),indexes.get(w)));}if(low.get(v)===indexes.get(v)){const group=[];let w;do{w=stack.pop();onStack.delete(w);group.push(w);}while(w!==v);components.push(group);}}
 for(const id of ids)if(!indexes.has(id))visit(id);
 const owner=new Map();components.forEach((c,i)=>c.forEach(id=>owner.set(id,i)));const rank=new Array(components.length).fill(0),incoming=new Array(components.length).fill(0),links=new Map(components.map((_,i)=>[i,new Set()]));for(const e of graph.edges){const a=owner.get(e.source),b=owner.get(e.target);if(a!==undefined&&b!==undefined&&a!==b&&!links.get(a).has(b)){links.get(a).add(b);incoming[b]++;}}
 const queue=incoming.flatMap((n,i)=>n===0?[i]:[]);while(queue.length){const a=queue.shift();for(const b of links.get(a)){rank[b]=Math.max(rank[b],rank[a]+1);if(--incoming[b]===0)queue.push(b);}}
 const lanes=new Map();for(const n of graph.nodes){const r=rank[owner.get(n.id)];if(!lanes.has(r))lanes.set(r,[]);lanes.get(r).push(n);}
 const points=new Map();for(const [r,nodes]of lanes)nodes.forEach((n,i)=>points.set(n.id,{x:35+r*235,y:55+i*125,width:180,height:80}));
 return {points,width:Math.max(500,80+(Math.max(0,...rank)+1)*235),height:Math.max(240,110+Math.max(0,...[...lanes.values()].map(n=>n.length))*125)};
}
