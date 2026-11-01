import {createCase,applyOperation} from './forms-model.mjs';
import {emptyWorkspace,validateWorkspace} from './forms-store.mjs';

// Original fictional teaching material. No customer documents or project data.
export function demoWorkspace(){
 const fields=[];let serial=0;
 const p=text=>({id:`demo-p-${++serial}`,type:'paragraph',text});
 const cell=(text,span=1)=>({id:`demo-c-${++serial}`,text,colspan:span,rowspan:1,blocks:[p(text)]});
 const input=(id,label,owner='draft',span=1,required=false)=>{const c=cell('',span);c.id=id;fields.push({id,label,owner,required});return c;};
 const rows=[
  [cell('施工单位'),input('company','施工单位','draft',2,true),cell('合同段'),input('contract','合同段','draft',2,true)],
  [cell('检查位置'),input('location','检查位置','draft',2,true),cell('检查日期'),input('date','检查日期','draft',2,true)],
  [cell('检查内容',2),cell('核对依据'),cell('现场记录',2),cell('填报结论')],
  ...['材料证明文件','现场尺寸复核','隐蔽部位照片','施工记录完整性'].map((name,i)=>[cell(name,2),cell('按项目确认的文件核对'),input(`observation-${i}`,`${name} · 现场记录`,'draft',2),input(`result-${i}`,`${name} · 填报结论`)]),
  [cell('待处理问题'),input('issues','待处理问题','draft',5)],
  [cell('监理意见'),input('review-note','监理意见','review',5,true)],
  [cell('资料接收备注'),input('receipt-note','资料接收备注','receipt',5)]
 ];
 const template={id:'demo-inspection-v1',version:1,code:'DEMO-001',title:'现场检查与资料流转单（虚构样例）',source:'FlowLens 原创教学样例',warnings:['所有单位、项目与填写值均为虚构；本表不属于行业标准用表，也不自动判定工程质量。'],fields,workflow:[{id:'review',label:'监理审核',role:'专业监理',kind:'review'},{id:'receipt',label:'资料签收',role:'资料员',kind:'receipt'}],blocks:[p('现场检查与资料流转单'),p('填写 → 监理审核（可退回）→ 资料签收 → 归档'),{id:'demo-table',type:'table',grid:[1400,1200,1400,1200,1200,1400],rows}]};
 let record=createCase(template,{title:'先试这份：现场检查记录',project:'青禾示范项目 · 虚构',role:'填报人'});
 record=applyOperation(record,{type:'save',role:'填报人',values:{company:'示范施工单位',contract:'演示合同段 01',location:'示范工点 A',date:'2026-11-02',issues:'请体验提交、退回修改及签收；不代表真实工程情况。'},note:'已准备好一份草稿，点击提交即可开始体验。'});
 const workspace=emptyWorkspace();workspace.templates=[template];workspace.cases=[record];return validateWorkspace(workspace);
}
