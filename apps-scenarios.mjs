import {createProject, startProjectCase, validateApplications} from './apps-model.mjs';
import {validateWorkspace} from './forms-store.mjs';
import {validateRequirements} from './apps-requirements.mjs';
import {applyOperation, uid} from './forms-model.mjs';
import {scenarioSampleValues} from './forms-acceptance.mjs';

export function runApplicationScenario(workspace, appId, requirementIds = []) {
  const source = workspace.applications.find(app => app.id === appId);
  if (!source) throw Error('应用已不存在');
  const requirements = selectedRequirements(source, requirementIds);
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
    application: app, templates, requirements, project, results, attempts, records: isolated.cases, passed: results.every(result => result.passed)};
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
  return [report.application.name + ' · 跨表场景', report.at, report.scope, '关联需求\n' + ((report.requirements ?? []).map(entry => entry.statement + '\n' + entry.source).join('\n\n') || '未关联具体需求'), ...checks, ...rejected, ...records].join('\n\n');
}


export const applicationScenarioStatusLabels = {passed: '跨表场景通过', failed: '跨表场景有失败项', changed: '定义已变化，需重新运行', missing: '关联需求已移除'};

function selectedRequirements(app, ids) {
  if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length) throw Error('跨表场景关联需求无效');
  return ids.map(id => {
    const entry = app.requirements?.find(item => item.id === id);
    if (!entry) throw Error('关联需求已移除，请重新选择');
    const {statement, source, origin, target} = entry;
    return structuredClone({id, statement, source, origin, target});
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function scenarioDefinition(app, templates, requirements) {
  const {id, name, templateIds, relations, bindings} = app;
  return JSON.stringify(canonical({application: {id, name, templateIds, relations, bindings},
    templates: templateIds.map(id => templates.find(template => template.id === id)), requirements}));
}

export function applicationScenarioStatus(app, templates, run) {
  const report = run.report;
  const ids = (report.requirements ?? []).map(entry => entry.id);
  if (ids.some(id => !app.requirements?.some(entry => entry.id === id))) return 'missing';
  const current = scenarioDefinition(app, templates, selectedRequirements(app, ids));
  if (current !== scenarioDefinition(report.application, report.templates, report.requirements ?? [])) return 'changed';
  return report.passed ? 'passed' : 'failed';
}

export function validateApplicationScenarios(runs = []) {
  if (!Array.isArray(runs) || runs.length > 10) throw Error('每个应用最多保存 10 次跨表场景');
  const ids = new Set();
  const text = (value, limit) => { if (typeof value !== 'string' || value.length > limit) throw Error('跨表报告文字无效'); };
  for (const run of runs) {
    if (!run || typeof run !== 'object' || typeof run.id !== 'string' || !run.id || run.id.length > 200 || ids.has(run.id)) throw Error('跨表场景编号无效');
    ids.add(run.id);
    const report = run.report;
    if (!report || JSON.stringify(report).length > 2000000 || typeof report.at !== 'string' || !Number.isFinite(Date.parse(report.at))) throw Error('跨表报告无效或超过容量');
    text(report.scope, 1000);
    if (!Array.isArray(report.results) || !report.results.length || report.results.length > 21000 || !Array.isArray(report.records) || report.records.length > 100 || !Array.isArray(report.attempts) || report.attempts.length > 1300) throw Error('跨表报告结果无效');
    if (!report.application || Object.keys(report.application).some(key => !['id', 'name', 'templateIds', 'relations', 'bindings'].includes(key))) throw Error('跨表报告应用快照无效');
    validateWorkspace({format: 'flowlens-forms', version: 3, applications: [report.application], templates: report.templates, projects: [report.project], cases: report.records});
    for (const record of report.records) {
      if (!Array.isArray(record.provenance) || record.events.some(event => !['save', 'submit', 'advance', 'return'].includes(event.type))) throw Error('跨表单据来源或历史无效');
    }
    if (!Array.isArray(report.requirements ?? [])) throw Error('跨表报告需求快照无效');
    validateRequirements((report.requirements ?? []).map(entry => ({...entry, reviews: []})));
    for (const result of report.results) {
      if (!result || typeof result.passed !== 'boolean') throw Error('跨表检查结论无效');
      text(result.title, 1000); text(result.expected, 4000); text(result.actual, 20000);
    }
    if (report.passed !== report.results.every(result => result.passed)) throw Error('跨表报告总结果不一致');
    for (const attempt of report.attempts) {
      if (!attempt || !['accepted', 'rejected'].includes(attempt.outcome) || !report.records.some(record => record.id === attempt.recordId)) throw Error('跨表操作记录无效');
      text(attempt.title, 500); text(attempt.operation?.role, 200);
      if (!['submit', 'advance'].includes(attempt.operation?.type) || !attempt.operation.values || typeof attempt.operation.values !== 'object' || Array.isArray(attempt.operation.values)) throw Error('跨表操作输入无效');
      for (const value of Object.values(attempt.operation.values)) text(value, 20000);
      for (const state of [attempt.before, attempt.after]) {
        if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0) throw Error('跨表操作修订无效');
        text(state.stage, 200);
      }
      if (attempt.outcome === 'rejected') text(attempt.message, 20000);
    }
  }
}

export function saveApplicationScenario(app, templates, report) {
  const run = {id: uid(), report: structuredClone(report)};
  validateApplicationScenarios([run]);
  if (['changed', 'missing'].includes(applicationScenarioStatus(app, templates, run))) throw Error('定义或关联需求已变化，请重新运行跨表场景');
  const scenarioRuns = [...(app.scenarioRuns ?? []), run];
  validateApplicationScenarios(scenarioRuns);
  return {...app, scenarioRuns};
}

export function retainApplicationScenarioHistory(previous, incoming) {
  if (!previous?.scenarioRuns?.length) return incoming;
  if (incoming.scenarioRuns === undefined) return {...incoming, scenarioRuns: structuredClone(previous.scenarioRuns)};
  if (JSON.stringify(incoming.scenarioRuns.slice(0, previous.scenarioRuns.length)) !== JSON.stringify(previous.scenarioRuns)) throw Error('发布需保留已有跨表场景历史，请先取得最新应用定义');
  return incoming;
}
