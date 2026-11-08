import {uid} from './forms-model.mjs';

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

export function requirementsText(app, templates) {
  validateRequirements(app.requirements);
  const sections = (app.requirements ?? []).map(entry => {
    const target = requirementTarget(app, templates, entry.target);
    const title = target ? `${target.template.title} / ${target.item.label ?? target.item.title}` : `${entry.target.templateId} / ${entry.target.id}`;
    const history = entry.reviews.map(review => `确认人 ${review.reviewer}\n记录时间 ${review.at}\n确认依据 ${review.evidence}\n当时定义\n${review.definition}`).join('\n\n');
    return `${entry.statement}\n关联 ${title}\n来源 ${entry.origin === 'ai' ? 'AI 建议' : '人工录入'}\n材料原文或出处\n${entry.source}\n当前状态 ${requirementStatusLabels[requirementStatus(app, templates, entry)]}\n\n${history || '尚无确认记录'}`;
  });
  return [app.name + ' · 需求依据与确认记录', '确认人及依据由记录者填写；团队发布操作按现有账号审计。', ...sections].join('\n\n');
}
