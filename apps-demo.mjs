import {createApplication, createProject, startProjectCase} from './apps-model.mjs';

function template(id, title, fields, submitterRole, workflow) {
  const definitions = fields.map(field => ({type: 'text', owner: 'draft', confirmation: 'pending', evidence: 'FlowLens 原创教学样例', ...field}));
  const cell = (key, text) => ({id: key, text, colspan: 1, rowspan: 1, blocks: [{id: key + '-text', type: 'paragraph', text}]});
  return {
    id, title, version: 1, code: id.toUpperCase(), source: 'FlowLens 原创教学样例', submitterRole,
    warnings: ['本应用使用虚构项目与教学规则。请由业务负责人核对实际使用的表式与流程。'],
    fields: definitions, workflow,
    blocks: [{id: id + '-table', type: 'table', grid: [1800, 6000], rows: definitions.map(field => [cell(field.id + '-label', field.label), cell(field.id, '')])}]
  };
}

export function applicationDemo() {
  const common = [{id: 'project', label: '项目名称', required: true}, {id: 'contractor', label: '施工单位', required: true}, {id: 'instruction-no', label: '指令编号', required: true}];
  const instruction = template('app-instruction', '监理指令单', [
    ...common, {id: 'issue', label: '问题及要求', required: true},
    {id: 'deadline', label: '整改期限', type: 'date', required: true},
    {id: 'items', label: '检查明细', type: 'table', required: true, columns: [
      {id: 'position', label: '检查部位', type: 'text', required: true},
      {id: 'issue', label: '问题说明', type: 'text', required: true},
      {id: 'quantity', label: '数量', type: 'number', min: 0, required: true, sum: true, unit: '处'}
    ]}, {id: 'issue-note', label: '签发意见', owner: 'issue', required: true}
  ], '专业监理', [{id: 'issue', label: '指令签发', role: '总监', kind: 'issue'}]);
  const reply = template('app-reply', '整改回复单', [
    ...common, {id: 'issue', label: '原指令要求', required: true},
    {id: 'response', label: '整改说明', required: true}, {id: 'date', label: '完成日期', type: 'date', required: true},
    {id: 'result', label: '复查结论', owner: 'review', type: 'select', options: ['通过', '不通过'], required: true},
    {id: 'review-note', label: '复查意见', owner: 'review', required: true}
  ], '施工单位', [{id: 'review', label: '监理复查', role: '专业监理', kind: 'review'}]);
  reply.decisionRules = [{stageId: 'review', fieldId: 'result', equals: '不通过', returnTo: 'draft'}];
  const review = template('app-recheck', '复查归档记录', [
    ...common, {id: 'response', label: '整改措施摘要', required: true},
    {id: 'result', label: '复查结论', type: 'select', options: ['通过', '不通过'], required: true},
    {id: 'archive-no', label: '归档编号', owner: 'archive-receipt', required: true}
  ], '专业监理', [{id: 'archive-receipt', label: '资料归档', role: '资料员', kind: 'receipt'}]);
  const templates = [instruction, reply, review];
  const app = createApplication('青禾 · 工程监理工作台', templates.map(item => item.id));
  app.id = 'demo-supervision';
  app.relations = [
    {id: 'instruction-reply', label: '发起整改回复', from: instruction.id, to: reply.id, mappings: ['instruction-no', 'issue'].map(id => ({from: id, to: id}))},
    {id: 'reply-recheck', label: '建立复查归档记录', from: reply.id, to: review.id, mappings: ['instruction-no', 'response', 'result'].map(id => ({from: id, to: id}))}
  ];
  app.bindings = templates.flatMap(item => [{templateId: item.id, fieldId: 'project', key: 'name'}, {templateId: item.id, fieldId: 'contractor', key: 'contractor'}]);
  const project = createProject(app.id, '青禾示范项目 · 虚构', '示范施工单位');
  project.id = 'demo-project';
  const workspace = {format: 'flowlens-forms', version: 3, applications: [app], projects: [project], templates, cases: []};
  const {record} = startProjectCase(workspace, {appId: app.id, projectId: project.id, templateId: instruction.id});
  workspace.cases.push(record);
  return workspace;
}
