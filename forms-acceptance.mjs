import {createCase, applyOperation, validateWorkflow} from './forms-model.mjs';

export function sampleValue(field) {
  if (field.type === 'table') return JSON.stringify([Object.fromEntries(field.columns.map(column => [column.id, sampleValue(column)]))]);
  if (field.type === 'number') return String(field.min ?? Math.min(1, field.max ?? 1));
  if (field.type === 'date') return '2026-11-02';
  if (field.type === 'boolean') return 'false';
  if (field.type === 'select') return field.options[0];
  if (field.type === 'reference') return 'sample-related-id';
  return '验证填写';
}

function stageValues(template, owner, overrides = {}) {
  const values = Object.fromEntries(template.fields.filter(field => field.owner === owner).map(field => [field.id, sampleValue(field)]));
  for (const rule of template.decisionRules ?? []) {
    if (rule.stageId !== owner || values[rule.fieldId] !== rule.equals) continue;
    const field = template.fields.find(item => item.id === rule.fieldId);
    const alternative = field.options?.find(value => !(template.decisionRules ?? []).some(item => item.stageId === owner && item.fieldId === field.id && item.equals === value));
    if (alternative !== undefined) values[field.id] = alternative;
  }
  for (const field of template.fields.filter(item => item.owner === owner)) {
    if (Object.hasOwn(overrides, field.id)) values[field.id] = overrides[field.id];
  }
  return values;
}

export function scenarioSampleValues(template) {
  return Object.assign({}, ...['draft', ...template.workflow.map(stage => stage.id)].map(owner => stageValues(template, owner)));
}

export function verifyTemplate(template, overrides) {
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) throw Error('场景输入格式无效');
  for (const [id, value] of Object.entries(overrides ?? {})) {
    if (!template.fields.some(field => field.id === id) || typeof value !== 'string' || value.length > 20000) throw Error('场景输入包含未知字段或超长内容');
  }
  validateWorkflow(template.workflow);
  const results = [];
  let steps = [];
  const ensure = (condition, message) => { if (!condition) throw Error(message); };
  const state = record => ({recordId: record.id, status: record.status, stage: record.status === 'complete' ? '归档' : record.status === 'draft' ? '填报' : template.workflow[record.step].label,
    revision: record.revision, events: record.events.length});
  function perform(record, operation) {
    const before = state(record);
    const trace = {action: operation.type, role: operation.role, input: structuredClone(operation.values ?? {}), note: operation.note ?? '', before};
    steps.push(trace);
    try {
      const next = applyOperation(record, operation);
      Object.assign(trace, {outcome: 'accepted', after: state(next), changes: next.events.length > record.events.length ? next.events.at(-1).diff : []});
      return next;
    } catch (error) {
      Object.assign(trace, {outcome: 'rejected', after: state(record), message: error.message, changes: []});
      throw error;
    }
  }
  function rejects(record, operation) {
    const before = JSON.stringify(record);
    let rejected = false;
    try { perform(record, operation); } catch { rejected = true; }
    ensure(rejected, '预期拒绝但操作成功');
    ensure(JSON.stringify(record) === before, '拒绝后输入记录发生变化');
  }
  function check(name, title, expected, operation) {
    steps = [];
    try {
      operation();
      results.push({name, title, expected, passed: true, actual: '执行结果符合预期', steps});
    } catch (error) {
      results.push({name, title, expected, passed: false, actual: error.message, error: error.message, steps});
    }
  }
  let record = createCase(template, {role: template.submitterRole ?? '填报人'});
  const id = record.id;
  for (let stage = -1; stage < template.workflow.length; stage++) {
    const owner = stage < 0 ? 'draft' : template.workflow[stage].id;
    const label = stage < 0 ? '填报' : template.workflow[stage].label;
    const role = stage < 0 ? record.submitter : template.workflow[stage].role;
    const type = stage < 0 ? 'submit' : 'advance';
    const values = stageValues(template, owner, overrides);
    check(owner + ': wrong role', label + ' · 错误角色', '拒绝办理，记录及修订保持原值', () => rejects(record, {type, role: role + '-wrong', values}));
    for (const field of template.fields.filter(item => item.owner === owner && item.required)) {
      check(owner + ': required ' + field.id, label + ' · 缺少' + field.label, '拒绝流转并提示必填项，记录保持原值', () => rejects(record, {type, role, values: {...values, [field.id]: ''}}));
    }
    if (stage >= 0 && template.workflow[stage].kind !== 'receipt') {
      check(owner + ': return', label + ' · 退回并重新提交', '要求填写退回原因，返回指定阶段；重新办理可回到原阶段，编号和历史保留', () => {
        rejects(record, {type: 'return', role});
        let returned = perform(record, {type: 'return', role, note: '补充资料'});
        const target = template.workflow[stage].returnTo ?? 'draft';
        ensure(returned.step === (target === 'draft' ? -1 : template.workflow.findIndex(item => item.id === target)), '退回目标不一致');
        ensure(returned.id === id && returned.events.length === record.events.length + 1, '历史或编号丢失');
        for (let index = returned.step; index < stage; index++) {
          const nextOwner = index < 0 ? 'draft' : template.workflow[index].id;
          returned = perform(returned, {type: index < 0 ? 'submit' : 'advance', role: index < 0 ? returned.submitter : template.workflow[index].role, values: stageValues(template, nextOwner, overrides)});
          ensure(returned.step === index + 1, '样例未能回到原办理阶段，请核对条件和输入');
        }
        ensure(returned.step === stage && returned.id === id, '重提后阶段或编号不一致');
      });
    }
    for (const rule of (template.decisionRules ?? []).filter(item => item.stageId === owner)) {
      check(owner + ': condition ' + rule.fieldId + '=' + rule.equals, label + ' · 条件退回', '命中条件时要求填写原因，并返回规则指定的阶段', () => {
        const input = {...values, [rule.fieldId]: rule.equals};
        rejects(record, {type, role, values: input});
        const returned = perform(record, {type, role, values: input, note: '条件退回验证'});
        ensure(returned.step === (rule.returnTo === 'draft' ? -1 : template.workflow.findIndex(item => item.id === rule.returnTo)), '条件退回目标不一致');
        ensure(returned.id === id, '条件退回改变了编号');
      });
    }
    check(owner + ': advance and replay', label + ' · 继续、重试与旧版本', '继续到下一阶段；重复请求保持一次业务效果；旧修订保存被拒绝', () => {
      const before = record;
      const operation = {type, role, values, operationId: 'verify-' + owner, expectedRevision: record.revision};
      const next = perform(record, operation);
      ensure(next.id === id, '编号改变');
      ensure(next.step === stage + 1, '样例未进入下一阶段，请核对条件和输入');
      ensure(JSON.stringify(perform(next, operation)) === JSON.stringify(next), '重复操作改变记录');
      rejects(next, {type: 'save', role, expectedRevision: before.revision});
      record = next;
    });
  }
  check('archived immutable', '归档后保护', '完成归档后拒绝继续修改', () => {
    ensure(record.status === 'complete', '未完成归档');
    rejects(record, {type: 'save', role: record.submitter});
  });
  const report = {scope: '本地业务规则，未验证生产服务、身份或数据库权限', passed: results.every(item => item.passed), results};
  if (overrides !== undefined) Object.assign(report, {inputMode: 'custom', inputs: {...scenarioSampleValues(template), ...overrides}});
  return report;
}
