import {scenarioSampleValues} from './forms-acceptance.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDemo} from './apps-demo.mjs';
import {applicationPackage} from './apps-model.mjs';
import {upgradeWorkspace} from './forms-store.mjs';
import {prepareProjectRestore} from './team-project-restore.mjs';
import {recordRequirementObservation, observationStatus, observationText, saveRequirement, confirmRequirement, requirementDefinition, requirementStatus, validateRequirements, requirementsText, requirementDefinitionText, runRequirementScenario, scenarioRunStatus, scenarioRunText, retainRequirementHistory} from './apps-requirements.mjs';

function fixture(kind = 'field') {
  const workspace = applicationDemo();
  const template = workspace.templates[0];
  const targetId = kind === 'field' ? template.fields[0].id : kind === 'stage' ? template.workflow[0].id : template.id;
  let app = saveRequirement(workspace.applications[0], workspace.templates, {
    statement: '项目名称由项目资料带入', source: '虚构访谈记录，第 1 页', origin: 'ai',
    target: {templateId: template.id, kind, id: targetId}
  });
  const id = app.requirements[0].id;
  const expectedDefinition = requirementDefinition(app, workspace.templates, id);
  assert.equal(requirementStatus(app, workspace.templates, app.requirements[0]), 'pending');
  app = confirmRequirement(app, workspace.templates, id, {reviewer: '虚构业务确认人', evidence: '现场按样例核对', expectedDefinition});
  return {workspace, app, id};
}

test('source links retain confirmed definitions and recheck changes even without a version bump', () => {
  for (const kind of ['template', 'field', 'stage']) {
    const {workspace, app} = fixture(kind);
    const entry = app.requirements[0];
    assert.equal(requirementStatus(app, workspace.templates, entry), 'confirmed');
    for (const change of [
      templates => { templates[0].fields[0].required = !templates[0].fields[0].required; },
      templates => { templates[0].workflow[0].role = '另一角色'; },
      templates => { templates[0].version++; },
      templates => { templates[0].blocks[0].text = '修订原文'; }
    ]) {
      const changed = structuredClone(workspace.templates);
      change(changed);
      assert.equal(requirementStatus(app, changed, entry), 'changed');
    }
    assert.equal(requirementStatus({...app, bindings: []}, workspace.templates, entry), 'changed');
    const reordered = workspace.templates.map(template => Object.fromEntries(Object.entries(template).reverse()));
    assert.equal(requirementStatus(app, reordered, entry), 'confirmed');
    assert.equal(entry.reviews.length, 1);
  }
});

test('editing sources preserves history and reconfirmation binds the new definition', () => {
  const {workspace, app, id} = fixture();
  const prior = structuredClone(app.requirements[0].reviews);
  const edited = saveRequirement(app, workspace.templates, {...app.requirements[0], source: '修订访谈，第 3 页'});
  assert.equal(requirementStatus(edited, workspace.templates, edited.requirements[0]), 'changed');
  assert.deepEqual(edited.requirements[0].reviews, prior);
  const confirmed = confirmRequirement(edited, workspace.templates, id, {
    reviewer: '另一位确认人', evidence: '补充核对原文', expectedDefinition: requirementDefinition(edited, workspace.templates, id)
  });
  assert.equal(requirementStatus(confirmed, workspace.templates, confirmed.requirements[0]), 'confirmed');
  assert.equal(confirmed.requirements[0].reviews.length, 2);
  assert.deepEqual(confirmed.requirements[0].reviews[0], prior[0]);
  assert.match(requirementsText(confirmed, workspace.templates), /修订访谈，第 3 页/);
  assert.match(requirementsText(confirmed, workspace.templates), /虚构访谈记录，第 1 页/);
});

test('removed references stay reviewable and cannot remain confirmed or accept a stale confirmation', () => {
  const {workspace, app, id} = fixture();
  const entry = app.requirements[0];
  const originalDefinition = requirementDefinition(app, workspace.templates, id);
  const removed = structuredClone(workspace.templates);
  removed[0].fields.shift();
  assert.equal(requirementStatus(app, removed, entry), 'missing');
  assert.match(requirementsText(app, removed), /关联对象已移除/);
  assert.throws(() => confirmRequirement(app, removed, id, {reviewer: '甲', evidence: '依据', expectedDefinition: originalDefinition}), /移除/);
  const changed = structuredClone(workspace.templates); changed[0].version++;
  assert.throws(() => confirmRequirement(app, changed, id, {reviewer: '甲', evidence: '依据', expectedDefinition: originalDefinition}), /定义已变化/);
  assert.throws(() => saveRequirement(app, workspace.templates, {...entry, target: {...entry.target, templateId: 'outside-app'}}), /当前应用/);
  assert.equal(app.requirements[0].reviews.length, 1);
});

test('requirements roundtrip in old and new application packages with bounded import validation', () => {
  const {workspace, app} = fixture();
  assert.equal(upgradeWorkspace(workspace).applications[0].requirements, undefined);
  workspace.applications[0] = app;
  const restored = upgradeWorkspace(applicationPackage(workspace, app.id));
  assert.deepEqual(restored.applications[0].requirements, app.requirements);
  assert.equal(requirementStatus(restored.applications[0], restored.templates, restored.applications[0].requirements[0]), 'confirmed');
  const entry = app.requirements[0];
  for (const bad of [null, {...entry, origin: 'automatic-confirmed'}, {...entry, source: ''}, {...entry, target: null}, {...entry, reviews: [{...entry.reviews[0], definition: 'bad'}]}]) {
    assert.throws(() => validateRequirements([bad]));
  }
  assert.throws(() => validateRequirements([entry, entry]), /编号重复/);
  assert.throws(() => validateRequirements([{...entry, reviews: Array(51).fill(entry.reviews[0])}]), /50/);
});

test('project copies remap linked targets and retain the original confirmation for renewed review', () => {
  for (const kind of ['template', 'field', 'stage']) {
    const {workspace, app} = fixture(kind);
    workspace.applications[0] = app;
    const inspection = {workspace, report: {archiveSha256: 'fixture', requiredRoles: []}};
    const result = prepareProjectRestore(inspection, {operationId: 'restore-requirements', projectName: '恢复项目', archiveSha256: 'fixture', memberships: []}, {id: 'tester', name: '测试人'});
    const restoredApp = result.workspace.applications[0];
    assert.equal(requirementStatus(restoredApp, result.workspace.templates, restoredApp.requirements[0]), 'changed');
    assert.deepEqual(restoredApp.requirements[0].reviews, app.requirements[0].reviews);
    assert.notEqual(restoredApp.requirements[0].target.templateId, app.requirements[0].target.templateId);
  }
});

test('historical summaries explain original fields, actors and conditions without changing confirmation identity', () => {
  const workspace = applicationDemo();
  const template = workspace.templates.find(item => item.id === 'app-reply');
  const app = saveRequirement(workspace.applications[0], workspace.templates, {
    statement: '复查不通过退回填报', source: '虚构访谈原文', origin: 'manual',
    target: {kind: 'stage', templateId: template.id, id: template.workflow[0].id}
  });
  const id = app.requirements[0].id;
  const serialized = requirementDefinition(app, workspace.templates, id);
  const summary = requirementDefinitionText(serialized);
  assert.match(summary, /整改回复单 · 版本/);
  assert.match(summary, /监理复查 · 由专业监理办理/);
  assert.match(summary, /复查结论为“不通过”，退回至填报阶段/);
  assert.match(summary, /整改说明 · 文字 · 必填/);
  assert.match(summary, /选项 通过、不通过/);
  assert.match(summary, /项目名称从项目名称带入/);
  const saved = confirmRequirement(app, workspace.templates, id, {reviewer: '测试确认人', evidence: '样例', expectedDefinition: serialized});
  workspace.templates.find(item => item.id === 'app-reply').workflow[0].role = '新角色';
  assert.match(requirementDefinitionText(saved.requirements[0].reviews[0].definition), /由专业监理办理/);
  assert.ok(!requirementDefinitionText(serialized).includes('新角色'));
  assert.equal(saved.requirements[0].reviews[0].definition, serialized);
  assert.equal(requirementStatus(saved, workspace.templates, saved.requirements[0]), 'changed');
  assert.ok(requirementsText(saved, workspace.templates).includes(serialized));
});

test('definition summaries retain detail constraints and tolerate incomplete historical snapshots', () => {
  const {app, workspace, id} = fixture();
  const serialized = requirementDefinition(app, workspace.templates, id);
  const summary = requirementDefinitionText(serialized);
  assert.match(summary, /明细列 数量 · 数字/);
  assert.match(summary, /计算合计/);
  assert.match(requirementDefinitionText('{'), /无法生成摘要/);
  assert.match(requirementDefinitionText(JSON.stringify({template: {title: '旧快照'}, target: {}})), /摘要字段不完整/);
});

test('requirement scenarios retain real operation traces without changing business records or confirming requirements', () => {
  const {workspace, app, id} = fixture();
  app.requirements[0].reviews = [];
  const before = structuredClone(workspace);
  const next = runRequirementScenario(app, workspace.templates, id);
  const entry = next.requirements[0], run = entry.runs[0];
  assert.deepEqual(workspace, before);
  assert.equal(app.requirements[0].runs, undefined);
  assert.equal(requirementStatus(next, workspace.templates, entry), 'pending');
  assert.equal(scenarioRunStatus(next, workspace.templates, entry, run), 'passed');
  const submit = run.report.results.find(result => result.name === 'draft: advance and replay');
  assert.equal(submit.steps[0].role, workspace.templates[0].submitterRole);
  assert.equal(submit.steps[0].after.revision, 1);
  assert.deepEqual(submit.steps[1].after, submit.steps[1].before);
  assert.equal(submit.steps[2].outcome, 'rejected');
  const returned = run.report.results.find(result => result.name.endsWith(': return'));
  assert.equal(returned.steps[0].outcome, 'rejected');
  assert.equal(returned.steps[1].after.stage, '填报');
  assert.equal(returned.steps.at(-1).after.stage, '指令签发');
  assert.ok(returned.steps.at(-1).after.events > returned.steps[1].after.events);
  assert.match(scenarioRunText(run), /预期/);
  assert.match(scenarioRunText(run), /历史事件/);
  assert.match(requirementsText(next, workspace.templates), /本地场景通过/);
  workspace.applications[0] = next;
  const restored = upgradeWorkspace(applicationPackage(workspace, app.id));
  assert.deepEqual(restored.applications[0].requirements[0].runs, entry.runs);
  const changed = saveRequirement(next, workspace.templates, {...entry, source: '新的访谈材料'});
  assert.equal(scenarioRunStatus(changed, workspace.templates, changed.requirements[0], run), 'changed');
  const oldClient = structuredClone(next); delete oldClient.requirements[0].runs;
  assert.deepEqual(retainRequirementHistory(next, oldClient).requirements[0].runs, entry.runs);
  assert.equal(oldClient.requirements[0].runs, undefined);
  const tampered = structuredClone(next); tampered.requirements[0].runs = [];
  assert.throws(() => retainRequirementHistory(next, tampered), /场景运行历史/);
  const invalid = structuredClone(entry); invalid.runs[0].report.passed = false;
  assert.throws(() => validateRequirements([invalid]), /总结果/);
});

test('conditional scenarios show the actual return and keep a failed completion as failed evidence', () => {
  const workspace = applicationDemo();
  const template = workspace.templates.find(item => item.id === 'app-reply');
  const app = saveRequirement(workspace.applications[0], workspace.templates, {statement: '复查退回场景', source: '虚构规则', origin: 'manual', target: {kind: 'template', templateId: template.id, id: template.id}});
  const id = app.requirements[0].id;
  const good = runRequirementScenario(app, workspace.templates, id);
  const condition = good.requirements[0].runs[0].report.results.find(result => result.name.includes(': condition '));
  assert.equal(condition.passed, true);
  assert.equal(condition.steps[0].outcome, 'rejected');
  assert.equal(condition.steps[1].after.stage, '填报');
  template.fields.find(field => field.id === 'result').options = ['不通过'];
  const failed = runRequirementScenario(app, workspace.templates, id);
  const entry = failed.requirements[0], run = entry.runs[0];
  assert.equal(run.report.passed, false);
  assert.equal(scenarioRunStatus(failed, workspace.templates, entry, run), 'failed');
  assert.ok(run.report.results.some(result => !result.passed));
});


test('field observations preserve evidence, version boundaries and previous business records', () => {
  const {workspace, app, id} = fixture();
  app.requirements[0].reviews = [];
  const before = structuredClone(workspace);
  const input = {observer: '虚构观察人', environment: '本地虚构项目', preconditions: '已有指令单', steps: '填写项目名称并提交', expected: '进入签发', actual: '页面进入签发，证据记录 A', followUp: '', outcome: 'passed', expectedDefinition: requirementDefinition(app, workspace.templates, id)};
  const next = recordRequirementObservation(app, workspace.templates, id, input);
  const entry = next.requirements[0], observation = entry.observations[0];
  assert.deepEqual(workspace, before);
  assert.equal(app.requirements[0].observations, undefined);
  assert.equal(requirementStatus(next, workspace.templates, entry), 'pending');
  assert.equal(observationStatus(next, workspace.templates, entry, observation), 'passed');
  assert.match(observationText(observation), /证据记录 A/);
  assert.match(requirementsText(next, workspace.templates), /虚构观察人/);
  workspace.applications[0] = next;
  const restored = upgradeWorkspace(applicationPackage(workspace, app.id));
  assert.deepEqual(restored.applications[0].requirements[0].observations, entry.observations);
  const edited = saveRequirement(next, workspace.templates, {...entry, source: '修订来源'});
  assert.deepEqual(edited.requirements[0].observations, entry.observations);
  assert.equal(observationStatus(edited, workspace.templates, edited.requirements[0], observation), 'changed');
  assert.equal(observationStatus(next, [], entry, observation), 'missing');
  assert.throws(() => recordRequirementObservation(edited, workspace.templates, id, input), /定义已变化/);
  assert.throws(() => recordRequirementObservation(next, [], id, input), /已移除/);
  const oldClient = structuredClone(next); delete oldClient.requirements[0].observations;
  assert.deepEqual(retainRequirementHistory(next, oldClient).requirements[0].observations, entry.observations);
  assert.equal(oldClient.requirements[0].observations, undefined);
  const tampered = structuredClone(next); tampered.requirements[0].observations[0].actual = '改写';
  assert.throws(() => retainRequirementHistory(next, tampered), /现场观察历史/);
  for (const outcome of ['failed', 'blocked']) {
    assert.throws(() => recordRequirementObservation(app, workspace.templates, id, {...input, outcome}), /有效文字/);
    const saved = recordRequirementObservation(next, workspace.templates, id, {...input, outcome, followUp: '测试人员复核页面'});
    assert.equal(saved.requirements[0].observations.length, 2);
    assert.equal(observationStatus(saved, workspace.templates, saved.requirements[0], saved.requirements[0].observations[1]), outcome);
  }
  for (const patch of [{outcome: 'unknown'}, {observer: ''}, {actual: 'x'.repeat(8001)}, {at: 'invalid'}]) {
    const invalid = structuredClone(entry); Object.assign(invalid.observations[0], patch);
    assert.throws(() => validateRequirements([invalid]));
  }
  const duplicate = structuredClone(entry); duplicate.observations.push(structuredClone(observation));
  assert.throws(() => validateRequirements([duplicate]), /编号或日期/);
});


test('custom scenario inputs reach operations, retain failures and reject stale definitions', () => {
  const {workspace, app, id} = fixture();
  const template = workspace.templates[0];
  const values = scenarioSampleValues(template);
  values.project = '客户提供的虚构项目';
  values.items = JSON.stringify([{position: '二层', issue: '现场问题', quantity: '3'}]);
  const original = structuredClone({workspace, app, values});
  const expectedDefinition = requirementDefinition(app, workspace.templates, id);
  const next = runRequirementScenario(app, workspace.templates, id, {expectedDefinition, values});
  const run = next.requirements[0].runs[0];
  assert.equal(run.report.passed, true);
  assert.equal(run.report.inputMode, 'custom');
  assert.deepEqual(run.report.inputs, values);
  const step = run.report.results.find(result => result.name === 'draft: advance and replay').steps[0];
  assert.equal(step.input.project, values.project);
  assert.equal(step.input.items, values.items);
  assert.match(scenarioRunText(run), /自定义输入/);
  assert.deepEqual({workspace, app, values}, original);
  const failed = runRequirementScenario(app, workspace.templates, id, {expectedDefinition, values: {...values, project: ''}});
  assert.equal(failed.requirements[0].runs[0].report.passed, false);
  assert.match(failed.requirements[0].runs[0].report.results.find(result => result.name === 'draft: advance and replay').actual, /项目名称/);
  const changed = structuredClone(workspace.templates); changed[0].fields[0].label = '新名称';
  assert.throws(() => runRequirementScenario(app, changed, id, {expectedDefinition, values}), /定义已变化/);
  for (const invalid of [null, [], {unknown: 'value'}, {project: 123}, {project: 'x'.repeat(20001)}]) {
    assert.throws(() => runRequirementScenario(app, workspace.templates, id, {values: invalid}), /场景输入/);
  }
  const tampered = structuredClone(next.requirements[0]); tampered.runs[0].report.inputs.unknown = 'value';
  assert.throws(() => validateRequirements([tampered]), /未知字段/);
  workspace.applications[0] = next;
  assert.deepEqual(upgradeWorkspace(applicationPackage(workspace, app.id)).applications[0].requirements[0].runs, next.requirements[0].runs);
});

test('custom conditional input remains explicit while automatic samples find the completing choice', () => {
  const workspace = applicationDemo(), template = workspace.templates.find(item => item.id === 'app-reply');
  const app = saveRequirement(workspace.applications[0], workspace.templates, {statement: '复查意见', source: '虚构来源', origin: 'manual', target: {kind: 'template', templateId: template.id, id: template.id}});
  const id = app.requirements[0].id, values = scenarioSampleValues(template);
  assert.equal(values.result, '通过');
  values.result = '不通过';
  const next = runRequirementScenario(app, workspace.templates, id, {values});
  const run = next.requirements[0].runs[0];
  assert.equal(run.report.inputs.result, '不通过');
  assert.equal(run.report.passed, false);
  const attempt = run.report.results.find(result => result.name === 'review: advance and replay');
  assert.equal(attempt.steps[0].input.result, '不通过');
  assert.equal(attempt.steps[0].outcome, 'rejected');
  assert.match(attempt.actual, /条件触发退回，请填写办理意见作为原因/);
});
