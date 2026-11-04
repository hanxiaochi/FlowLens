import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTeamStore} from './team-store.mjs';
import {applicationDemo} from './apps-demo.mjs';
import {createTeamServer} from './team-server.mjs';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const password = 'publication-test-password';
const optionsFor = plan => ({operationId: crypto.randomUUID(), planFingerprint: plan.planFingerprint, expectedUserId: plan.userId, expectedInstanceId: plan.instanceId});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-definitions-'));
  const store = openTeamStore(join(directory, 'team.sqlite'));
  const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
  const other = await store.createUser(admin, {username: 'other', name: 'Other admin', password, admin: true});
  const member = await store.createUser(admin, {username: 'member', name: 'Member', password});
  const initial = applicationDemo(); store.importApplication(admin, initial);
  store.setMembership(admin, {userId: admin.id, projectId: initial.projects[0].id, roles: ['专业监理']});
  return {directory, store, admin, other, member, initial};
}

test('definition preview is read-only and guarded publication rejects a competing baseline', async () => {
  const {directory, store, admin, other, initial} = await setup();
  try {
    const first = structuredClone(initial), second = structuredClone(initial);
    first.applications[0].name = 'First name'; second.applications[0].name = 'Second name';
    const before = store.visibleWorkspace(admin), auditBefore = store.audit(admin);
    const plan = store.previewDefinitions(admin, first), competing = store.previewDefinitions(other, second);
    assert.deepEqual(store.visibleWorkspace(admin), before);
    assert.deepEqual(store.audit(admin), auditBefore);
    assert.deepEqual(plan.changes.map(change => change.sections), [['name']]);
    const request = optionsFor(plan);
    const result = store.publishDefinitions(admin, first, request);
    assert.equal(result.updated, true);
    const published = store.visibleWorkspace(admin), auditAfter = store.audit(admin);
    assert.deepEqual(store.publishDefinitions(admin, first, request), result);
    assert.deepEqual(store.visibleWorkspace(admin), published);
    assert.deepEqual(store.audit(admin), auditAfter);
    assert.deepEqual(published.workspace.cases, before.workspace.cases);
    assert.throws(() => store.publishDefinitions(other, second, optionsFor(competing)), error => error.status === 409);
    assert.deepEqual(store.visibleWorkspace(admin), published);
    assert.deepEqual(store.audit(admin), auditAfter);
    const unchanged = store.previewDefinitions(admin, first);
    assert.equal(unchanged.changed, false);
    assert.equal(store.publishDefinitions(admin, first, optionsFor(unchanged)).updated, false);
    assert.deepEqual(store.visibleWorkspace(admin), published);
    assert.deepEqual(store.audit(admin), auditAfter);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('business edits preserve the publication baseline while changed package or identity is rejected', async () => {
  const {directory, store, admin, other, member, initial} = await setup();
  try {
    const incoming = structuredClone(initial);
    incoming.templates[0].version++;
    incoming.templates[0].summaryFields = ['contractor', 'project'];
    const plan = store.previewDefinitions(admin, incoming), request = optionsFor(plan);
    assert.deepEqual(plan.changes[0].sections, ['version', 'summaryFields']);
    assert.throws(() => store.previewDefinitions(member, incoming), error => error.status === 403);
    assert.throws(() => store.publishDefinitions(member, incoming, request), error => error.status === 403);
    assert.throws(() => store.publishDefinitions(other, incoming, request), error => error.status === 409);
    assert.throws(() => store.publishDefinitions(admin, incoming, {...request, expectedInstanceId: 'restored-instance'}), error => error.status === 409);
    const changedPackage = structuredClone(incoming); changedPackage.applications[0].name = 'Changed after preview';
    assert.throws(() => store.publishDefinitions(admin, changedPackage, request), error => error.status === 409);
    const record = initial.cases[0];
    store.command(admin, {type: 'save', recordId: record.id, expectedRevision: record.revision, operationId: crypto.randomUUID(), values: {issue: 'Business work during preview'}});
    const savedCases = store.visibleWorkspace(admin).workspace.cases;
    const result = store.publishDefinitions(admin, incoming, request);
    assert.equal(result.updated, true);
    assert.deepEqual(store.visibleWorkspace(admin).workspace.cases, savedCases);
    const newer = structuredClone(incoming); newer.templates[0].version++; newer.templates[0].summaryFields = ['project'];
    store.publishDefinitions(admin, newer, optionsFor(store.previewDefinitions(admin, newer)));
    const beforeReplay = store.visibleWorkspace(admin), auditBeforeReplay = store.audit(admin);
    assert.deepEqual(store.publishDefinitions(admin, incoming, request), result);
    assert.deepEqual(store.visibleWorkspace(admin), beforeReplay);
    assert.deepEqual(store.audit(admin), auditBeforeReplay);
    assert.throws(() => store.publishDefinitions(admin, newer, request), error => error.status === 409);
    store.setDisabled(other, {userId: admin.id, disabled: true});
    assert.throws(() => store.publishDefinitions(admin, incoming, request), error => error.status === 401);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('definition HTTP endpoints enforce admin access and replay one publication result', async () => {
  const {directory, store, initial} = await setup();
  const {server} = createTeamServer({database: join(directory, 'team.sqlite')});
  try {
    const adminSession = await store.login('admin', password);
    const memberSession = await store.login('member', password);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const request = (path, data, token) => new Promise((resolve, reject) => {
      const req = http.request({hostname: '127.0.0.1', port: server.address().port, path: '/api/team/' + path, method: 'POST', headers: {Host: '127.0.0.1:4186', 'Content-Type': 'application/json', 'X-FlowLens-Request': '1', Cookie: 'flowlens_session=' + token}}, response => {
        let text = ''; response.setEncoding('utf8'); response.on('data', chunk => text += chunk);
        response.on('end', () => resolve({status: response.statusCode, body: JSON.parse(text)}));
      });
      req.on('error', reject); req.end(JSON.stringify(data));
    });
    const incoming = structuredClone(initial); incoming.applications[0].name = 'Published through HTTP';
    assert.equal((await request('definitions-preview', incoming, memberSession.token)).status, 403);
    const preview = await request('definitions-preview', incoming, adminSession.token);
    assert.equal(preview.status, 200);
    const payload = {workspace: incoming, options: optionsFor(preview.body)};
    assert.equal((await request('definitions-publish', payload, memberSession.token)).status, 403);
    const published = await request('definitions-publish', payload, adminSession.token);
    assert.equal(published.status, 200); assert.equal(published.body.updated, true);
    assert.deepEqual(await request('definitions-publish', payload, adminSession.token), published);
    assert.equal((await request('definitions-publish', {workspace: incoming}, adminSession.token)).status, 400);
    assert.equal(store.audit(adminSession.user).filter(event => event.action === 'application.definitions').length, 1);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    store.close(); await rm(directory, {recursive: true, force: true});
  }
});

test('CLI restoration refuses both pending and previously completed publications from the old instance', async () => {
  const {directory, store, admin, initial} = await setup();
  let restored;
  try {
    const incoming = structuredClone(initial); incoming.applications[0].name = 'Published before backup';
    const completed = optionsFor(store.previewDefinitions(admin, incoming));
    store.publishDefinitions(admin, incoming, completed);
    const next = structuredClone(incoming); next.applications[0].name = 'Pending before backup';
    const pending = optionsFor(store.previewDefinitions(admin, next));
    const backup = join(directory, 'backup.sqlite'), target = join(directory, 'restored.sqlite');
    await store.backup(backup);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./scripts/team-admin.mjs', import.meta.url)), 'restore', backup], {env: {...process.env, FLOWLENS_DATABASE: target}, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0, result.stderr);
    restored = openTeamStore(target);
    assert.notEqual(restored.serviceContext(admin).instanceId, completed.expectedInstanceId);
    const before = restored.visibleWorkspace(admin), audit = restored.audit(admin);
    assert.throws(() => restored.publishDefinitions(admin, incoming, completed), error => error.status === 409);
    assert.throws(() => restored.publishDefinitions(admin, next, pending), error => error.status === 409);
    assert.deepEqual(restored.visibleWorkspace(admin), before);
    assert.deepEqual(restored.audit(admin), audit);
  } finally { restored?.close(); store.close(); await rm(directory, {recursive: true, force: true}); }
});
