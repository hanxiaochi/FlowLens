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
import {openTeamStore} from './team-store.mjs';
import {applyOperation} from './forms-model.mjs';

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

test('review follows actual submit, return and resubmit transitions and flags changed upstream snapshots', () => {
  const {workspace, record} = fixture();
  record.values.draft = '已填';
  let current = applyOperation(record, {type: 'submit', role: record.submitter});
  workspace.cases = [current];
  assert.deepEqual(reviewProject(workspace, current.projectId).results[0].issues.map(issue => issue.fieldId), ['review']);
  current = applyOperation(current, {type: 'return', role: current.template.workflow[0].role, note: '补充资料'});
  workspace.cases = [current];
  assert.equal(reviewProject(workspace, current.projectId).results.length, 0);
  current = applyOperation(current, {type: 'submit', role: current.submitter});
  current = applyOperation(current, {type: 'advance', role: current.template.workflow[0].role, values: {review: '已核对'}});
  workspace.cases = [current];
  assert.deepEqual(reviewProject(workspace, current.projectId).results[0].issues.map(issue => issue.fieldId), ['later']);
  current = applyOperation(current, {type: 'advance', role: current.template.workflow[1].role, values: {later: '已归档'}});
  const child = {...structuredClone(current), id: crypto.randomUUID(), relatedId: current.id, link: {sourceId: current.id, sourceRevision: current.revision}};
  workspace.cases = [current, child];
  assert.equal(reviewProject(workspace, current.projectId).results.length, 0);
  current.revision++;
  assert.equal(reviewProject(workspace, current.projectId).results[0].issues[0].kind, 'upstream-revision');
  current.status = 'draft';
  assert.ok(reviewProject(workspace, current.projectId).results[0].issues.some(issue => issue.kind === 'upstream-status'));
});

test('attachment verification honors the actual 64 MiB budget and supports individual verification afterwards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-review-budget-'));
  const store = openTeamStore(join(directory, 'team.sqlite'));
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password: 'project-review-test'});
    const sample = applicationDemo(), record = sample.cases[0];
    record.attachments = Array.from({length: 9}, (_, index) => ({id: 'file-' + index, name: 'file-' + index + '.bin', size: 8 * 1024 * 1024, data: 'data:application/octet-stream;base64,' + Buffer.alloc(8 * 1024 * 1024, index).toString('base64')}));
    store.importApplication(admin, sample);
    const report = store.projectReview(admin, {projectId: record.projectId});
    assert.equal(report.attachmentVerification.inspectedBytes, 64 * 1024 * 1024);
    assert.equal(report.totals.attachments, 9); assert.equal(report.totals.unchecked, 1);
    const deferred = report.results[0].issues.filter(issue => issue.severity === 'unchecked');
    assert.deepEqual(deferred.map(issue => issue.attachmentId), ['file-8']);
    const verified = store.attachment(admin, record.id, 'file-8');
    assert.equal(verified.data.length, 8 * 1024 * 1024); assert.ok(verified.data.every(byte => byte === 8));
    assert.equal(store.projectReview(admin, {projectId: record.projectId}).totals.unchecked, 1);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('large valid projects keep paged review available while rejecting oversized full checklists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-review-size-'));
  const store = openTeamStore(join(directory, 'team.sqlite'));
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password: 'project-review-test'});
    const sample = applicationDemo(), record = sample.cases[0];
    record.template.fields = Array.from({length: 100}, (_, index) => ({id: 'wide-' + index, label: '&'.repeat(500), owner: 'draft', required: true}));
    record.template.blocks = record.template.fields.map(field => ({id: field.id, type: 'paragraph', text: ''}));
    delete record.template.summaryFields; record.values = {}; record.provenance = [];
    sample.cases = Array.from({length: 400}, () => ({...structuredClone(record), id: crypto.randomUUID()}));
    store.importApplication(admin, sample);
    const paged = store.projectReview(admin, {projectId: record.projectId, page: '8'});
    assert.equal(paged.totals.pending, 40000); assert.equal(paged.results.length, 50); assert.equal(paged.pages, 8);
    for (const download of ['1', 'html']) assert.throws(() => store.projectReview(admin, {projectId: record.projectId, download}), error => error.status === 413);
    assert.equal(store.projectReview(admin, {projectId: record.projectId}).page, 1);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
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

test('review filters before pagination, preserves full totals and requires actual actor roles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-review-filter-'));
  const store = openTeamStore(join(directory, 'team.sqlite'));
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password: 'project-review-test'});
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password: 'project-review-test'});
    const sample = applicationDemo(), original = sample.cases[0], projectId = original.projectId;
    sample.cases = Array.from({length: 53}, (_, index) => ({...structuredClone(original), id: 'review-' + index, values: {...original.values, 'instruction-no': '000' + index}}));
    sample.cases[52].template.summaryFields = ['instruction-no'];
    sample.cases[51].status = 'complete';
    sample.cases[51].step = sample.cases[51].template.workflow.length;
    store.importApplication(admin, sample);
    store.setMembership(admin, {userId: member.id, projectId, roles: ['专业监理']});
    const before = store.visibleWorkspace(admin), audit = store.audit(admin);
    const searched = store.projectReview(member, {projectId, search: '00052', page: '2'});
    assert.equal(searched.results.length, 1); assert.equal(searched.results[0].recordId, 'review-52');
    assert.equal(searched.page, 1); assert.equal(searched.matchedRecords, 1); assert.equal(searched.totals.records, 53);
    assert.deepEqual(searched.filters, {severity: 'all', assignee: 'all', search: '00052'});
    assert.equal(store.projectReview(member, {projectId, search: 'REVIEW-52'}).matchedRecords, 1);
    assert.equal(store.projectReview(member, {projectId, assignee: 'mine'}).matchedRecords, 52);
    assert.equal(store.projectReview(member, {projectId, assignee: 'mine', page: '2'}).results.length, 2);
    assert.equal(store.projectReview(admin, {projectId, assignee: 'mine'}).matchedRecords, 0);
    assert.equal(store.projectReview(member, {projectId, severity: 'review'}).matchedRecords, 1);
    assert.equal(store.projectReview(member, {projectId, severity: 'review', assignee: 'mine'}).matchedRecords, 0);
    assert.equal(store.projectReview(member, {projectId, severity: 'unchecked'}).matchedRecords, 0);
    assert.equal(store.projectReview(member, {projectId, search: 'no-such-record'}).totals.affectedRecords, 53);
    assert.equal(store.projectReview(member, {projectId, search: 'no-such-record', download: '1'}).results.length, 53);
    for (const invalid of [{severity: 'bad'}, {assignee: 'admin'}, {search: 'a'.repeat(201)}, {search: []}]) assert.throws(() => store.projectReview(member, {projectId, ...invalid}), error => error.status === 400);
    assert.deepEqual(store.visibleWorkspace(admin), before); assert.deepEqual(store.audit(admin), audit);
    store.setMembership(admin, {userId: member.id, projectId, roles: ['总监']});
    assert.equal(store.projectReview(member, {projectId, assignee: 'mine'}).matchedRecords, 0);
    store.setMembership(admin, {userId: member.id, projectId, roles: []});
    assert.throws(() => store.projectReview(member, {projectId, search: '00052'}), error => error.status === 404);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});
