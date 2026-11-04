import {startProjectCase} from './apps-model.mjs';
import {applyOperation, missingRequired} from './forms-model.mjs';
import {validateFieldValue} from './forms-schema.mjs';

export const csvLimits = {bytes: 2 * 1024 * 1024, rows: 500, columns: 200};

export function parseCsv(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > csvLimits.bytes) throw Error('CSV 最大 2 MiB，请拆分后导入');
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let values = [], value = '', quoted = false, closed = false, started = false, line = 1, rowLine = 1;
  function finishField() {
    values.push(value); value = ''; closed = false;
    if (values.length > csvLimits.columns) throw Error(`第 ${rowLine} 行超过 200 列`);
  }
  function finishRow() {
    if (started) { finishField(); rows.push({line: rowLine, values}); }
    values = []; value = ''; closed = false; started = false;
    if (rows.length > csvLimits.rows + 1) throw Error('每批最多 500 行业务，请拆分后导入');
  }
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { value += '"'; index++; }
        else { quoted = false; closed = true; }
      } else {
        value += character;
        if (character === '\n' || character === '\r' && text[index + 1] !== '\n') line++;
      }
      continue;
    }
    if (character === '\r' || character === '\n') {
      finishRow();
      if (character === '\r' && text[index + 1] === '\n') index++;
      rowLine = ++line;
      continue;
    }
    started = true;
    if (character === ',') { finishField(); continue; }
    if (closed) throw Error(`第 ${line} 行的引号后应为逗号或换行`);
    if (character === '"') {
      if (value.length) throw Error(`第 ${line} 行的引号必须从单元格开头开始`);
      quoted = true;
    } else value += character;
  }
  if (quoted) throw Error(`第 ${rowLine} 行有未闭合的引号`);
  finishRow();
  const headers = rows.shift()?.values.map(header => header.trim()) ?? [];
  if (!headers.length || headers.some(header => !header)) throw Error('CSV 第一行需包含非空列名');
  if (new Set(headers).size !== headers.length) throw Error('CSV 列名重复，请修改后重新导入');
  if (!rows.length) throw Error('CSV 没有业务数据行');
  return {headers, rows};
}

export function prepareCsvImport(workspace, input) {
  const table = parseCsv(input.csv);
  const project = workspace.projects.find(item => item.id === input.projectId);
  const template = workspace.templates.find(item => item.id === input.templateId);
  if (!project || !template) throw Error('请选择项目和表式');
  const application = workspace.applications.find(item => item.id === project.appId);
  // Use the normal creation path to enforce application membership and upstream relations.
  const initial = startProjectCase(workspace, {appId: project.appId, projectId: project.id, templateId: template.id}).record;
  const fields = template.fields.filter(field => field.owner === 'draft');
  const mapping = input.mapping;
  if (!Array.isArray(mapping) || mapping.length !== table.headers.length || mapping.some(id => typeof id !== 'string' || id && !fields.some(field => field.id === id))) throw Error('请为每列选择填写字段或忽略此列');
  const mapped = mapping.filter(Boolean);
  if (!mapped.length || new Set(mapped).size !== mapped.length) throw Error('至少映射一个字段，同一字段不能映射多列');
  const records = [], rows = [];
  for (const source of table.rows) {
    const errors = [], warnings = [], values = {};
    if (source.values.length !== table.headers.length) errors.push(`列数为 ${source.values.length}，应为 ${table.headers.length}`);
    else for (let column = 0; column < mapping.length; column++) {
      const id = mapping[column];
      if (!id) continue;
      const field = fields.find(item => item.id === id);
      const value = source.values[column];
      try { validateFieldValue(field, value); }
      catch (error) { errors.push(error.message); }
      Object.defineProperty(values, id, {value, enumerable: true});
      if (Object.hasOwn(initial.values, id) && initial.values[id] !== value) warnings.push({field: field.label, before: initial.values[id], after: value, reason: '覆盖项目带入值'});
    }
    let record;
    if (!errors.length) {
      record = startProjectCase(workspace, {appId: project.appId, projectId: project.id, templateId: template.id}).record;
      record = applyOperation(record, {type: 'save', role: record.submitter, values, note: `CSV 导入，第 ${source.line} 行，请核对后提交`});
      records.push(record);
    }
    rows.push({line: source.line, values, errors, warnings, missingRequired: record ? missingRequired(record, 'draft').map(field => field.label) : []});
  }
  return {project, template, application, headers: table.headers, fields, rows, records, ready: rows.every(row => !row.errors.length)};
}
