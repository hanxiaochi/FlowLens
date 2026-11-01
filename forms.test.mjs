import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {zipSync,strToU8,unzipSync} from 'fflate';
import {parseWordXML,extractDocumentXML,formCells,defaultWorkflow} from './forms-docx.mjs';
import {createCase,applyOperation,attachFile} from './forms-model.mjs';
import {emptyWorkspace,validateWorkspace} from './forms-store.mjs';
import {printableForm} from './forms-print.mjs';
const xml=`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>浙公路（GL）040</w:t></w:r></w:p><w:p><w:r><w:t>监理指令单</w:t></w:r></w:p>
<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>
<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>意见</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>浙公路（GL）041</w:t></w:r></w:p><w:p><w:r><w:t>回复单</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>
</w:body></w:document>`;
const parse=()=>parseWordXML(xml,{Parser:DOMParser,name:'fixture.docx'}).templates;
test('DOCX extraction splits template codes and preserves horizontal and vertical merges',()=>{
 const zipped=zipSync({'word/document.xml':strToU8(xml),'word/media/ignored.png':new Uint8Array(8)});
 const t=parseWordXML(extractDocumentXML(zipped,unzipSync),{Parser:DOMParser}).templates;
 assert.equal(t.length,2);assert.equal(t[0].code,'GL-040');assert.equal(t[1].title,'回复单');const b=t[0].blocks.find(b=>b.type==='table');
 assert.equal(b.rows[0][0].rowspan,2);assert.equal(b.rows[0][1].colspan,2);assert.equal(b.rows[1].length,2);assert.equal(t[0].fields.length,2);
 assert.equal(formCells(t[0].blocks).length,4);
});
test('rejects non-DOCX, oversized XML and entity declarations',()=>{
 assert.throws(()=>extractDocumentXML(zipSync({'fake.xml':strToU8(xml)}),unzipSync),/缺少/);
 assert.throws(()=>parseWordXML('<!DOCTYPE x>'+xml,{Parser:DOMParser}),/不支持/);
 assert.throws(()=>extractDocumentXML(new Uint8Array(26*1024*1024),unzipSync),/25 MB/);
});
test('same form survives mandatory validation, return, correction, review, receipt and archive',()=>{
 const t=parse()[0];const field=t.fields[0];field.label='项目名称';field.required=true;
 let r=createCase(t);assert.throws(()=>applyOperation(r,{type:'submit',role:'填报人'}),/项目名称/);
 assert.throws(()=>applyOperation(r,{type:'submit',role:'审核人'}),/需由填报人/);
 r=applyOperation(r,{type:'submit',role:'填报人',values:{[field.id]:'项目 A'}});
 const stableId=r.id;assert.equal(r.status,'active');assert.equal(r.step,0);
 assert.throws(()=>applyOperation(r,{type:'return',role:'审核人'}),/退回原因/);
 r=applyOperation(r,{type:'return',role:'审核人',note:'项目名称需要核对'});
 r=applyOperation(r,{type:'submit',role:'填报人',values:{[field.id]:'项目 B'}});
 r=applyOperation(r,{type:'advance',role:'审核人',note:'已核对'});
 assert.throws(()=>applyOperation(r,{type:'return',role:'接收人',note:'拒收'}),/不支持退回/);
 r=applyOperation(r,{type:'advance',role:'接收人'});
 assert.equal(r.id,stableId);assert.equal(r.status,'complete');assert.equal(r.values[field.id],'项目 B');assert.equal(r.events[0].values[field.id],'项目 A');assert.equal(r.events[2].diff[0].before,'项目 A');
 assert.throws(()=>applyOperation(r,{type:'save',role:'填报人',values:{[field.id]:'篡改'}}),/已归档/);
});
test('template snapshots and per-stage field permissions isolate ongoing records',()=>{
 const t=parse()[0],f=t.fields[1];f.owner='review';let r=createCase(t);t.title='新版本';t.workflow=[];
 assert.notEqual(r.template.title,t.title);assert.equal(r.template.workflow.length,2);
 assert.throws(()=>applyOperation(r,{type:'save',role:'填报人',values:{[f.id]:'越权'}}),/其他办理阶段/);
 r=applyOperation(r,{type:'submit',role:'填报人'});r=applyOperation(r,{type:'advance',role:'审核人',values:{[f.id]:'审核意见'}});assert.equal(r.values[f.id],'审核意见');
});
test('attachments are recorded, work packages roundtrip, malformed workflow and links fail closed',()=>{
 const w=emptyWorkspace();w.templates=parse();let r=createCase(w.templates[0]);
 assert.throws(()=>attachFile(r,{name:'test',size:1,data:'data:text/plain;base64,YQ=='},'审核人'),/当前办理人/);
 r=attachFile(r,{name:'test',size:1,data:'data:text/plain;base64,YQ=='},'填报人');w.cases=[r];
 assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(w))),w);
 assert.equal(r.events[0].attachments.length,1);
 const bad=structuredClone(w);bad.cases[0].relatedId='missing';assert.throws(()=>validateWorkspace(bad),/关联/);
 bad.cases[0].relatedId=null;bad.templates[0].workflow=[defaultWorkflow()[0],defaultWorkflow()[0]];assert.throws(()=>validateWorkspace(bad),/唯一编号/);
});
test('standalone print export preserves merges, saved values and escapes user markup',()=>{
 const r=createCase(parse()[0]);r.values[r.template.fields[0].id]='<script>alert(1)</script> & 已填';
 const html=printableForm(r);assert.match(html,/rowspan="2"/);assert.match(html,/colspan="2"/);assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; 已填/);assert.doesNotMatch(html,/<script|<textarea|<input/i);assert.match(html,/办理记录/);
});
