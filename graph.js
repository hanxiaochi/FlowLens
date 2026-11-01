const NS='http://www.w3.org/2000/svg';
function svgEl(tag,attrs={},text){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;return n;}
export function renderSystemGraph(model,container,onPick){
 const height=Math.max(260,model.pages.length*105+90,model.entities.length*105+90),svg=svgEl('svg',{viewBox:`0 0 1000 ${height}`,role:'img','aria-label':'页面到业务模块、接口与数据实体的关联图'});const defs=svgEl('defs'),marker=svgEl('marker',{id:'graphArrow',markerWidth:8,markerHeight:8,refX:6,refY:3,orient:'auto'});marker.append(svgEl('path',{d:'M0,0 L6,3 L0,6',fill:'#b69fc9'}));defs.append(marker);svg.append(defs);
 for(const [x,t] of [[50,'用户看到的页面'],[390,'处理请求的业务模块'],[730,'保存信息的数据实体']])svg.append(svgEl('text',{x,y:28,fill:'#8e789f','font-size':12},t));
 const rows=new Map(model.entities.map((e,i)=>[e.id,65+i*105]));
 const link=(x1,y1,x2,y2,label)=>{svg.append(svgEl('path',{d:`M${x1},${y1} C${x1+55},${y1} ${x2-55},${y2} ${x2},${y2}`,fill:'none',stroke:'#c2b0d0','stroke-width':1.8,'marker-end':'url(#graphArrow)'}));if(label)svg.append(svgEl('text',{x:(x1+x2)/2,y:(y1+y2)/2-9,'text-anchor':'middle',fill:'#9a81aa','font-size':9},label));};
 model.pages.forEach((p,i)=>link(280,100+i*105,390,rows.get(p.entity)+35,'请求 / 响应'));
 model.entities.forEach(e=>link(620,rows.get(e.id)+35,730,rows.get(e.id)+35,'读写'));
 function node(x,y,title,subtitle,kind,id){const g=svgEl('g',{tabindex:0,role:'button','aria-label':title,style:'cursor:pointer'});g.append(svgEl('rect',{x,y,width:230,height:70,rx:15,fill:kind==='entity'?'#edf2e5':kind==='module'?'#eee6f6':'#f9f6fc',stroke:kind==='entity'?'#d6dfc8':'#ded2e9'}));g.append(svgEl('text',{x:x+17,y:y+29,fill:'#655073','font-size':14},title.length>17?title.slice(0,16)+'…':title));g.append(svgEl('text',{x:x+17,y:y+51,fill:'#9a87a8','font-size':10},subtitle.length>31?subtitle.slice(0,30)+'…':subtitle));g.onclick=()=>onPick(kind,id);g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPick(kind,id);}};svg.append(g);}
 model.pages.forEach((p,i)=>node(50,65+i*105,p.label,p.actions.length+' 个操作 · '+p.layout,'page',p.id));
 model.entities.forEach(e=>{const actions=model.actions.filter(a=>a.entity===e.id);node(390,rows.get(e.id),e.label+'服务',actions.length+' 个接口 · 权限与业务规则','module',e.id);node(730,rows.get(e.id),e.label,e.id+' · '+e.fields.length+' 个字段','entity',e.id);});
 container.replaceChildren(svg);
}
