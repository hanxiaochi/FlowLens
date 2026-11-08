import {uid} from './forms-model.mjs';
import {FIELD_TYPES} from './forms-schema.mjs';

export const requirementStatusLabels = {pending: '待确认', confirmed: '已记录确认', changed: '需重新确认', missing: '关联对象已移除'};

function text(value, limit, required = true) {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw Error('需求记录需填写有效文字，最多 ' + limit + ' 字符');
}

export function validateRequirements(entries = []) {
  if (!Array.isArray(entries) || entries.length > 100) throw Error('每个应用最多保存 100 条需求依据');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw Error('需求依据格式无效');
    text(entry.id, 200);
    if (ids.has(entry.id)) throw Error('需求依据编号重复');
    ids.add(entry.id);
    text(entry.statement, 4000);
    text(entry.source, 8000);
    if (!['manual', 'ai'].includes(entry.origin)) throw Error('需求依据来源类型无效');
    if (!entry.target || !['template', 'field', 'stage'].includes(entry.target.kind)) throw Error('需求关联类型无效');
    text(entry.target.templateId, 200);
    text(entry.target.id, 200);
    if (!Array.isArray(entry.reviews) || entry.reviews.length > 50) throw Error('每条需求最多保存 50 次确认记录');
    for (const review of entry.reviews) {
      if (!review || typeof review !== 'object') throw Error('确认记录格式无效');
      text(review.reviewer, 200);
      text(review.evidence, 4000);
      text(review.at, 100);
      if (!Number.isFinite(Date.parse(review.at))) throw Error('确认日期无效');
      text(review.definition, 200000);
      let definition;
      try { definition = JSON.parse(review.definition); } catch { throw Error('确认定义快照无效'); }
      if (!definition || typeof definition !== 'object' || !definition.template || !definition.target) throw Error('确认定义快照无效');
    }
  }
}

export function requirementTarget(app, templates, target) {
  const template = templates.find(item => item.id === target.templateId && app.templateIds.includes(item.id));
  if (!template) return null;
  let item;
  if (target.kind === 'template') item = target.id === template.id ? template : null;
  if (target.kind === 'field') item = template.fields.find(field => field.id === target.id);
  if (target.kind === 'stage') item = template.workflow.find(stage => stage.id === target.id);
  return item ? {template, item} : null;
}

// Stable property order lets imported JSON retain the same definition identity.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function definitionFor(app, templates, entry) {
  const resolved = requirementTarget(app, templates, entry.target);
  if (!resolved) return null;
  const template = resolved.template;
  return JSON.stringify(canonical({
    statement: entry.statement, source: entry.source, origin: entry.origin, target: entry.target,
    template: {id: template.id, title: template.title, version: template.version, submitterRole: template.submitterRole ?? '填报人',
      fields: template.fields, workflow: template.workflow, decisionRules: template.decisionRules ?? [], blocks: template.blocks},
    relations: app.relations, bindings: app.bindings
  }));
}

export function requirementStatus(app, templates, entry) {
  const definition = definitionFor(app, templates, entry);
  if (definition === null) return 'missing';
  const latest = entry.reviews.at(-1);
  if (!latest) return 'pending';
  return latest.definition === definition ? 'confirmed' : 'changed';
}

export function saveRequirement(app, templates, input) {
  const entries = app.requirements ?? [];
  const old = input.id ? entries.find(entry => entry.id === input.id) : null;
  if (input.id && !old) throw Error('需求记录已不存在，请重新读取');
  const entry = {id: old?.id ?? uid(), statement: input.statement, source: input.source, origin: input.origin,
    target: structuredClone(input.target), reviews: structuredClone(old?.reviews ?? [])};
  validateRequirements([entry]);
  if (!requirementTarget(app, templates, entry.target)) throw Error('请选择当前应用中的表式、字段或办理动作');
  const next = old ? entries.map(item => item.id === old.id ? entry : item) : [...entries, entry];
  validateRequirements(next);
  return {...app, requirements: next};
}

export function confirmRequirement(app, templates, id, {reviewer, evidence, expectedDefinition}) {
  const entry = app.requirements?.find(item => item.id === id);
  if (!entry) throw Error('需求记录已不存在');
  const definition = definitionFor(app, templates, entry);
  if (definition === null) throw Error('关联对象已移除，请先重新关联');
  if (definition !== expectedDefinition) throw Error('定义已变化，请重新核对后记录确认');
  const updated = {...entry, reviews: [...entry.reviews, {reviewer, evidence, at: new Date().toISOString(), definition}]};
  validateRequirements([updated]);
  return {...app, requirements: app.requirements.map(item => item.id === id ? updated : item)};
}

export function requirementDefinition(app, templates, id) {
  const entry = app.requirements?.find(item => item.id === id);
  if (!entry) throw Error('需求记录已不存在');
  return definitionFor(app, templates, entry);
}

export function retainRequirementHistory(previous, incoming) {
  if (!previous?.requirements?.length) return incoming;
  if (incoming.requirements === undefined) return {...incoming, requirements: structuredClone(previous.requirements)};
  for (const old of previous.requirements) {
    const next = incoming.requirements.find(entry => entry.id === old.id);
    if (!next || JSON.stringify(next.reviews.slice(0, old.reviews.length)) !== JSON.stringify(old.reviews)) throw Error('发布需保留已有需求依据与确认历史，请先取得最新应用定义');
  }
  return incoming;
}

export function requirementDefinitionText(serialized) {
  let definition;
  try { definition = JSON.parse(serialized); } catch { return '快照无法生成摘要，请核对完整定义。'; }
  const template = definition?.template;
  if (!template || !Array.isArray(template.fields) || !Array.isArray(template.workflow) ||
      !template.fields.every(field => field && typeof field.label === 'string') ||
      !template.workflow.every(stage => stage && typeof stage.label === 'string')) return '这份历史快照的摘要字段不完整，请核对完整定义。';
  const stageName = id => id === 'draft' ? '填报阶段' : template.workflow.find(stage => stage.id === id)?.label ?? id ?? '未记录';
  const fieldName = id => template.fields.find(field => field.id === id)?.label ?? id ?? '未记录';
  const target = definition.target;
  const targetName = target?.kind === 'field' ? fieldName(target.id) : target?.kind === 'stage' ? stageName(target.id) : target?.kind === 'template' ? '整份表式' : '未记录关联对象';
  function fieldText(field) {
    const details = [field.label, FIELD_TYPES[field.type ?? 'text'] ?? field.type, field.required ? '必填' : '选填'];
    if (field.unit) details.push('单位 ' + field.unit);
    if (field.min !== undefined) details.push('最小值 ' + field.min);
    if (field.max !== undefined) details.push('最大值 ' + field.max);
    if (Array.isArray(field.options)) details.push('选项 ' + field.options.join('、'));
    if (field.sum !== undefined) details.push(field.sum ? '计算合计' : '不计算合计');
    return details.join(' · ');
  }
  const fields = template.fields.flatMap(field => [
    fieldText(field) + ' · 在' + stageName(field.owner) + '填写',
    ...(Array.isArray(field.columns) ? field.columns.filter(column => column && typeof column.label === 'string').map(column => '  明细列 ' + fieldText(column)) : [])
  ]);
  const workflow = template.workflow.map(stage => {
    const action = {review: '审核', issue: '签发', receipt: '签收'}[stage.kind] ?? stage.kind ?? '未记录办理方式';
    const returning = stage.kind === 'receipt' ? '签收后继续' : '可退回至' + stageName(stage.returnTo ?? 'draft');
    return `${stage.label} · 由${stage.role ?? '待安排'}办理 · ${action} · ${returning}`;
  });
  const rules = (Array.isArray(template.decisionRules) ? template.decisionRules : []).filter(rule => rule && typeof rule === 'object').map(rule =>
    `${stageName(rule.stageId)}继续办理时，${fieldName(rule.fieldId)}为“${rule.equals}”，退回至${stageName(rule.returnTo)}，填写退回原因。`);
  const bindings = (Array.isArray(definition.bindings) ? definition.bindings : []).filter(binding => binding?.templateId === template.id).map(binding =>
    `${fieldName(binding.fieldId)}从项目${{name: '名称', contractor: '施工单位'}[binding.key] ?? binding.key}带入`);
  const relations = (Array.isArray(definition.relations) ? definition.relations : []).filter(relation => relation && [relation.from, relation.to].includes(template.id)).map(relation => {
    const mappings = (Array.isArray(relation.mappings) ? relation.mappings : []).filter(mapping => mapping && typeof mapping === 'object').map(mapping =>
      `${relation.from === template.id ? fieldName(mapping.from) : mapping.from} → ${relation.to === template.id ? fieldName(mapping.to) : mapping.to}`);
    return `${relation.label ?? '关联业务'}\n${mappings.join('\n') || '无字段带入'}`;
  });
  return [
    `${template.title ?? '历史表式'} · 版本 ${template.version ?? '未记录'}`, '关联对象\n' + targetName,
    '当时的需求描述\n' + (definition.statement ?? '未记录'), '当时的原文与出处\n' + (definition.source ?? '未记录'),
    '记录来源\n' + ({manual: '人工录入', ai: 'AI 建议'}[definition.origin] ?? '未记录'),
    '发起角色\n' + (template.submitterRole ?? '填报人'), '字段要求\n' + (fields.join('\n') || '无填写字段'),
    '办理顺序\n' + (workflow.join('\n') || '未记录办理阶段'), '条件退回\n' + (rules.join('\n') || '未配置条件退回'),
    '项目资料带入\n' + (bindings.join('\n') || '无项目资料映射'),
    '关联业务与字段带入\n' + (relations.join('\n\n') || '无关联业务'),
    '其他表的字段使用快照中保存的编号。原表布局及完整属性可在完整定义中核对。'
  ].join('\n\n');
}

export function requirementsText(app, templates) {
  validateRequirements(app.requirements);
  const sections = (app.requirements ?? []).map(entry => {
    const target = requirementTarget(app, templates, entry.target);
    const title = target ? `${target.template.title} / ${target.item.label ?? target.item.title}` : `${entry.target.templateId} / ${entry.target.id}`;
    const history = entry.reviews.map(review => `确认人 ${review.reviewer}\n记录时间 ${review.at}\n确认依据 ${review.evidence}\n当时定义摘要\n${requirementDefinitionText(review.definition)}\n\n完整定义快照\n${review.definition}`).join('\n\n');
    return `${entry.statement}\n关联 ${title}\n来源 ${entry.origin === 'ai' ? 'AI 建议' : '人工录入'}\n材料原文或出处\n${entry.source}\n当前状态 ${requirementStatusLabels[requirementStatus(app, templates, entry)]}\n\n${history || '尚无确认记录'}`;
  });
  return [app.name + ' · 需求依据与确认记录', '确认人及依据由记录者填写；团队发布操作按现有账号审计。', ...sections].join('\n\n');
}
