import {discoveryFields} from './apps-model.mjs';

const labels = {
  ...Object.fromEntries(discoveryFields), discovery: '需求工作单',
  requirements: '需求依据', statement: '需求描述', origin: '记录来源', target: '关联对象', reviews: '确认历史',
  runs: '样例场景历史',
  title: '名称', name: '名称', version: '版本', code: '表号', source: '来源',
  submitterRole: '发起角色', fields: '填写区', workflow: '办理流程', summaryFields: '清单摘要',
  templateIds: '应用表式', relations: '单据关联', bindings: '项目资料带入',
  label: '名称', type: '类型', owner: '填写阶段', required: '必填', options: '可选值',
  min: '最小值', max: '最大值', unit: '单位', columns: '明细列', sum: '合计',
  role: '办理角色', kind: '办理方式', returnTo: '退回阶段', confirmation: '确认状态',
  evidence: '依据', blocks: '原表布局', decisionRules: '条件规则', warnings: '表式说明',
  contractor: '施工单位', description: '说明'
};
const types = {text: '文字', number: '数字', date: '日期', boolean: '是 / 否', select: '单选', reference: '关联业务', table: '明细表'};
const kinds = {review: '审核', receipt: '签收', issue: '签发'};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function layoutDescription(blocks) {
  const counts = {paragraphs: 0, tables: 0, cells: 0, merged: 0};
  function visit(list) {
    for (const block of list) {
      if (block.type === 'paragraph') { counts.paragraphs++; continue; }
      counts.tables++;
      for (const row of block.rows) for (const cell of row) {
        counts.cells++;
        if (cell.colspan > 1 || cell.rowspan > 1) counts.merged++;
        visit(cell.blocks);
      }
    }
  }
  visit(blocks);
  return `${counts.paragraphs} 段文字 · ${counts.tables} 个表格 · ${counts.cells} 个单元格 · ${counts.merged} 处合并。展开原表布局对照可查看内容。`;
}

function display(key, value, definition, templates) {
  if (key === 'summaryFields' && value === undefined) return '自动摘要';
  if (value === undefined) return '未设置';
  if (key === 'blocks') return layoutDescription(value);
  if (key === 'origin') return {manual: '人工录入', ai: 'AI 建议'}[value] ?? String(value);
  if (key === 'target') {
    const template = templates.find(item => item.id === value.templateId);
    const target = value.kind === 'field' ? template?.fields.find(item => item.id === value.id) : template?.workflow.find(item => item.id === value.id);
    return `${template?.title ?? value.templateId} / ${value.kind === 'template' ? '整份表式' : target?.label ?? value.id}`;
  }
  if (key === 'reviews') return value.map(review => `确认人 ${review.reviewer}\n记录时间 ${review.at}\n确认依据 ${review.evidence}\n对应表式版本 ${JSON.parse(review.definition).template.version ?? '未记录'}`).join('\n\n') || '尚无确认记录';
  if (key === 'runs') return value.map(run => `${run.at}\n${run.report.scope}\n${run.report.results.filter(result => result.passed).length} / ${run.report.results.length} 项通过`).join('\n\n') || '尚无场景运行';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (key === 'type') return types[value] ?? String(value);
  if (key === 'kind') return kinds[value] ?? String(value);
  if (key === 'confirmation') return {pending: '待确认', confirmed: '已确认'}[value] ?? String(value);
  if (key === 'owner' || key === 'returnTo') return value === 'draft' ? '填报阶段' : definition.workflow?.find(step => step.id === value)?.label ?? String(value);
  if (key === 'summaryFields') return value.length ? value.map(id => definition.fields.find(field => field.id === id)?.label ?? id).join(' → ') : '自动摘要';
  if (key === 'templateIds') return value.map(id => templates.find(template => template.id === id)?.title ?? id).join('、');
  if (key === 'relations') return value.map(relation => {
    const source = templates.find(template => template.id === relation.from);
    const target = templates.find(template => template.id === relation.to);
    const mappings = relation.mappings.map(mapping => `${source?.fields.find(field => field.id === mapping.from)?.label ?? mapping.from} → ${target?.fields.find(field => field.id === mapping.to)?.label ?? mapping.to}`).join('、');
    return `${relation.label} · ${source?.title ?? relation.from} → ${target?.title ?? relation.to}\n带入 ${mappings || '无'}`;
  }).join('\n');
  if (key === 'bindings') return value.map(binding => {
    const template = templates.find(template => template.id === binding.templateId);
    return `${template?.title ?? binding.templateId} / ${template?.fields.find(field => field.id === binding.fieldId)?.label ?? binding.fieldId} ← 项目${labels[binding.key] ?? binding.key}`;
  }).join('\n');
  if (key === 'decisionRules') return value.map(rule => {
    const field = definition.fields.find(field => field.id === rule.fieldId);
    const stage = definition.workflow.find(step => step.id === rule.stageId);
    return `${stage?.label ?? rule.stageId} · ${field?.label ?? rule.fieldId}为“${rule.equals}”时退回${display('returnTo', rule.returnTo, definition, templates)}`;
  }).join('\n');
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join('、');
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

export function definitionDetails(previous, next, beforeTemplates, afterTemplates) {
  const details = [];
  function properties(before, after, path) {
    for (const key of Object.keys({...before, ...after})) {
      if (key === 'id' || (key === 'version' && path.length === 0) || same(before?.[key], after?.[key])) continue;
      const heading = [...path, labels[key] ?? key];
      if (key === 'discovery') {
        properties(before?.[key], after?.[key], heading);
      } else if (['fields', 'workflow', 'columns', 'requirements'].includes(key)) {
        const oldItems = before?.[key] ?? [], newItems = after?.[key] ?? [];
        const oldById = new Map(oldItems.map(item => [item.id, item]));
        const newById = new Map(newItems.map(item => [item.id, item]));
        if (!same(oldItems.map(item => item.id), newItems.map(item => item.id))) {
          details.push({path: [...heading, '排列顺序'].join(' / '), before: oldItems.map(item => item.label ?? item.statement).join(' → ') || '无', after: newItems.map(item => item.label ?? item.statement).join(' → ') || '无'});
        }
        for (const id of new Set([...oldItems, ...newItems].map(item => item.id))) {
          const oldItem = oldById.get(id), newItem = newById.get(id);
          const itemPath = [...heading, newItem?.label ?? newItem?.statement ?? oldItem.label ?? oldItem.statement];
          if (!oldItem || !newItem) details.push({path: itemPath.join(' / '), before: oldItem ? '存在' : '无', after: newItem ? '新增' : '移除'});
          properties(oldItem, newItem, itemPath);
        }
      } else {
        details.push({path: heading.join(' / '), before: display(key, before?.[key], previous ?? {}, beforeTemplates), after: display(key, after?.[key], next, afterTemplates)});
      }
    }
  }
  properties(previous, next, []);
  return details;
}
