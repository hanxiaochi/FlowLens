import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDemo} from './apps-demo.mjs';
import {startProjectCase, applicationPackage} from './apps-model.mjs';
import {summarizeRecord, validateSummaryFields, createCase} from './forms-model.mjs';
import {validateWorkspace, upgradeWorkspace} from './forms-store.mjs';
import {summarizeWorkspace} from './team-read-model.mjs';

test('configured summaries preserve order, omit empty selections and share the team projection', () => {
  const fixture = applicationDemo();
  const record = fixture.cases[0];
  record.template.summaryFields = ['deadline', 'instruction-no', 'issue'];
  record.values = {...record.values, deadline: '2026-12-01', 'instruction-no': 'SUMMARY-001', issue: '  '};
  const expected = [{label: '整改期限', text: '2026-12-01'}, {label: '指令编号', text: 'SUMMARY-001'}];
  assert.deepEqual(summarizeRecord(record), expected);
  assert.deepEqual(summarizeWorkspace(fixture, []).workspace.cases[0].summary, expected);
  record.template.summaryFields = [];
  const automatic = summarizeRecord(record);
  delete record.template.summaryFields;
  assert.deepEqual(summarizeRecord(record), automatic);
  assert.equal(automatic.length, 3);
});

test('import validation rejects invalid summary fields in templates and historical snapshots', () => {
  for (const invalid of [null, 'issue', Array(1), ['issue', 'issue'], ['missing'], [1], ['project', 'contractor', 'issue', 'deadline']]) {
    for (const snapshot of [false, true]) {
      const fixture = applicationDemo();
      const template = snapshot ? fixture.cases[0].template : fixture.templates[0];
      template.summaryFields = invalid;
      assert.throws(() => validateWorkspace(fixture), /摘要/);
      assert.throws(() => createCase(template), /摘要/);
    }
  }
  const fixture = applicationDemo();
  fixture.templates[0].summaryFields = ['issue'];
  const restored = upgradeWorkspace(JSON.parse(JSON.stringify(applicationPackage(fixture, fixture.applications[0].id))));
  assert.deepEqual(restored.templates[0].summaryFields, ['issue']);
  assert.equal(restored.cases[0].template.summaryFields, undefined);
  assert.doesNotThrow(() => validateWorkspace(restored));
});

test('new records keep summary selections in their own template snapshots', () => {
  const fixture = applicationDemo();
  const template = fixture.templates[0];
  const oldRecord = fixture.cases[0];
  const original = summarizeRecord(oldRecord);
  template.summaryFields = ['contractor', 'project']; template.version++;
  const created = startProjectCase(fixture, {appId: fixture.applications[0].id, projectId: fixture.projects[0].id, templateId: template.id});
  assert.deepEqual(summarizeRecord(created.record).map(field => field.label), ['施工单位', '项目名称']);
  template.summaryFields.reverse();
  assert.deepEqual(created.record.template.summaryFields, ['contractor', 'project']);
  assert.deepEqual(summarizeRecord(oldRecord), original);
  validateSummaryFields(template);
});
