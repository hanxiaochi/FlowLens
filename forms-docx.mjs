// Read-only OOXML extraction. Rendering uses text nodes, never imported HTML.
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=(n,name)=>Array.from(n.childNodes??[]).filter(x=>x.nodeType===1&&(!name||x.localName===name));
const all=(n,name)=>Array.from(n.getElementsByTagNameNS(W,name));
const first=(n,name)=>all(n,name)[0];
const attr=(n,name)=>n?.getAttributeNS(W,name)||'';
const text=n=>{let value='';function walk(node){for(const c of children(node)){if(c.namespaceURI===W&&c.localName==='t')value+=c.textContent;else if(c.namespaceURI===W&&c.localName==='tab')value+='\t';else if(c.namespaceURI===W&&['br','cr'].includes(c.localName))value+='\n';else if(c.namespaceURI===W&&c.localName==='sym')value+='□';else walk(c);}}walk(n);return value;};
const codePattern=/浙公路\s*[（(]\s*(GL|JLCJ|JLPZ|YBYS)\s*[）)]\s*(\d+(?:-\d+)?)/;

export function extractDocumentXML(bytes,unzipSync){
 if(bytes.length>25*1024*1024)throw Error('单个 Word 文件不能超过 25 MB');
 const files=unzipSync(bytes,{filter:f=>{
  if(f.name!=='word/document.xml')return false;
  if(f.originalSize>96*1024*1024)throw Error('Word 正文展开后超过 96 MB');
  return true;
 }});
 if(!files['word/document.xml'])throw Error('不是有效 DOCX：缺少 Word 正文。旧版 .doc 请先另存为 .docx。');
 return new TextDecoder().decode(files['word/document.xml']);
}

export function parseWordXML(xml,{name='导入文档.docx',Parser=globalThis.DOMParser,sourceId='source'}={}){
 if(xml.length>96*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('不支持该 XML 文档');
 const doc=new Parser().parseFromString(xml,'application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw Error('Word 正文 XML 损坏');
 const body=first(doc,'body');if(!body)throw Error('Word 正文不存在');
 let serial=0;const warnings=[];const id=()=>`c${++serial}`;
 if(all(body,'drawing').length||all(body,'pict').length)warnings.push('原文含图片或绘图，本版仅导入文字与表格结构；原图请对照 Word 并作为附件补充。');
 if(all(body,'txbxContent').length)warnings.push('含文本框：位置无法精确还原，请对照原件。');
 if(all(body,'ins').length||all(body,'del').length)warnings.push('含修订记录，请先在 Word 确认最终文本。');
 if(all(body,'sym').length)warnings.push('原文含特殊字体符号，已用 □ 占位，请对照原件确认勾选项。');
 function paragraph(n){return {type:'paragraph',id:id(),text:text(n),align:attr(first(n,'jc'),'val'),bold:!!first(n,'b')};}
 function table(n,depth=0){
  if(depth>8)throw Error('表格嵌套层数过多');
  const grid=children(children(n,'tblGrid')[0]??{},'gridCol').map(c=>Number(attr(c,'w'))||100);
  let active=new Map();const rows=[];
  for(const row of children(n,'tr')){
   let col=Number(attr(first(children(row,'trPr')[0]??row,'gridBefore'),'val'))||0;const cells=[];const next=new Map();
   if(col)cells.push({id:id(),text:'',blocks:[],colspan:col,rowspan:1,spacer:true});
   for(const cell of children(row,'tc')){
    const props=children(cell,'tcPr')[0];const colspan=Math.max(1,Math.min(100,Number(attr(props&&first(props,'gridSpan'),'val'))||1));
    const vm=props&&first(props,'vMerge');const merge=vm?(attr(vm,'val')||'continue'):'';
    const prior=active.get(col);
    if(merge==='continue'&&prior&&prior.colspan===colspan){prior.rowspan++;next.set(col,prior);col+=colspan;continue;}
    const blocks=children(cell).filter(x=>['p','tbl'].includes(x.localName)).map(x=>x.localName==='tbl'?table(x,depth+1):paragraph(x));
    const c={id:id(),text:blocks.map(b=>b.type==='paragraph'?b.text:'').join('\n'),blocks,colspan,rowspan:1};
    cells.push(c);if(merge)next.set(col,c);col+=colspan;
   }
   rows.push(cells);active=next;
  }
  return {type:'table',id:id(),grid,rows};
 }
 const blocks=children(body).filter(n=>['p','tbl'].includes(n.localName)).map(n=>n.localName==='tbl'?table(n):paragraph(n));
 const groups=[];let current={code:'',blocks:[]};
 for(const block of blocks){
  const m=block.type==='paragraph'&&block.text.match(codePattern);
  if(m){if(current.blocks.some(b=>b.type==='table'||b.text.trim()))groups.push(current);current={code:`${m[1]}-${m[2]}`,blocks:[]};}
  current.blocks.push(block);
 }
 if(current.blocks.some(b=>b.type==='table'||b.text.trim()))groups.push(current);
 const templates=groups.map((g,i)=>{
  const candidates=g.blocks.filter(b=>b.type==='paragraph').map(b=>b.text.trim()).filter(t=>t&&!codePattern.test(t)&&!/^工程项目$/.test(t)&&!/[：:]/.test(t));
  const title=candidates.find(t=>!/项目$/.test(t))||g.code||name.replace(/\.docx$/i,'');
  return {id:`${sourceId}-${i}`,version:1,code:g.code,title,source:name,blocks:g.blocks,fields:[],warnings:[...warnings],workflow:defaultWorkflow()};
 });
 for(const t of templates){
  function infer(bs){for(const b of bs){if(b.type!=='table')continue;for(const row of b.rows){let previous='';for(const c of row){
   if(!c.spacer&&!c.text.trim()&&!c.blocks.some(b=>b.type==='table'))t.fields.push({id:c.id,label:previous&&previous.length<25?`${previous.replace(/\s+/g,'')} · ${t.fields.length+1}`:`填写区 ${t.fields.length+1}`,owner:'draft',required:false});
   if(c.text.trim())previous=c.text.trim();infer(c.blocks);
  }}}}infer(t.blocks);
 }
 const cells=templates.reduce((n,t)=>n+formCells(t.blocks).length,0);
 return {templates,warnings,stats:{templates:templates.length,cells,tables:all(body,'tbl').length}};
}

export function formCells(blocks){const cells=[];for(const b of blocks){if(b.type==='paragraph')continue;for(const row of b.rows)for(const c of row){cells.push(c);cells.push(...formCells(c.blocks));}}return cells;}
export function defaultWorkflow(){return [{id:'review',label:'审核',role:'审核人',kind:'review'},{id:'receipt',label:'签收',role:'接收人',kind:'receipt'}];}
