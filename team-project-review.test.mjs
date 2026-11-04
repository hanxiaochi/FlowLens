import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewProject, printableProjectReview} from './team-project-review.mjs';
import {applicationDemo} from './apps-demo.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import http from 'node:http';
import {createTeamServer} from './team-server.mjs';

function fixture() {
  const workspace = applicationDemo(), record = workspace.cases[0];
  record.template.workflow = [{id: 'review-stage', label: '审核', role: '审核人', kind: 'review'}, {id: 'later-stage', label: '归档', role: '归档人', kind: 'receipt'}];
  record.template.fields = [
    {id: 'draft', label: '填报内容', owner: 'draft', required: true},
    {id: 'review', label: '审核内容', owner: record.template.workflow[0].id, required: true},
    {id: 'later', label: '后续内容', owner: record.template.workflow[1].id, required: true}
  ]; record.values = {}; record.attachments = [];
  return {workspace, record, report: () => reviewProject(workspace, record.projectId)};
}
test('review respects current stage, returns and historical form snapshots without mutations', () => {
  const {workspace, record, report} = fixture();
  const before = structuredClone(workspace);
  assert.deepEqual(report().results[0].issues.map(issue => [issue.fieldId, issue.severity]), [['draft', 'pending']]);
  assert.deepEqual(workspace, before);
  record.status = 'active'; record.step = 0;
  assert.deepEqual(report().results[0].issues.map(issue => [issue.fieldId, issue.severity]), [['draft', 'review'], ['review', 'pending']]);
  record.status = 'draft'; record.step = -1;
  assert.equal(report().results[0].issues.length, 1);
  record.status = 'complete'; record.step = record.template.workflow.length;
  assert.equal(report().totals.review, 3);
  workspace.templates[0].fields = [];
  assert.equal(report().totals.review, 3);
});
test('review distinguishes detail completeness and bad saved formats from future blank fields', () => {
  const {record, report} = fixture();
  record.template.fields.push({id: 'detail', label: '明细', owner: 'draft', type: 'table', columns: [{id: 'location', label: '部位', required: true}]});
  record.values.detail = '[{}]'; record.values.draft = '已填';
  assert.equal(report().results[0].issues[0].fieldId, 'detail');
  record.values.detail = 'invalid json';
  assert.equal(report().results[0].issues[0].kind, 'field-format');
  record.values.detail = '[{"location":"001"}]';
  assert.equal(report().results.length, 0);
});
test('review does not disclose another project or require unconfigured attachments', () => {
  const {workspace, record, report} = fixture();
  record.values.draft = '已填';
  workspace.cases.push({...structuredClone(record), id: 'secret-id', title: 'SECRET_TITLE', projectId: 'private-project'});
  assert.equal(report().totals.records, 1); assert.equal(report().results.length, 0);
  record.relatedId = 'secret-id';
  const output = report(); assert.equal(output.totals.review, 1);
  assert.ok(!JSON.stringify(output).includes('secret-id')); assert.ok(!JSON.stringify(output).includes('SECRET_TITLE'));
  record.relatedId = record.id; assert.equal(report().totals.review, 1);
});
test('attachment inspection distinguishes verified, damaged and unchecked files', () => {
  const {workspace, record} = fixture(); record.values.draft = '已填';
  record.attachments = ['verified', 'invalid', 'unchecked'].map(state => ({id: state, name: state + '.txt'}));
  const report = reviewProject(workspace, record.projectId, file => file.id);
  assert.equal(report.totals.attachments, 3); assert.equal(report.totals.review, 1); assert.equal(report.totals.unchecked, 1);
  assert.deepEqual(report.results[0].issues.map(issue => issue.attachmentId), ['invalid', 'unchecked']);
});

test('readable review export escapes supplied content and labels its saved snapshot', () => {
  const {record, report} = fixture(); record.title = '<img src=x onerror=alert(1)>';
  record.template.fields[0].label = '</td><script>bad()</script>';
  const html = printableProjectReview(report());
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img '));
  assert.ok(html.includes('生成时的核对快照')); assert.ok(html.includes('default-src'));
});

test('review HTTP pages, downloads and attachment hashes use the latest project permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-review-')), database = join(directory, 'team.sqlite');
  const {server, store} = createTeamServer({database});
  let inspection;
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password: 'project-review-test'});
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password: 'project-review-test'});
    const sample = applicationDemo(), original = sample.cases[0];
    original.attachments = [{id: crypto.randomUUID(), name: '证据.txt', size: 3, data: 'data:text/plain;base64,YWJj'}];
    sample.cases = Array.from({length: 52}, () => ({...structuredClone(original), id: crypto.randomUUID()}));
    sample.projects.push({...sample.projects[0], id: 'other-project', name: 'PRIVATE_PROJECT'});
    sample.cases.push({...structuredClone(original), id: crypto.randomUUID(), projectId: 'other-project', title: 'PRIVATE_TITLE', provenance: []});
    store.importApplication(admin, sample);
    store.setMembership(admin, {userId: member.id, projectId: original.projectId, roles: ['专业监理']});
    const session = await store.login('member', 'project-review-test');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const get = (query = '') => new Promise((resolve, reject) => {
      http.get({hostname: '127.0.0.1', port: server.address().port, path: '/api/team/project-review?projectId=' + original.projectId + query,
        headers: {Host: '127.0.0.1:4186', Cookie: 'flowlens_session=' + session.token}}, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({status: response.statusCode, headers: response.headers, body: response.headers['content-type'].includes('json') ? JSON.parse(text) : text}); });
      }).on('error', reject);
    });
    const before = store.visibleWorkspace(admin), audit = store.audit(admin);
    const first = await get(); assert.equal(first.status, 200); assert.equal(first.body.results.length, 50); assert.equal(first.body.pages, 2);
    assert.equal(first.body.totals.records, 52); assert.equal(first.body.totals.attachments, 52);
    assert.equal(first.body.attachmentVerification.inspectedBytes, 3);
    assert.ok(!JSON.stringify(first.body).includes('PRIVATE_'));
    assert.equal((await get('&page=2')).body.results.length, 2);
    assert.equal((await get('&page=999')).body.page, 2);
    assert.equal((await get('&page=0')).status, 400);
    const download = await get('&download=1'); assert.equal(download.status, 200);
    assert.equal(download.body.results.length, 52); assert.ok(download.headers['content-disposition'].includes('.json'));
    assert.equal(download.headers['cache-control'], 'no-store');
    const html = await get('&download=html'); assert.equal(html.status, 200);
    assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal((html.body.match(/<section>/g) ?? []).length, 52);
    assert.deepEqual(store.visibleWorkspace(admin), before); assert.deepEqual(store.audit(admin), audit);
    inspection = new DatabaseSync(database);
    inspection.prepare('UPDATE attachment_blobs SET data=?').run(Buffer.from('xyz'));
    const damaged = await get(); assert.equal(damaged.status, 200);
    assert.equal(damaged.body.results.filter(record => record.issues.some(issue => issue.kind === 'attachment' && issue.severity === 'review')).length, 50);
    assert.equal(damaged.body.totals.unchecked, 0);
    store.setMembership(admin, {userId: member.id, projectId: original.projectId, roles: []});
    assert.equal((await get()).status, 404); assert.equal((await get('&download=1')).status, 404);
    assert.equal((await get('&download=html')).status, 404);
    assert.equal(store.projectReview(admin, {projectId: original.projectId}).totals.records, 52);
    store.setDisabled(admin, {userId: member.id, disabled: true}); assert.equal((await get()).status, 401);
  } finally {
    inspection?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true});
  }
});
