import {runApplicationScenario, applicationScenarioText} from './apps-scenarios.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDemo} from './apps-demo.mjs';
import {startProjectCase, applicationPackage, createProject, validateRelation, discoveryFields, discoveryText} from './apps-model.mjs';
import {applyOperation} from './forms-model.mjs';
import {validateWorkspace, upgradeWorkspace, commitWorkspace} from './forms-store.mjs';
import {proposeRule, acceptRule} from './forms-rules.mjs';
import {typedValues} from './forms-schema.mjs';
import {printableForm} from './forms-print.mjs';
import {verifyTemplate} from './forms-acceptance.mjs';
import {formSql, formSystem, formOpenApi} from './forms-system.mjs';
import {PGlite} from '@electric-sql/pglite';

test('discovery worksheet survives application export and rejects malformed imports without changing saved state', async () => {
  const original = applicationDemo();
  assert.equal(upgradeWorkspace(original).applications[0].discovery, undefined);
  assert.match(discoveryText(original.applications[0]), /待确认/);
  const draft = structuredClone(original);
  const discovery = {version: 1, ...Object.fromEntries(discoveryFields.map(([key]) => [key, '']))};
  discovery.problem = '现场整改重复录入';
  discovery.sources = '样例指令单\n2025 版，第 2 页';
  draft.applications[0].discovery = discovery;
  const restored = upgradeWorkspace(applicationPackage(draft, draft.applications[0].id));
  assert.deepEqual(restored.applications[0].discovery, discovery);
  assert.match(discoveryText(restored.applications[0]), /2025 版，第 2 页/);
  for (const bad of [null, [], {...discovery, version: 2}, {...discovery, owner: 1}, {...discovery, problem: 'x'.repeat(8001)}, {...discovery, approved: true}]) {
    const incoming = structuredClone(draft);
    incoming.applications[0].discovery = bad;
    assert.throws(() => validateWorkspace(incoming));
  }
  await assert.rejects(commitWorkspace(original, next => { next.applications[0].discovery = discovery; }, async () => { throw Error('WORKSPACE_CONFLICT'); }), /WORKSPACE_CONFLICT/);
  assert.equal(original.applications[0].discovery, undefined);
  assert.equal(draft.applications[0].discovery.problem, '现场整改重复录入');
});

function operate(workspace, record, type, values = {}, note = '') {
  const role = record.status === 'draft' ? record.submitter : record.template.workflow[record.step].role;
  const next = applyOperation(record, {type, role, values, note});
  workspace.cases[workspace.cases.findIndex(item => item.id === next.id)] = next;
  return next;
}

function finishInstruction(workspace) {
  let record = workspace.cases[0];
  record = operate(workspace, record, 'submit', {'instruction-no': 'ZG-01', issue: '补齐资料', deadline: '2026-11-05', items: JSON.stringify([{position: 'A', issue: '缺附件', quantity: '2'}, {position: 'B', issue: '缺照片', quantity: '3'}])});
  return operate(workspace, record, 'advance', {'issue-note': '已确认'});
}

test('three documents retain mappings, conditional return, identity and continue after application restore', () => {
  let workspace = applicationDemo();
  const source = finishInstruction(workspace);
  const options = {appId: source.appId, projectId: source.projectId, templateId: 'app-reply', sourceId: source.id, relationId: 'instruction-reply'};
  let {record: reply} = startProjectCase(workspace, options);
  workspace.cases.push(reply);
  assert.equal(reply.values['instruction-no'], 'ZG-01');
  assert.equal(reply.values.project, source.values.project);
  assert.equal(reply.link.sourceRevision, source.revision);
  assert.equal(startProjectCase(workspace, options).record.id, reply.id);
  assert.equal(startProjectCase(workspace, options).existing, true);
  reply = operate(workspace, reply, 'submit', {response: '已补齐', date: '2026-11-03'});
  assert.throws(() => operate(workspace, reply, 'advance', {result: '不通过', 'review-note': '补照片'}), /原因/);
  reply = operate(workspace, reply, 'advance', {result: '不通过', 'review-note': '补照片'}, '缺少照片编号');
  assert.equal(reply.status, 'draft');
  const restored = applicationPackage(workspace, source.appId);
  workspace = upgradeWorkspace(JSON.parse(JSON.stringify(restored)));
  reply = workspace.cases.find(item => item.id === reply.id);
  reply = operate(workspace, reply, 'submit', {response: '已补照片编号'});
  reply = operate(workspace, reply, 'advance', {result: '通过', 'review-note': '已核对'});
  const {record: review} = startProjectCase(workspace, {...options, sourceId: reply.id, templateId: 'app-recheck', relationId: 'reply-recheck'});
  workspace.cases.push(review);
  assert.equal(review.values.response, '已补照片编号');
  assert.equal(review.values.result, '通过');
  const submitted = operate(workspace, review, 'submit');
  assert.equal(operate(workspace, submitted, 'advance', {'archive-no': 'ARCH-1'}).status, 'complete');
  assert.equal(validateWorkspace(workspace).cases.length, 3);
  assert.equal(workspace.cases[0].values.items, source.values.items);
});

test('application relationships reject cross-project links, missing upstream and cycles', () => {
  const workspace = applicationDemo();
  const source = finishInstruction(workspace);
  const project = createProject(source.appId, '第二项目'); workspace.projects.push(project);
  const options = {appId: source.appId, projectId: project.id, templateId: 'app-reply', sourceId: source.id, relationId: 'instruction-reply'};
  assert.throws(() => startProjectCase(workspace, options), /项目/);
  assert.throws(() => startProjectCase(workspace, {...options, sourceId: undefined, relationId: undefined}), /上游/);
  assert.throws(() => validateRelation(workspace.applications[0], {id: 'cycle', label: '循环', from: 'app-recheck', to: 'app-instruction', mappings: []}, workspace.templates), /循环/);
});

test('detail drafts allow incomplete cells but submit validates every required column and print escapes values', () => {
  const workspace = applicationDemo(); const original = workspace.cases[0];
  const base = {'instruction-no': '1', issue: '问题', deadline: '2026-11-04'};
  const draft = applyOperation(original, {type: 'save', role: original.submitter, values: {...base, items: '[{"position":"A"}]'}});
  assert.throws(() => applyOperation(draft, {type: 'submit', role: original.submitter}), /检查明细/);
  assert.throws(() => applyOperation(original, {type: 'save', role: original.submitter, values: {items: '[{"quantity":"-1"}]'}}), /范围/);
  const saved = applyOperation(original, {type: 'submit', role: original.submitter, values: {...base, items: '[{"position":"<script>","issue":"缺项","quantity":"3"}]'}});
  assert.equal(typedValues(saved.template, saved.values).items[0].quantity, 3);
  assert.match(printableForm(saved), /&lt;script&gt;/);
  assert.match(printableForm(saved), /<th>检查部位<\/th>/);
});

test('natural language changes require explicit acceptance and reject stale or ambiguous proposals', () => {
  const template = applicationDemo().templates[1];
  assert.equal(proposeRule(template, '复查不通过就退回施工单位').template.decisionRules[0].returnTo, 'draft');
  const before = JSON.stringify(template);
  const proposal = proposeRule(template, '当复查结论为“不通过”时退回施工单位');
  assert.equal(JSON.stringify(template), before);
  const applied = acceptRule(template, proposal);
  assert.equal(applied.decisionRules[0].returnTo, 'draft');
  assert.equal(applied.version, template.version + 1);
  assert.throws(() => acceptRule(applied, proposal), /改变/);
  assert.throws(() => proposeRule(template, '自动帮我做所有审批'), /句式/);
  assert.equal(proposeRule(template, '整改说明设为选填').template.fields.find(item => item.id === 'response').required, false);
  assert.equal(proposeRule(template, '监理复查由复核员办理').template.workflow[0].role, '复核员');
});

test('failed multi-document creation never mutates the committed workspace', async () => {
  const workspace = applicationDemo(); const source = finishInstruction(workspace); const before = JSON.stringify(workspace);
  const result = startProjectCase(workspace, {appId: source.appId, projectId: source.projectId, templateId: 'app-reply', sourceId: source.id, relationId: 'instruction-reply'});
  await assert.rejects(commitWorkspace(workspace, next => next.cases.push(result.record), async () => { throw Error('quota'); }), /quota/);
  assert.equal(JSON.stringify(workspace), before);
});

test('all application templates pass local verifier and export usable array schema and SQL', async () => {
  const workspace = applicationDemo();
  for (const template of workspace.templates) {
    const report = verifyTemplate(template);
    assert.ok(report.passed, JSON.stringify(report));
  }
  const template = workspace.templates[0], system = formSystem(template);
  assert.equal(formOpenApi(template).components.schemas.BusinessValues.properties.items.type, 'array');
  const db = new PGlite();
  try {
    await db.exec(formSql(template));
    await db.query("INSERT INTO business_records VALUES ('a','p',$1,1,'draft',-1,0,null)", [template.id]);
    await db.exec(`INSERT INTO "${system.table}" (record_id,"${system.columns.items}") VALUES ('a','[]')`);
    await assert.rejects(db.exec(`UPDATE "${system.table}" SET "${system.columns.items}"='{}'`));
  } finally { await db.close(); }
});


test('cross-form scenarios execute the instruction reply archive chain without touching customer records', () => {
  const workspace = applicationDemo(), before = structuredClone(workspace);
  const report = runApplicationScenario(workspace, workspace.applications[0].id);
  assert.equal(report.passed, true);
  assert.equal(report.records.length, 3);
  assert.deepEqual(workspace, before);
  const [instruction, reply, archive] = report.records;
  assert.equal(reply.relatedId, instruction.id);
  assert.equal(archive.relatedId, reply.id);
  assert.ok(report.records.every(record => record.status === 'complete'));
  assert.ok(report.records.every(record => record.projectId === report.project.id));
  assert.ok(report.results.some(result => result.title.includes('上游未完成') && result.passed));
  assert.ok(report.results.some(result => result.title.includes('项目隔离') && result.passed));
  for (const record of [reply, archive]) {
    const source = report.records.find(item => item.id === record.relatedId);
    assert.equal(record.link.sourceRevision, source.revision);
    for (const mapping of record.link.mappings) assert.equal(record.values[mapping.to], source.values[mapping.from]);
  }
  assert.ok(report.attempts.every(attempt => attempt.outcome === 'accepted' && attempt.after.revision === attempt.before.revision + 1));
  assert.match(applicationScenarioText(report), /提交 · 填报/);
  assert.ok(!applicationScenarioText(report).includes('undefined'));
});

test('cross-form failures retain attempted inputs and do not fabricate completed downstream work', () => {
  const workspace = applicationDemo();
  const reply = workspace.templates.find(item => item.id === 'app-reply');
  reply.fields.find(field => field.id === 'result').options = ['不通过'];
  const before = structuredClone(workspace);
  const report = runApplicationScenario(workspace, workspace.applications[0].id);
  assert.equal(report.passed, false);
  assert.deepEqual(workspace, before);
  assert.equal(report.records.length, 2);
  assert.equal(report.records[1].status, 'active');
  const failed = report.attempts.find(attempt => attempt.outcome === 'rejected');
  assert.equal(failed.operation.values.result, '不通过');
  assert.deepEqual(failed.after, failed.before);
  assert.match(applicationScenarioText(report), /条件触发退回/);
  assert.ok(report.results.some(result => result.title === '应用链路覆盖' && !result.passed));
});


test('cross-form traversal follows each branch and stops bounded expansion explicitly', () => {
  const workspace = applicationDemo(), app = workspace.applications[0];
  app.relations.push({id: 'direct-archive', label: '直接归档分支', from: app.templateIds[0], to: app.templateIds[2], mappings: []});
  const report = runApplicationScenario(workspace, app.id);
  assert.equal(report.passed, true);
  assert.equal(report.records.length, 4);
  assert.equal(report.records.filter(record => record.template.id === app.templateIds[2]).length, 2);
  const many = applicationDemo(), manyApp = many.applications[0];
  manyApp.relations = [];
  for (let i = 0; i < 101; i++) manyApp.relations.push({id: 'branch-' + i, label: '分支 ' + i, from: manyApp.templateIds[0], to: manyApp.templateIds[1], mappings: []});
  const bounded = runApplicationScenario(many, manyApp.id);
  assert.equal(bounded.records.length, 100);
  assert.equal(bounded.passed, false);
  assert.match(bounded.results.at(-1).actual, /超过 100/);
});
