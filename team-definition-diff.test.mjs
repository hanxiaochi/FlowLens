import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDemo} from './apps-demo.mjs';
import {definitionDetails} from './team-definition-diff.mjs';
import {saveRequirement, confirmRequirement, requirementDefinition} from './apps-requirements.mjs';

test('requirement diffs show source, target and review evidence in readable sections', () => {
  const fixture = applicationDemo();
  const before = fixture.applications[0], template = fixture.templates[0];
  let after = saveRequirement(before, fixture.templates, {statement: '项目名称来自项目资料', source: '虚构访谈第 1 页', origin: 'ai', target: {templateId: template.id, kind: 'field', id: template.fields[0].id}});
  const id = after.requirements[0].id;
  after = confirmRequirement(after, fixture.templates, id, {reviewer: '业务代表', evidence: '按样例核对', expectedDefinition: requirementDefinition(after, fixture.templates, id)});
  const details = definitionDetails(before, after, fixture.templates, fixture.templates);
  assert.ok(details.some(item => item.path.endsWith('/ 记录来源') && item.after === 'AI 建议'));
  assert.ok(details.some(item => item.path.endsWith('/ 关联对象') && item.after === '监理指令单 / 项目名称'));
  assert.ok(details.some(item => item.path.endsWith('/ 来源') && item.after === '虚构访谈第 1 页'));
  const reviews = details.find(item => item.path.endsWith('/ 确认历史'));
  assert.match(reviews.after, /业务代表/);
  assert.match(reviews.after, /按样例核对/);
  assert.ok(!reviews.after.includes('"bindings"'));
});

test('definition differences explain fields, detail columns, workflows and summary selections', () => {
  const fixture = applicationDemo(), before = fixture.templates[0], after = structuredClone(before);
  after.fields.find(field => field.id === 'issue').required = false;
  after.fields.find(field => field.id === 'issue').owner = 'issue';
  after.fields.find(field => field.id === 'items').columns[2].sum = false;
  after.workflow[0].role = '复查负责人';
  after.summaryFields = ['instruction-no', 'issue'];
  const rows = definitionDetails(before, after, fixture.templates, [after, ...fixture.templates.slice(1)]);
  assert.ok(rows.some(row => row.path === '填写区 / 问题及要求 / 必填' && row.before === '是' && row.after === '否'));
  assert.ok(rows.some(row => row.path === '填写区 / 问题及要求 / 填写阶段' && row.before === '填报阶段' && row.after === '指令签发'));
  assert.ok(rows.some(row => row.path === '填写区 / 检查明细 / 明细列 / 数量 / 合计' && row.after === '否'));
  assert.ok(rows.some(row => row.path === '办理流程 / 指令签发 / 办理角色' && row.after === '复查负责人'));
  assert.ok(rows.some(row => row.path === '清单摘要' && row.after === '指令编号 → 问题及要求'));
  assert.deepEqual(definitionDetails(before, structuredClone(before), fixture.templates, fixture.templates), []);
});

test('definition differences retain removal, ordering and readable relationship mappings', () => {
  const fixture = applicationDemo(), before = fixture.templates[0], after = structuredClone(before);
  after.fields = after.fields.filter(field => field.id !== 'deadline').reverse();
  const rows = definitionDetails(before, after, fixture.templates, [after, ...fixture.templates.slice(1)]);
  assert.ok(rows.some(row => row.path === '填写区 / 整改期限' && row.after === '移除'));
  assert.ok(rows.some(row => row.path === '填写区 / 排列顺序' && row.before !== row.after));
  const app = fixture.applications[0], nextApp = structuredClone(app);
  nextApp.relations[0].mappings.pop(); nextApp.bindings.pop();
  const mappings = definitionDetails(app, nextApp, fixture.templates, fixture.templates);
  assert.ok(mappings.find(row => row.path === '单据关联').before.includes('监理指令单 → 整改回复单'));
  assert.ok(mappings.find(row => row.path === '单据关联').before.includes('问题及要求 → 原指令要求'));
  assert.ok(mappings.find(row => row.path === '项目资料带入').before.includes('施工单位 ← 项目施工单位'));
});
