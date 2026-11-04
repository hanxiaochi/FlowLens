import {validateFieldValue, missingDetailValues} from './forms-schema.mjs';
import {summarizeRecord} from './forms-model.mjs';

// This report describes saved data, never advances a workflow or signs off delivery.
export function reviewProject(workspace, projectId, inspectAttachment = () => 'unchecked') {
  const project = workspace.projects.find(item => item.id === projectId);
  if (!project) throw Object.assign(Error('项目不存在或不可访问'), {status: 404});
  const records = workspace.cases.filter(record => record.projectId === projectId);
  const byId = new Map(records.map(record => [record.id, record]));
  const results = [], totals = {records: records.length, affectedRecords: 0, pending: 0, review: 0, unchecked: 0, attachments: 0};
  for (const record of records) {
    const issues = [], stages = record.template.workflow;
    const position = record.status === 'draft' ? -1 : record.status === 'complete' ? stages.length : record.step;
    const stageValid = ['draft', 'active', 'complete'].includes(record.status) && (record.status !== 'active' || Number.isInteger(position) && position >= 0 && position < stages.length);
    const add = (kind, severity, label, message, extra = {}) => { issues.push({kind, severity, label, message, ...extra}); totals[severity]++; };
    if (!stageValid) add('workflow', 'review', '办理阶段', '当前状态或办理阶段无效，请管理员核对。');
    for (const field of record.template.fields) {
      const value = Object.hasOwn(record.values, field.id) ? record.values[field.id] : '';
      const owner = field.owner === 'draft' ? -1 : stages.findIndex(stage => stage.id === field.owner);
      const ownerValid = field.owner === 'draft' || owner >= 0;
      const target = {fieldId: field.id};
      if (!ownerValid) add('field-owner', 'review', field.label, '字段的填写阶段不在历史表式中。', target);
      try { validateFieldValue(field, value); }
      catch (error) { add('field-format', 'review', field.label, error.message, target); continue; }
      if (!stageValid || !ownerValid || owner > position) continue;
      if (field.required && !value.trim() || missingDetailValues(field, value)) {
        const current = record.status !== 'complete' && owner === position;
        add('required', current ? 'pending' : 'review', field.label,
          current ? '当前办理阶段仍需补齐此字段或明细必填内容。' : '已办理阶段的必填内容或明细不完整，请核对历史资料。', target);
      }
    }
    if (record.relatedId) {
      const source = byId.get(record.relatedId);
      if (!source || source.id === record.id) add('upstream', 'review', '上游单据', '上游关联未指向本项目内另一份可核对的单据。');
      else if (record.link) {
        if (record.link.sourceId !== source.id) add('upstream', 'review', '上游单据', '带入来源与上游单据关联不一致。');
        if (source.status !== 'complete') add('upstream-status', 'review', '上游单据', '带入来源尚未归档，请核对办理关系。');
        if (source.revision !== record.link.sourceRevision) add('upstream-revision', 'review', '上游单据', '上游修订与当时带入的修订不同，请核对变更。');
      }
    } else if (record.link) add('upstream', 'review', '上游单据', '存在带入来源快照，但缺少上游单据关联。');
    for (const file of record.attachments) {
      totals.attachments++;
      const state = inspectAttachment(file, record);
      if (state === 'invalid') add('attachment', 'review', file.name, '附件内容缺失、大小或校验值不一致。', {attachmentId: file.id});
      else if (state !== 'verified') add('attachment', 'unchecked', file.name, '本轮未完成附件内容校验，请另行核验。', {attachmentId: file.id});
    }
    if (issues.length) {
      totals.affectedRecords++;
      results.push({recordId: record.id, title: record.title, summary: summarizeRecord(record), templateId: record.template.id, templateVersion: record.template.version, revision: record.revision,
        status: record.status, stage: !stageValid ? '阶段无效' : record.status === 'draft' ? '待填写' : record.status === 'complete' ? '已归档' : stages[position].label,
        role: record.status === 'complete' ? '' : record.status === 'draft' ? record.submitter : stages[position]?.role ?? '', issues});
    }
  }
  return {format: 'flowlens-project-review', version: 1, project: {id: project.id, name: project.name}, workspaceRevision: workspace.storageRevision,
    generatedAt: new Date().toISOString(), scope: '已保存单据与历史表式的结构核对；不含本机未保存内容，不代替业务负责人验收。', totals, results};
}

export function printableProjectReview(report) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const labels = {pending: '待补齐', review: '需核对', unchecked: '未完成校验'};
  const cards = report.results.map(record => '<section><h2>' + escape(record.title) + '</h2><p>' + escape(record.stage) + ' · ' + escape(record.role) + ' · 表式版本 ' + escape(record.templateVersion) + '</p><p class="muted">单据编号 ' + escape(record.recordId) + ' · 单据修订 ' + escape(record.revision) + '</p><dl>' + record.summary.map(field => '<dt>' + escape(field.label) + '</dt><dd>' + escape(field.text) + '</dd>').join('') + '</dl><table><thead><tr><th>类别</th><th>字段或资料</th><th>待处理事项</th></tr></thead><tbody>' + record.issues.map(issue => '<tr><td>' + escape(labels[issue.severity]) + '</td><td>' + escape(issue.label) + '</td><td>' + escape(issue.message) + '</td></tr>').join('') + '</tbody></table></section>').join('');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>FlowLens 资料核对 · ' + escape(report.project.name) + '</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#29232f;background:#f6f4f0;max-width:1080px;margin:32px auto;padding:0 24px}h1{font-size:32px}section{background:white;border:1px solid #ddd6e2;border-radius:16px;padding:24px;margin:24px 0}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e0e9;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#eee8f3}th:first-child{width:90px}th:nth-child(2){width:25%}p,dd{overflow-wrap:anywhere;white-space:pre-wrap}.muted,dt{color:#6d6375}dd{margin:0 0 10px}thead{display:table-header-group}@media print{body{background:white;margin:0;font-size:10pt}section{border:0;padding:0;border-radius:0}tr{break-inside:avoid}h2{break-after:avoid}}</style></head><body><h1>交付前资料核对</h1><p>' + escape(report.project.name) + ' · 工作区修订 ' + escape(report.workspaceRevision) + '</p><p class="muted">生成时间 UTC：' + escape(report.generatedAt) + '</p><p>' + escape(report.scope) + '</p><p>已检查 ' + report.totals.records + ' 份单据；' + report.totals.affectedRecords + ' 份有待处理项。待补齐 ' + report.totals.pending + ' 项，需核对 ' + report.totals.review + ' 项，未完成校验 ' + report.totals.unchecked + ' 项。</p><p>本文件为生成时的核对快照，不会随系统更新。可以用浏览器打印或保存为 PDF；业务正确性、表式适用性及交付签字仍需负责人确认。</p>' + (cards || '<p>本轮结构检查未发现待处理项。</p>') + '</body></html>';
}
