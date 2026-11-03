import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applicationDemo} from './apps-demo.mjs';
import {createProject} from './apps-model.mjs';
import {openTeamStore} from './team-store.mjs';
import {createTeamServer} from './team-server.mjs';

const password = 'summary-test-password';
function largeFixture() {
  const fixture = applicationDemo(), original = fixture.cases[0];
  fixture.cases = Array.from({length: 61}, (_, index) => ({...structuredClone(original), id: 'page-record-' + index, values: {...original.values, issue: index === 60 ? 'LAST-NEEDLE' : 'x'.repeat(10000)}}));
  fixture.cases[60].submitter = '历史填报人';
  const other = createProject(fixture.applications[0].id, 'private-project-marker'); fixture.projects.push(other);
  fixture.cases.push({...structuredClone(original), id: 'private-record', projectId: other.id, project: other.name, provenance: [], submitter: 'private-role', values: {...original.values, issue: 'private-value-marker'}});
  return fixture;
}

test('summary pages omit heavy fields, retain whole-project counts and roles, and isolate other projects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-summary-'));
  const store = openTeamStore(join(directory, 'team.sqlite'));
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password});
    store.importApplication(admin, largeFixture());
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: ['专业监理']});
    const before = store.visibleWorkspace(admin, {inlineAttachments: false});
    const first = store.visibleWorkspace(member, {summary: {projectId: 'demo-project'}});
    assert.equal(first.workspace.cases.length, 50); assert.equal(first.listing.total, 61); assert.equal(first.listing.pending, 60);
    assert.equal(first.projection, 'summary');
    assert.equal(first.workspace.cases[0].values, undefined); assert.equal(first.workspace.cases[0].events, undefined);
    assert.equal(first.workspace.cases[0].template.blocks, undefined); assert.equal(first.workspace.templates[0].fields, undefined);
    assert.ok(first.roleOptions['demo-project'].includes('历史填报人'));
    assert.ok(!JSON.stringify(first).includes('private-'));
    const second = store.visibleWorkspace(member, {summary: {page: '2'}});
    assert.equal(second.workspace.cases.length, 11);
    assert.equal(new Set([...first.workspace.cases, ...second.workspace.cases].map(item => item.id)).size, 61);
    assert.equal(store.visibleWorkspace(member, {summary: {page: '999'}}).listing.page, 2);
    const pending = store.visibleWorkspace(member, {summary: {page: '2', filter: 'pending'}});
    assert.equal(pending.workspace.cases.length, 10); assert.equal(pending.listing.pending, 60);
    const search = store.visibleWorkspace(member, {summary: {search: 'last-needle'}});
    assert.equal(search.workspace.cases[0].id, 'page-record-60'); assert.equal(search.listing.matched, 1);
    assert.equal(store.getRecord(member, 'page-record-60').record.values.issue, 'LAST-NEEDLE');
    const selected = store.visibleWorkspace(member, {summary: {page: '1', filter: 'pending', recordId: 'page-record-60'}});
    assert.equal(selected.record.id, 'page-record-60');
    assert.equal(selected.record.values.issue, 'LAST-NEEDLE');
    assert.equal(selected.workspace.cases.some(item => item.id === selected.record.id), false);
    assert.throws(() => store.visibleWorkspace(member, {summary: {recordId: 'private-record'}}), error => error.status === 404);
    assert.throws(() => store.getRecord(member, 'private-record'), /不可访问/);
    const legacy = store.visibleWorkspace(member, {inlineAttachments: false});
    assert.equal(legacy.workspace.cases.length, 61); assert.ok(legacy.workspace.cases[0].template.blocks);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) < Buffer.byteLength(JSON.stringify(legacy)) / 10);
    for (const summary of [{page: '0'}, {page: '1.5'}, {page: 'bad'}, {filter: 'bad'}, {search: 'x'.repeat(201)}]) assert.throws(() => store.visibleWorkspace(member, {summary}), /参数无效/);
    assert.deepEqual(store.visibleWorkspace(admin, {inlineAttachments: false}), before);
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: []});
    assert.throws(() => store.getRecord(member, 'page-record-60'), /不可访问/);
    const revoked = store.visibleWorkspace(member, {summary: {projectId: 'demo-project'}});
    assert.equal(revoked.workspace.projects.length, 0); assert.equal(revoked.listing.total, 0);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('HTTP protocol 3 lists summaries and reads complete records while protocol 2 and legacy stay complete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-summary-http-'));
  const {server, store} = createTeamServer({database: join(directory, 'team.sqlite')});
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    store.importApplication(admin, applicationDemo());
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password});
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: ['专业监理']});
    const session = await store.login('member', password);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    function request(path, version, data, authenticated = true) {
      return new Promise((resolve, reject) => {
        const req = http.request({hostname: '127.0.0.1', port: server.address().port, path, method: data ? 'POST' : 'GET', headers: {Host: '127.0.0.1:4186', 'Content-Type': 'application/json', 'X-FlowLens-Request': '1', ...(version ? {'X-FlowLens-Client': version} : {}), ...(authenticated ? {Cookie: 'flowlens_session=' + session.token} : {})}}, response => {
          let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk); response.on('end', () => resolve({status: response.statusCode, body: JSON.parse(body)}));
        }); req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
      });
    }
    const summary = await request('/api/team/workspace', '3'); assert.equal(summary.status, 200);
    const identity = await request('/api/team/me', '3');
    assert.deepEqual(identity.body.context, store.serviceContext(member));
    const login = await request('/api/team/login', '3', {username: 'member', password}, false);
    assert.equal(login.status, 200); assert.deepEqual(login.body.context, identity.body.context);
    const guarded = await request('/api/team/command', '3', {type: 'create', projectId: 'demo-project', templateId: summary.body.workspace.templates[0].id, operationId: crypto.randomUUID(), expectedInstanceId: 'old-instance'});
    assert.equal(guarded.status, 409);
    const id = summary.body.workspace.cases[0].id;
    assert.equal(summary.body.workspace.cases[0].values, undefined);
    for (const version of [undefined, '2']) assert.ok((await request('/api/team/workspace', version)).body.workspace.cases[0].values);
    const detail = await request('/api/team/record?recordId=' + id, '3'); assert.equal(detail.status, 200); assert.ok(detail.body.record.template.blocks);
    const combined = await request('/api/team/workspace?search=no-match&recordId=' + id, '3');
    assert.equal(combined.status, 200); assert.equal(combined.body.listing.matched, 0);
    assert.deepEqual(combined.body.record, detail.body.record);
    assert.equal((await request('/api/team/record?recordId=' + id, '3', undefined, false)).status, 401);
    const changed = await request('/api/team/command', '3', {type: 'save', recordId: id, expectedRevision: detail.body.record.revision, operationId: crypto.randomUUID(), values: {issue: 'After summary read'}});
    assert.equal(changed.status, 200); assert.equal(changed.body.record.values.issue, 'After summary read');
    assert.equal((await request('/api/team/record?recordId=' + id, '3')).body.record.revision, changed.body.record.revision);
    assert.equal((await request('/api/team/workspace?page=bad', '3')).status, 400);
    const attached = await request('/api/team/command', '3', {type: 'attachment', recordId: id, expectedRevision: changed.body.record.revision, operationId: crypto.randomUUID(), attachment: {name: 'test.bin', data: 'data:application/octet-stream;base64,AAEC'}});
    assert.equal(attached.status, 200); assert.equal(attached.body.record.attachments[0].data, undefined);
    assert.equal((await request('/api/team/record?recordId=' + id, '3')).body.record.attachments[0].data, undefined);
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: []});
    assert.equal((await request('/api/team/record?recordId=' + id, '3')).status, 404);
    assert.equal((await request('/api/team/workspace', '3')).body.listing.total, 0);

  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true}); }
});
