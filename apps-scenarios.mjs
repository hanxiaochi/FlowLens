import {createProject, startProjectCase, validateApplications} from './apps-model.mjs';
import {applyOperation} from './forms-model.mjs';
import {scenarioSampleValues} from './forms-acceptance.mjs';

export function runApplicationScenario(workspace, appId) {
  const source = workspace.applications.find(app => app.id === appId);
  if (!source) throw Error('应用已不存在');
  const app = structuredClone({id: source.id, name: source.name, templateIds: source.templateIds, relations: source.relations, bindings: source.bindings});
  const templates = structuredClone(workspace.templates.filter(template => app.templateIds.includes(template.id)));
  const project = createProject(app.id, '跨表场景 · 虚构项目', '跨表场景 · 虚构施工单位');
  const otherProject = createProject(app.id, '隔离检查 · 虚构项目');
  const isolated = {applications: [app], templates, projects: [project, otherProject], cases: []};
  validateApplications(isolated);
  const results = [];
  const attempts = [];
  const ensure = (condition, message) => { if (!condition) throw Error(message); };
  function check(title, expected, action, recordId = null) {
    try {
      action();
      results.push({title, expected, actual: '执行结果符合预期', passed: true, recordId});
      return true;
    } catch (error) {
      results.push({title, expected, actual: error.message, passed: false, recordId});
      return false;
    }
  }
  function rejects(options, message) {
    const before = JSON.stringify(isolated.cases);
    let error;
    try { startProjectCase(isolated, options); } catch (caught) { error = caught; }
    ensure(error?.message.includes(message), error?.message ?? '预期拒绝，但发起成功');
    ensure(JSON.stringify(isolated.cases) === before, '拒绝发起后业务记录发生变化');
  }
  const pending = templates.filter(template => !app.relations.some(relation => relation.to === template.id))
    .map(template => ({appId, projectId: project.id, templateId: template.id}));
  for (const template of templates.filter(item => app.relations.some(relation => relation.to === item.id))) {
    check(template.title + ' · 关联入口', '有上游关系的表式不能直接从项目发起', () =>
      rejects({appId, projectId: project.id, templateId: template.id}, '请从关联的上游单据'));
  }
  while (pending.length && isolated.cases.length < 100) {
    const options = pending.shift();
    const template = templates.find(item => item.id === options.templateId);
    let record;
    const started = check(template.title + ' · 发起与资料带入', '建立来源关联，逐项带入项目与上游字段，重复发起返回同一单据', () => {
      const result = startProjectCase(isolated, options);
      ensure(!result.existing, '场景意外复用了已有单据');
      record = result.record;
      isolated.cases.push(record);
      for (const provenance of record.provenance) {
        const upstream = isolated.cases.find(item => item.id === provenance.sourceId);
        const expected = provenance.source === 'project' ? project[provenance.key] : upstream?.values[provenance.sourceFieldId] ?? '';
        ensure(provenance.value === expected && record.values[provenance.fieldId] === expected, '带入值与来源不一致');
      }
      if (options.sourceId) {
        const upstream = isolated.cases.find(item => item.id === options.sourceId);
        ensure(record.relatedId === upstream.id && record.link.sourceRevision === upstream.revision, '上游关联或修订不一致');
        const replay = startProjectCase(isolated, options);
        ensure(replay.existing && JSON.stringify(replay.record) === JSON.stringify(record), '重复发起未返回同一单据');
      }
    });
    if (!started) continue;
    const outgoing = app.relations.filter(relation => relation.from === template.id);
    for (const relation of outgoing) {
      const downstream = {appId, projectId: project.id, templateId: relation.to, sourceId: record.id, relationId: relation.id};
      check(relation.label + ' · 上游未完成', '上游完成前拒绝发起下游', () => rejects(downstream, '请先完成上游'), record.id);
      check(relation.label + ' · 项目隔离', '另一项目不能引用这张上游单据', () => rejects({...downstream, projectId: otherProject.id}, '上游业务与当前项目'), record.id);
    }
    const completed = check(template.title + ' · 按角色办理', '使用当前定义的角色完成各阶段，保留资料来源和办理历史', () => {
      const samples = scenarioSampleValues(template);
      for (let index = -1; index < template.workflow.length; index++) {
        const owner = index < 0 ? 'draft' : template.workflow[index].id;
        const role = index < 0 ? record.submitter : template.workflow[index].role;
        const values = Object.fromEntries(template.fields.filter(field => field.owner === owner).map(field =>
          [field.id, Object.hasOwn(record.values, field.id) ? record.values[field.id] : samples[field.id]]));
        const operation = {type: index < 0 ? 'submit' : 'advance', role, values, expectedRevision: record.revision, operationId: 'scenario-' + owner};
        const attempt = {recordId: record.id, title: record.title, operation: structuredClone(operation), before: {stage: owner, revision: record.revision}};
        attempts.push(attempt);
        let next;
        try {
          next = applyOperation(record, operation);
          attempt.after = {stage: next.status === 'complete' ? 'archive' : next.status === 'draft' ? 'draft' : template.workflow[next.step].id, revision: next.revision};
          attempt.outcome = 'accepted';
        } catch (error) {
          attempt.outcome = 'rejected'; attempt.message = error.message; attempt.after = structuredClone(attempt.before);
          throw error;
        }
        isolated.cases[isolated.cases.findIndex(item => item.id === record.id)] = next;
        record = next;
        ensure(record.step === index + 1, '样例未进入下一阶段，请核对带入值与条件规则');
        ensure(JSON.stringify(applyOperation(record, operation)) === JSON.stringify(record), '重复办理改变了记录');
      }
      ensure(record.status === 'complete', '样例未完成归档');
    }, record.id);
    if (completed) {
      for (const relation of outgoing) pending.push({appId, projectId: project.id, templateId: relation.to, sourceId: record.id, relationId: relation.id});
    }
  }
  check('应用链路覆盖', '所有表式与关联至少完成一次，场景在 100 张单据内结束', () => {
    ensure(!pending.length, '场景超过 100 张单据，请缩小应用关系范围');
    ensure(templates.every(template => isolated.cases.some(record => record.template.id === template.id && record.status === 'complete')), '存在未完成的表式，请核对前面的失败记录');
    ensure(app.relations.every(relation => isolated.cases.some(record => record.link?.relationId === relation.id && record.status === 'complete')), '存在未完成的关联路径');
  });
  return {at: new Date().toISOString(), scope: '虚构项目中的本地跨表场景，服务端账号与数据库权限需另行验收',
    application: app, templates, project, results, attempts, records: isolated.cases, passed: results.every(result => result.passed)};
}

export function applicationScenarioText(report) {
  const checks = report.results.map(result => [result.title, '预期\n' + result.expected, '实际\n' + result.actual, result.passed ? '此项通过' : '此项失败'].join('\n'));
  const records = report.records.map(record => {
    const fieldName = id => record.template.fields.find(field => field.id === id)?.label ?? id;
    const provenance = record.provenance.map(item => `${fieldName(item.fieldId)} ← ${item.source === 'project' ? '项目资料' : '上游单据 ' + item.sourceId} = ${item.value}`);
    const events = record.events.map(event => `${event.role} · ${{save: '保存', submit: '提交', advance: '继续', return: '退回'}[event.type]} · ${event.from} → ${event.to} · 修订 ${event.revision}\n${event.diff.map(change => `${change.field} 从“${change.before}”变为“${change.after}”`).join('\n')}`);
    return [record.title, '单据编号 ' + record.id, '来源单据 ' + (record.relatedId ?? '项目发起'),
      '状态 ' + ({draft: '填报中', active: '办理中', complete: '已归档'}[record.status]) + ' · 修订 ' + record.revision, '资料带入\n' + (provenance.join('\n') || '无资料映射'), '办理历史\n' + events.join('\n\n')].join('\n\n');
  });
  const rejected = report.attempts.filter(attempt => attempt.outcome === 'rejected').map(attempt => `${attempt.title} · ${attempt.operation.role}\n拒绝原因 ${attempt.message}\n本次输入\n${JSON.stringify(attempt.operation.values, null, 2)}`);
  return [report.application.name + ' · 跨表场景', report.at, report.scope, ...checks, ...rejected, ...records].join('\n\n');
}
