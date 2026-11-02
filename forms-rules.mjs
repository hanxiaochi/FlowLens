import {validateFieldValue} from './forms-schema.mjs';

export function validateDecisionRules(template) {
  const rules = template.decisionRules ?? [];
  if (!Array.isArray(rules) || rules.length > 30) throw Error('条件规则数量无效');
  const seen = new Set();
  for (const rule of rules) {
    const field = template.fields.find(item => item.id === rule.fieldId);
    const index = template.workflow.findIndex(item => item.id === rule.stageId);
    const destination = template.workflow.findIndex(item => item.id === rule.returnTo);
    if (!field || field.owner !== rule.stageId || index < 0 || template.workflow[index].kind === 'receipt') throw Error('退回条件需关联审核阶段的字段');
    if (rule.returnTo !== 'draft' && (destination < 0 || destination >= index)) throw Error('条件退回目标必须在当前阶段之前');
    validateFieldValue(field, rule.equals);
    if (!rule.equals.trim() || field.type === 'table') throw Error('请选择明确的单值退回条件');
    const key = rule.stageId + '/' + rule.fieldId + '/' + rule.equals;
    if (seen.has(key)) throw Error('同一条件存在重复规则');
    seen.add(key);
  }
}

function unique(items, description) {
  if (items.length !== 1) throw Error(description + '需要唯一匹配，请使用表中的完整名称');
  return items[0];
}

export function proposeRule(template, input) {
  let text = input.trim().replace(/[。！!]$/, '');
  if (text.length > 500) throw Error('请一次描述一条规则，最多 500 字');
  const shortReturn = text.match(/^(.+?)(?:就)退回(.+)$/);
  if (shortReturn) {
    const candidates = [];
    for (const field of template.fields.filter(item => item.type === 'select')) {
      const stage = template.workflow.find(item => item.id === field.owner);
      if (!stage) continue;
      for (const option of field.options) {
        if ([stage.label + option, field.label.replace(/结论$/, '') + option].includes(shortReturn[1])) candidates.push({field, option});
      }
    }
    const candidate = unique(candidates, '条件语句');
    text = `当${candidate.field.label}为${candidate.option}时退回${shortReturn[2]}`;
  }
  const next = structuredClone(template);
  let explanation;
  let match = text.match(/^(?:把|将)?(.+?)(?:设为|改为)(必填|选填)$/);
  if (match) {
    const field = unique(next.fields.filter(item => item.label === match[1]), '字段');
    field.required = match[2] === '必填';
    explanation = `${field.label}改为${match[2]}，办理其负责阶段时检查`;
  } else if ((match = text.match(/^(.+?)由(.+?)办理$/))) {
    const stage = unique(next.workflow.filter(item => item.label === match[1]), '办理阶段');
    if (match[2].length > 100) throw Error('角色名称过长');
    explanation = `${stage.label}的办理角色从${stage.role}改为${match[2]}`;
    stage.role = match[2];
  } else {
    match = text.match(/^当(.+?)为[“「"]?(.+?)[”」"]?时(?:就)?退回(.+)$/);
    if (!match) throw Error('支持的句式包括“整改说明设为必填”“监理复查由专业监理办理”“当复查结论为不通过时退回填报”');
    const field = unique(next.fields.filter(item => item.label === match[1]), '条件字段');
    const stage = unique(next.workflow.filter(item => item.id === field.owner), '条件所属阶段');
    const before = next.workflow.slice(0, next.workflow.indexOf(stage));
    const target = ['填报', '填报人', next.submitterRole].includes(match[3]) ? 'draft' : unique(before.filter(item => item.label === match[3] || item.role === match[3]), '退回目标').id;
    validateFieldValue(field, match[2]);
    next.decisionRules = (next.decisionRules ?? []).filter(item => !(item.stageId === stage.id && item.fieldId === field.id && item.equals === match[2]));
    next.decisionRules.push({stageId: stage.id, fieldId: field.id, equals: match[2], returnTo: target});
    explanation = `${stage.label}点击继续时，如果${field.label}为“${match[2]}”，保存本次意见并退回${match[3]}，要求填写退回原因`;
  }
  validateDecisionRules(next);
  next.version++;
  return {templateId: template.id, baseVersion: template.version, text, explanation, template: next};
}

export function acceptRule(current, proposal) {
  if (current.id !== proposal.templateId || current.version !== proposal.baseVersion) throw Error('模板在预览后已改变，请重新生成草案');
  validateDecisionRules(proposal.template);
  return structuredClone(proposal.template);
}
