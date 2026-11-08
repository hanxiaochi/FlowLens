import {discoveryFields} from './apps-model.mjs';
import {requirementStatus, requirementStatusLabels, requirementTarget, scenarioRunStatus, scenarioStatusLabels, observationStatus, observationStatusLabels} from './apps-requirements.mjs';
import {applicationScenarioStatus, applicationScenarioStatusLabels} from './apps-scenarios.mjs';

export function applicationHandoff(app, templates) {
  const forms = app.templateIds.map(id => templates.find(template => template.id === id));
  if (forms.some(template => !template)) throw Error('应用引用的表式已不存在，请先核对定义');
  const crossFormRuns = (app.scenarioRuns ?? []).map(run => ({id: run.id, at: run.report.at,
    status: applicationScenarioStatus(app, templates, run), requirementIds: (run.report.requirements ?? []).map(entry => entry.id)}));
  const requirements = (app.requirements ?? []).map(entry => {
    const target = requirementTarget(app, templates, entry.target);
    const review = entry.reviews.at(-1);
    return {id: entry.id, statement: entry.statement, source: entry.source, origin: entry.origin, target: structuredClone(entry.target),
      targetLabel: target ? target.template.title + ' / ' + (target.item.label ?? target.item.title) : '关联对象已移除',
      confirmation: requirementStatus(app, templates, entry),
      latestReview: review ? {reviewer: review.reviewer, at: review.at, evidence: review.evidence} : null,
      runs: (entry.runs ?? []).map(run => ({id: run.id, at: run.at, status: scenarioRunStatus(app, templates, entry, run)})),
      observations: (entry.observations ?? []).map(item => ({id: item.id, at: item.at, status: observationStatus(app, templates, entry, item),
        observer: item.observer, environment: item.environment, expected: item.expected, actual: item.actual, followUp: item.followUp})),
      crossFormRuns: crossFormRuns.filter(run => run.requirementIds.includes(entry.id))};
  });
  const discovery = discoveryFields.map(([key, label]) => ({key, label, value: app.discovery?.[key] ?? ''}));
  const definitions = forms.map(template => {
    const prefix = 'contracts/' + encodeURIComponent(template.id) + '-v' + template.version;
    return {id: template.id, title: template.title, version: template.version,
      requirementIds: requirements.filter(entry => entry.target.templateId === template.id).map(entry => entry.id),
      files: {api: prefix + '.openapi.json', sql: prefix + '.sql', brief: prefix + '.md'}};
  });
  return {format: 'flowlens-discovery-handoff', version: 1, applicationId: app.id, applicationName: app.name,
    scope: '当前定义下的需求与证据索引。关联表示记录归属，业务含义、生产权限和部署结果仍需实际验收。',
    discovery, definitions, requirements, crossFormRuns,
    missingDiscovery: discovery.filter(item => !item.value.trim()).map(item => item.label),
    unlinkedTemplates: definitions.filter(item => !item.requirementIds.length).map(item => ({id: item.id, title: item.title})),
    followUps: requirements.flatMap(entry => entry.observations.filter(item => item.followUp.trim()).map(item => ({
      requirementId: entry.id, statement: entry.statement, observationId: item.id, at: item.at, status: item.status, text: item.followUp
    })))};
}

export function handoffRequirementText(entry) {
  const runs = entry.runs.map(run => run.at + ' · ' + scenarioStatusLabels[run.status]);
  const observations = entry.observations.map(item => [item.at + ' · ' + observationStatusLabels[item.status],
    '观察人 ' + item.observer, '环境 ' + item.environment, '预期\n' + item.expected, '实际与证据位置\n' + item.actual,
    '跟进事项\n' + (item.followUp || '未记录')].join('\n'));
  const chains = entry.crossFormRuns.map(run => run.at + ' · ' + applicationScenarioStatusLabels[run.status]);
  const review = entry.latestReview;
  return [entry.statement, '关联 ' + entry.targetLabel, '来源 ' + (entry.origin === 'ai' ? 'AI 建议' : '人工录入'),
    '原文与出处\n' + entry.source, '确认状态 ' + requirementStatusLabels[entry.confirmation],
    review ? `最近记录的确认\n${review.reviewer} · ${review.at}\n${review.evidence}` : '尚无业务确认记录',
    '单表场景历史\n' + (runs.join('\n') || '尚无关联单表场景'),
    '现场观察历史\n' + (observations.join('\n\n') || '尚无现场观察'),
    '关联跨表场景\n' + (chains.join('\n') || '尚无关联跨表场景')].join('\n\n');
}

export function applicationHandoffText(report) {
  const definitions = report.definitions.map(item => `${item.title} · 版本 ${item.version}\n接口草案 ${item.files.api}\n数据库草案 ${item.files.sql}\n开发说明 ${item.files.brief}`);
  const followUps = report.followUps.map(item => `${item.statement}\n${item.at} · ${observationStatusLabels[item.status]}\n${item.text}`);
  const chains = report.crossFormRuns.map(run => `${run.at} · ${applicationScenarioStatusLabels[run.status]} · 关联 ${run.requirementIds.length} 条需求`);
  return [report.applicationName + ' · 开发交接索引', report.scope,
    '需求工作单\n' + report.discovery.map(item => item.label + '\n' + (item.value.trim() || '待补充')).join('\n\n'),
    '尚未关联需求的表式\n' + (report.unlinkedTemplates.map(item => item.title).join('\n') || '每份表式均有需求关联，具体字段与规则覆盖需逐项核对'),
    '需求与证据\n' + (report.requirements.map(handoffRequirementText).join('\n\n') || '尚无需求依据记录'),
    '记录过的跟进事项\n逐条保留历史原文，后续观察不会自动关闭此前事项。\n' + (followUps.join('\n\n') || '尚无跟进事项记录'),
    '应用跨表历史\n' + (chains.join('\n') || '尚无已保存跨表场景'),
    '当前定义的开发文件\n以下路径位于应用交付 ZIP 内，接口与 SQL 供开发核对。\n' + definitions.join('\n\n'),
    '完整材料\napplication.json 保存定义、业务记录和证据快照。requirements.txt 保存完整需求历史。cross-form-scenarios.txt 保存跨表报告。\n在解压目录运行 node verify-app.mjs，可重新执行本地模板规则与虚构跨表检查。'
  ].join('\n\n');
}
