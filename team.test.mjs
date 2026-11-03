import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTeamStore} from './team-store.mjs';
import {createTeamServer} from './team-server.mjs';
import {applicationDemo} from './apps-demo.mjs';
import {createProject} from './apps-model.mjs';
import {DatabaseSync} from 'node:sqlite';

const password = 'test-only-long-password';

test('operations status is admin-only and backup evidence matches a verified snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-operations-'));
  const filename = join(directory, 'team.sqlite');
  let store = openTeamStore(filename);
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Private admin name', password});
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password});
    store.importApplication(admin, applicationDemo());
    const before = store.operations(admin);
    assert.throws(() => store.operations(member), error => error.status === 403);
    assert.equal(before.records, 1);
    assert.equal(before.projects, 1);
    assert.equal(before.users.enabled, 2);
    assert.equal(before.lastBackup, null);
    assert.equal(before.workspaceLimitBytes, 32 * 1024 * 1024);
    assert.ok(before.workspaceBytes > 0);
    assert.ok(before.databaseBytes > 0);
    assert.ok(before.databaseWalBytes >= 0);
    const target = join(directory, 'backup.sqlite');
    const result = await store.backup(target);
    const bytes = await readFile(target);
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.bytes, bytes.length);
    assert.equal(result.workspaceRevision, before.workspaceRevision);
    assert.deepEqual(store.operations(admin).lastBackup, result);
    await assert.rejects(store.backup(join(directory, 'missing', 'failed.sqlite')));
    assert.deepEqual(store.operations(admin).lastBackup, result);
    const serialized = JSON.stringify(store.operations(admin));
    assert.ok(!serialized.includes(directory));
    assert.ok(!serialized.includes('Private admin name'));
    assert.ok(!serialized.includes(password));
    store.close();
    const oldDatabase = new DatabaseSync(filename);
    oldDatabase.exec('DROP TABLE maintenance'); oldDatabase.close();
    store = openTeamStore(filename);
    assert.equal(store.operations(admin).lastBackup, null);
    assert.equal(store.operations(admin).records, 1);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('a failure after workspace and audit writes rolls back the whole command and allows retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-rollback-'));
  const filename = join(directory, 'team.sqlite');
  const store = openTeamStore(filename);
  const inspection = new DatabaseSync(filename);
  try {
    const user = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    store.importApplication(user, applicationDemo());
    store.setMembership(user, {userId: user.id, projectId: 'demo-project', roles: ['专业监理']});
    const before = store.visibleWorkspace(user);
    const auditBefore = store.audit(user);
    const rowBefore = inspection.prepare('SELECT * FROM workspace').get();
    const record = before.workspace.cases[0];
    const command = {type: 'save', recordId: record.id, expectedRevision: record.revision, operationId: crypto.randomUUID(), values: {issue: 'Recovered transaction'}};
    // Requests are written after both the workspace and audit within the transaction.
    inspection.exec("CREATE TRIGGER reject_request BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");
    assert.throws(() => store.command(user, command), /injected write failure/);
    assert.deepEqual(store.visibleWorkspace(user), before);
    assert.deepEqual(store.audit(user), auditBefore);
    assert.deepEqual(inspection.prepare('SELECT * FROM workspace').get(), rowBefore);
    assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM requests WHERE id=?').get(command.operationId).n, 0);
    inspection.exec('DROP TRIGGER reject_request');
    const result = store.command(user, command);
    assert.equal(result.record.values.issue, 'Recovered transaction');
    assert.equal(result.record.revision, record.revision + 1);
    assert.deepEqual(store.command(user, command), result);
    assert.equal(store.audit(user).length, auditBefore.length + 1);
    assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM requests WHERE id=?').get(command.operationId).n, 1);
  } finally {
    inspection.close();
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});
test('shared workspace enforces project roles, revisions and request identity across restart and backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-team-'));
  let store = openTeamStore(join(directory, 'team.sqlite'));
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    const supervisor = await store.createUser(admin, {username: 'supervisor', name: 'Supervisor', password});
    const contractor = await store.createUser(admin, {username: 'contractor', name: 'Contractor', password});
    const stranger = await store.createUser(admin, {username: 'stranger', name: 'Stranger', password});
    const sample = applicationDemo();
    sample.projects.push(createProject(sample.applications[0].id, 'Private project'));
    store.importApplication(admin, sample);
    assert.throws(() => store.importApplication(admin, sample), /已有编号/);
    assert.throws(() => store.importApplication(contractor, sample), /管理员/);
    for (const [user, roles] of [[supervisor, ['专业监理', '总监', '资料员']], [contractor, ['施工单位']]]) store.setMembership(admin, {userId: user.id, projectId: 'demo-project', roles});
    assert.equal(store.visibleWorkspace(stranger).workspace.templates.length, 0);
    assert.equal(store.visibleWorkspace(supervisor).workspace.projects.length, 1);
    let record = sample.cases[0];
    assert.throws(() => store.command(supervisor, {type: 'save', recordId: record.id, expectedRevision: record.revision, operationId: record.events[0].operationId}), /历史记录/);
    const request = {type: 'submit', operationId: 'instruction-submit', recordId: record.id, expectedRevision: record.revision, values: {'instruction-no': 'T-1', issue: '整改', deadline: '2026-12-01', items: JSON.stringify([{position: 'A', issue: '记录缺失', quantity: '2'}])}};
    assert.throws(() => store.command(contractor, {...request, role: '专业监理'}), /未获授权/);
    record = store.command(supervisor, request).record;
    assert.equal(record.events.at(-1).actor.id, supervisor.id);
    assert.equal(store.command(supervisor, request).record.revision, record.revision);
    assert.throws(() => store.command(supervisor, {...request, values: {issue: 'changed'}}), /不同请求/);
    assert.throws(() => store.command(supervisor, {...request, operationId: 'stale-submit'}), /其他人更新/);
    record = store.command(supervisor, {type: 'advance', operationId: 'instruction-issue', recordId: record.id, expectedRevision: record.revision, values: {'issue-note': '签发'}}).record;
    const create = {type: 'create', operationId: 'create-reply-1', projectId: 'demo-project', templateId: 'app-reply', sourceId: record.id, relationId: 'instruction-reply'};
    let reply = store.command(contractor, create).record;
    assert.equal(store.command(contractor, {...create, operationId: 'create-reply-2'}).record.id, reply.id);
    assert.throws(() => store.command(contractor, {...create, operationId: 'cross-project', projectId: sample.projects[1].id}), /未获授权/);
    const operation = (user, type, values, note = '') => {
      reply = store.command(user, {type, values, note, recordId: reply.id, operationId: crypto.randomUUID(), expectedRevision: reply.revision}).record;
    };
    operation(contractor, 'submit', {response: '已整改', date: '2026-11-02'});
    operation(supervisor, 'advance', {result: '不通过', 'review-note': '缺少照片'}, '补照片');
    assert.equal(reply.status, 'draft');
    operation(contractor, 'submit', {response: '已补照片'});
    operation(supervisor, 'advance', {result: '通过', 'review-note': '复查通过'});
    let archive = store.command(supervisor, {type: 'create', operationId: 'create-archive', projectId: 'demo-project', templateId: 'app-recheck', sourceId: reply.id, relationId: 'reply-recheck'}).record;
    archive = store.command(supervisor, {type: 'submit', operationId: 'archive-submit', recordId: archive.id, expectedRevision: archive.revision}).record;
    archive = store.command(supervisor, {type: 'advance', operationId: 'archive-receipt', recordId: archive.id, expectedRevision: archive.revision, values: {'archive-no': 'ARCH-1'}}).record;
    assert.equal(archive.status, 'complete');
    const definitions = structuredClone(sample);
    definitions.templates[0].title = '监理指令单新版';
    assert.throws(() => store.updateDefinitions(admin, definitions), /版本号/);
    definitions.templates[0].version++;
    store.updateDefinitions(admin, definitions);
    assert.equal(store.visibleWorkspace(supervisor).workspace.cases.find(item => item.id === record.id).template.version, 1);
    assert.equal(store.visibleWorkspace(supervisor).workspace.templates.find(item => item.id === record.template.id).version, 2);
    assert.equal(store.visibleWorkspace(supervisor).workspace.cases.find(item => item.id === reply.id).status, 'complete');
    const contractorSession = await store.login('contractor', password);
    store.setDisabled(admin, {userId: contractor.id, disabled: true});
    assert.throws(() => store.session(contractorSession.token), /过期/);
    await assert.rejects(store.login('contractor', password), /密码/);
    store.setDisabled(admin, {userId: contractor.id, disabled: false});
    const before = store.visibleWorkspace(supervisor);
    await store.backup(join(directory, 'backup.sqlite'));
    store.close();
    store = openTeamStore(join(directory, 'team.sqlite'));
    assert.deepEqual(store.visibleWorkspace(supervisor), before);
    const restored = openTeamStore(join(directory, 'backup.sqlite'));
    try { assert.deepEqual(restored.visibleWorkspace(supervisor), before); }
    finally { restored.close(); }
    store.setMembership(admin, {userId: contractor.id, projectId: 'demo-project', roles: []});
    assert.throws(() => store.command(contractor, create), /项目权限/);
    const auth = await store.login('admin', password);
    assert.equal(store.session(auth.token).id, admin.id);
    await store.changePassword(admin, password, password + '-new');
    assert.throws(() => store.session(auth.token), /过期/);
    await assert.rejects(store.login('admin', password), /密码/);
    assert.ok(store.audit(admin).length > 10);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('HTTP session cookies, same-origin protection and authenticated API boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-http-'));
  const origin = 'http://127.0.0.1:4186';
  const {server, store} = createTeamServer({database: join(directory, 'team.sqlite'), origin});
  const httpAdmin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
  await store.createUser(httpAdmin, {username: 'member', name: 'Member', password});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const fetch = (url, options = {}) => new Promise((resolve, reject) => {
    const request = http.request(url, options, response => {
      response.resume();
      response.on('end', () => resolve({status: response.statusCode, headers: {get: name => {const value = response.headers[name]; return Array.isArray(value) ? value[0] : value;}}}));
    });
    request.on('error', reject);
    request.end(options.body);
  });
  const headers = {'Host': '127.0.0.1:4186', 'Content-Type': 'application/json', 'X-FlowLens-Request': '1'};
  try {
    assert.equal((await fetch(base + '/api/team/workspace', {headers})).status, 401);
    assert.equal((await fetch(base + '/api/team/operations', {headers})).status, 401);
    assert.equal((await fetch(base + '/api/team/login', {method: 'POST', headers: {...headers, Origin: 'https://attacker.invalid'}, body: '{}'})).status, 403);
    const response = await fetch(base + '/api/team/login', {method: 'POST', headers, body: JSON.stringify({username: 'admin', password})});
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const authenticated = {...headers, Cookie: cookie.split(';')[0]};
    assert.equal((await fetch(base + '/api/team/operations', {headers: authenticated})).status, 200);
    const memberLogin = await fetch(base + '/api/team/login', {method: 'POST', headers, body: JSON.stringify({username: 'member', password})});
    const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/api/team/operations', {headers: {...headers, Cookie: memberCookie}})).status, 403);
    assert.equal((await fetch(base + '/api/team/workspace', {headers: authenticated})).status, 200);
    const withoutMarker = {...authenticated}; delete withoutMarker['X-FlowLens-Request'];
    assert.equal((await fetch(base + '/api/team/logout', {method: 'POST', headers: withoutMarker, body: '{}'})).status, 403);
    assert.equal((await fetch(base + '/.local/team.sqlite', {headers})).status, 404);
    await fetch(base + '/api/team/logout', {method: 'POST', headers: authenticated, body: '{}'});
    assert.equal((await fetch(base + '/api/team/me', {headers: authenticated})).status, 401);
    // Many successful users can share a reverse proxy without exhausting its limit.
    for (let index = 0; index < 22; index++) {
      assert.equal((await fetch(base + '/api/team/login', {method: 'POST', headers, body: JSON.stringify({username: 'admin', password})})).status, 200);
    }
    const failures = await Promise.all(Array.from({length: 25}, () => fetch(base + '/api/team/login', {method: 'POST', headers, body: JSON.stringify({username: 'missing', password})})));
    assert.equal(failures.filter(result => result.status === 401).length, 20);
    assert.equal(failures.filter(result => result.status === 429).length, 5);
    assert.equal((await fetch(base + '/api/team/login', {method: 'POST', headers, body: JSON.stringify({username: 'MISSING', password})})).status, 429);
    assert.equal((await fetch(base + '/api/team/login', {method: 'POST', headers, body: JSON.stringify({username: 'admin', password})})).status, 200);
    // Varying account names still consumes the source address failure allowance.
    for (let index = 0; index < 80; index++) {
      assert.equal((await fetch(base + '/api/team/login', {method: 'POST', headers, body: JSON.stringify({username: 'missing-' + index, password})})).status, 401);
    }
    assert.equal((await fetch(base + '/api/team/login', {method: 'POST', headers, body: JSON.stringify({username: 'admin', password})})).status, 429);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
});
