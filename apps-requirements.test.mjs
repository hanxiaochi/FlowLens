import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDemo} from './apps-demo.mjs';
import {applicationPackage} from './apps-model.mjs';
import {upgradeWorkspace} from './forms-store.mjs';
import {prepareProjectRestore} from './team-project-restore.mjs';
import {saveRequirement, confirmRequirement, requirementDefinition, requirementStatus, validateRequirements, requirementsText, requirementDefinitionText} from './apps-requirements.mjs';

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
