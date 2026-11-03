import http from 'node:http';
import {unzipSync} from './team-vendor/fflate.mjs';
import {buildProjectArchive, projectExportLimit} from './team-project-export.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTeamStore} from './team-store.mjs';
import {createTeamServer} from './team-server.mjs';
import {applicationDemo} from './apps-demo.mjs';
import {createProject} from './apps-model.mjs';
import {DatabaseSync} from 'node:sqlite';

const password = 'test-only-long-password';

test('service context persists across connections and guards commands before writes or replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-context-'));
  const filename = join(directory, 'team.sqlite');
  let store = openTeamStore(filename);
  const other = openTeamStore(join(directory, 'other.sqlite'));
  let peer, inspection;
  try {
    const user = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    const otherUser = await other.createUser(null, {username: 'admin', name: 'Other', password});
    const context = store.serviceContext(user);
    assert.match(context.instanceId, /^[0-9a-f-]{36}$/);
    assert.notEqual(other.serviceContext(otherUser).instanceId, context.instanceId);
    peer = openTeamStore(filename);
    assert.deepEqual(peer.serviceContext(user), context);
    store.close(); store = openTeamStore(filename);
    assert.deepEqual(store.serviceContext(user), context);
    store.importApplication(user, applicationDemo());
    store.setMembership(user, {userId: user.id, projectId: 'demo-project', roles: ['专业监理']});
    const command = {type: 'create', projectId: 'demo-project', templateId: applicationDemo().templates[0].id, operationId: crypto.randomUUID(), expectedInstanceId: context.instanceId};
    const result = store.command(user, command);
    assert.deepEqual(peer.command(user, command), result);
    const before = store.visibleWorkspace(user);
    const auditBefore = store.audit(user);
    inspection = new DatabaseSync(filename);
    inspection.prepare('UPDATE maintenance SET data=? WHERE key=?').run(JSON.stringify({id: crypto.randomUUID()}), 'instance');
    assert.throws(() => store.command(user, command), error => error.status === 409);
    assert.throws(() => store.command(user, {...command, operationId: crypto.randomUUID()}), error => error.status === 409);
    assert.deepEqual(store.visibleWorkspace(user), before);
    assert.deepEqual(store.audit(user), auditBefore);
    assert.notEqual(peer.serviceContext(user).instanceId, context.instanceId);
    store.setMembership(user, {userId: user.id, projectId: 'demo-project', roles: []});
    assert.throws(() => store.command(user, {...command, expectedInstanceId: store.serviceContext(user).instanceId, operationId: crypto.randomUUID()}), error => error.status === 403);
  } finally {
    inspection?.close(); peer?.close(); other.close(); store.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('inline imports normalize legacy attachment metadata and reject external blob references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-attachment-import-'));
  const store = openTeamStore(join(directory, 'team.sqlite'));
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    const app = applicationDemo();
    app.cases[0].attachments.push({id: '\ud800', name: 'legacy.bin', size: 999, blobId: 'f'.repeat(64), data: 'data:application/octet-stream;base64,VQ=='});
    store.importApplication(admin, app);
    const record = store.visibleWorkspace(admin, {inlineAttachments: false}).workspace.cases[0];
    const file = record.attachments[0];
    assert.equal(file.id.isWellFormed(), true);
    assert.equal(file.size, 1);
    assert.notEqual(file.blobId, 'f'.repeat(64));
    assert.deepEqual(store.attachment(admin, record.id, file.id).data, Buffer.from([85]));
    assert.equal(app.cases[0].attachments[0].id, '\ud800');
    assert.throws(() => store.importApplication(admin, store.visibleWorkspace(admin, {inlineAttachments: false}).workspace), /附件格式/);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('attachment HTTP downloads require current project access and new clients receive references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-attachment-http-'));
  const {server, store} = createTeamServer({database: join(directory, 'team.sqlite')});
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password});
    store.importApplication(admin, applicationDemo());
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: ['专业监理']});
    const source = store.visibleWorkspace(member).workspace.cases[0];
    const bytes = Buffer.from([0, 255, 1, 129]);
    const record = store.command(member, {type: 'attachment', recordId: source.id, expectedRevision: source.revision, operationId: crypto.randomUUID(), attachment: {name: '证明".bin', data: 'data:application/octet-stream;base64,' + bytes.toString('base64')}}, {inlineAttachments: false}).record;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    function request(path, {data, cookie, rawBody, restoreOptions, modern = true} = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request({hostname: '127.0.0.1', port: server.address().port, path, method: data || rawBody ? 'POST' : 'GET', headers: {Host: '127.0.0.1:4186', 'Content-Type': rawBody ? 'application/zip' : 'application/json', 'X-FlowLens-Request': '1', ...(modern ? {'X-FlowLens-Client': '2'} : {}), ...(restoreOptions ? {'X-FlowLens-Restore': encodeURIComponent(JSON.stringify(restoreOptions))} : {}), ...(cookie ? {Cookie: cookie} : {})}}, response => {
          const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks)}));
        });
        req.on('error', reject); req.end(rawBody ?? (data ? JSON.stringify(data) : undefined));
      });
    }
    const login = await request('/api/team/login', {data: {username: 'member', password}});
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const path = '/api/team/attachment?recordId=' + encodeURIComponent(record.id) + '&attachmentId=' + encodeURIComponent(record.attachments[0].id);
    assert.equal((await request(path)).status, 401);
    const download = await request(path, {cookie});
    assert.equal(download.status, 200);
    assert.equal(download.headers['content-type'], 'application/octet-stream');
    assert.match(download.headers['content-disposition'], /filename\*=UTF-8''/);
    assert.deepEqual(download.bytes, bytes);
    const exportPath = '/api/team/project-export?projectId=demo-project';
    assert.equal((await request(exportPath)).status, 401);
    const exported = await request(exportPath, {cookie});
    assert.equal(exported.status, 200);
    assert.equal(exported.headers['content-type'], 'application/zip');
    assert.ok(unzipSync(exported.bytes)['index.html']);
    assert.equal((await request('/api/team/project-check', {cookie, rawBody: exported.bytes})).status, 403);
    const adminLogin = await request('/api/team/login', {data: {username: 'admin', password}});
    const adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];
    const checked = await request('/api/team/project-check', {cookie: adminCookie, rawBody: exported.bytes});
    assert.equal(checked.status, 200);
    assert.equal(JSON.parse(checked.bytes).integrityPassed, true);
    const beforeCheckFailure = store.visibleWorkspace(admin, {inlineAttachments: false});
    assert.equal((await request('/api/team/project-check', {cookie: adminCookie, rawBody: Buffer.from('invalid zip')})).status, 400);
    assert.deepEqual(store.visibleWorkspace(admin, {inlineAttachments: false}), beforeCheckFailure);
    assert.equal((await request('/api/team/project-check', {cookie: adminCookie, rawBody: exported.bytes})).status, 200);
    const checkedReport = JSON.parse(checked.bytes);
    const restoreOptions = {operationId: crypto.randomUUID(), projectName: 'HTTP restored project', archiveSha256: checkedReport.archiveSha256, expectedRevision: checkedReport.targetRevision, memberships: [{userId: member.id, roles: ['专业监理']}]};
    const preview = await request('/api/team/project-restore-preview', {cookie: adminCookie, rawBody: exported.bytes, restoreOptions});
    assert.equal(preview.status, 200);
    const confirmedOptions = {...restoreOptions, confirmed: true, planFingerprint: JSON.parse(preview.bytes).planFingerprint};
    assert.equal((await request('/api/team/project-restore', {cookie, rawBody: exported.bytes, restoreOptions: confirmedOptions})).status, 403);
    const restored = await request('/api/team/project-restore', {cookie: adminCookie, rawBody: exported.bytes, restoreOptions: confirmedOptions});
    assert.equal(restored.status, 200);
    assert.deepEqual((await request('/api/team/project-restore', {cookie: adminCookie, rawBody: exported.bytes, restoreOptions: confirmedOptions})).bytes, restored.bytes);
    assert.equal(store.visibleWorkspace(admin, {inlineAttachments: false}).workspace.projects.length, 2);


    const modern = JSON.parse((await request('/api/team/workspace', {cookie})).bytes);
    assert.equal(modern.workspace.cases[0].attachments[0].data, undefined);
    const legacy = JSON.parse((await request('/api/team/workspace', {cookie, modern: false})).bytes);
    assert.ok(legacy.workspace.cases[0].attachments[0].data.startsWith('data:'));
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: []});
    assert.equal((await request(path, {cookie})).status, 404);
    assert.equal((await request(exportPath, {cookie})).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true}); }
});

test('three eight-MiB attachments fit without expanding workspace and retry JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-attachment-capacity-'));
  const filename = join(directory, 'team.sqlite');
  const store = openTeamStore(filename);
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    store.importApplication(admin, applicationDemo());
    store.setMembership(admin, {userId: admin.id, projectId: 'demo-project', roles: ['专业监理']});
    let record = store.visibleWorkspace(admin).workspace.cases[0];
    for (let index = 0; index < 3; index++) {
      const data = 'data:application/octet-stream;base64,' + Buffer.alloc(8 * 1024 * 1024, index + 1).toString('base64');
      record = store.command(admin, {type: 'attachment', recordId: record.id, expectedRevision: record.revision, operationId: crypto.randomUUID(), attachment: {name: 'large-' + index, data}}, {inlineAttachments: false}).record;
    }
    assert.equal(record.attachments.length, 3);
    assert.ok(record.attachments.every(file => file.data === undefined));
    assert.ok(store.operations(admin).workspaceBytes < 256 * 1024);
    assert.equal(store.operations(admin).attachmentBytes, 24 * 1024 * 1024);
    assert.throws(() => store.visibleWorkspace(admin), /旧客户端/);
    assert.equal(store.visibleWorkspace(admin, {inlineAttachments: false}).workspace.cases[0].attachments.length, 3);
    for (let index = 0; index < 3; index++) assert.deepEqual(store.attachment(admin, record.id, record.attachments[index].id).data, Buffer.alloc(8 * 1024 * 1024, index + 1));
    const inspection = new DatabaseSync(filename);
    assert.ok(inspection.prepare('SELECT SUM(length(result)) AS n FROM requests').get().n < 256 * 1024);
    inspection.close();
    await store.backup(join(directory, 'full.sqlite'));
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('a late migration failure leaves the original workspace and database version intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-migration-failure-'));
  const filename = join(directory, 'team.sqlite');
  const store = openTeamStore(filename);
  const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
  store.importApplication(admin, applicationDemo());
  const workspace = store.visibleWorkspace(admin).workspace;
  workspace.cases[0].attachments.push({name: 'legacy.txt', size: 1, data: 'data:text/plain;base64,QQ=='});
  store.close();
  const inspection = new DatabaseSync(filename);
  try {
    inspection.prepare('UPDATE workspace SET data=?').run(JSON.stringify(workspace));
    inspection.prepare('INSERT INTO requests VALUES(?,?,?,?)').run('broken-history', admin.id, 'fingerprint', 'not-json');
    inspection.exec('DROP TABLE attachment_blobs; PRAGMA user_version=1');
    const original = inspection.prepare('SELECT data FROM workspace').get().data;
    assert.throws(() => openTeamStore(filename));
    assert.equal(inspection.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(inspection.prepare('SELECT data FROM workspace').get().data, original);
    assert.equal(inspection.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='attachment_blobs'").get().n, 0);
    assert.equal((await readdir(directory)).filter(file => file.includes('.before-attachments-')).length, 1);
  } finally { inspection.close(); await rm(directory, {recursive: true, force: true}); }
});

test('inline attachments and historical retry results migrate with a pre-migration snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-attachment-migration-'));
  const filename = join(directory, 'team.sqlite');
  let store = openTeamStore(filename);
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    store.importApplication(admin, applicationDemo());
    store.setMembership(admin, {userId: admin.id, projectId: 'demo-project', roles: ['专业监理']});
    const record = store.visibleWorkspace(admin).workspace.cases[0];
    const data = 'data:text/plain;base64,' + Buffer.from('迁移附件\nlegacy evidence').toString('base64');
    const request = {type: 'attachment', recordId: record.id, expectedRevision: record.revision, operationId: crypto.randomUUID(), attachment: {name: '原附件.txt', data}};
    const result = store.command(admin, request);
    const before = store.visibleWorkspace(admin);
    store.close(); store = null;
    // Recreate the on-disk layout used by 1.5, including an inline cached response.
    const legacy = new DatabaseSync(filename);
    const saved = structuredClone(before.workspace); delete saved.storageRevision;
    legacy.prepare('UPDATE workspace SET data=? WHERE id=1').run(JSON.stringify(saved));
    legacy.prepare('UPDATE requests SET result=? WHERE id=?').run(JSON.stringify(result), request.operationId);
    legacy.exec('DROP TABLE attachment_blobs; PRAGMA user_version=1'); legacy.close();
    store = openTeamStore(filename);
    assert.deepEqual(store.visibleWorkspace(admin), before);
    assert.deepEqual(store.command(admin, request), result);
    const metadata = store.visibleWorkspace(admin, {inlineAttachments: false}).workspace.cases[0].attachments[0];
    assert.equal(metadata.data, undefined);
    assert.equal(store.attachment(admin, record.id, metadata.id).data.toString(), '迁移附件\nlegacy evidence');
    const inspect = new DatabaseSync(filename);
    assert.equal(inspect.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM attachment_blobs').get().n, 1);
    assert.ok(!inspect.prepare('SELECT result FROM requests WHERE id=?').get(request.operationId).result.includes(';base64,'));
    inspect.close();
    const files = (await readdir(directory)).filter(file => file.includes('.before-attachments-'));
    assert.equal(files.length, 1);
    const snapshot = new DatabaseSync(join(directory, files[0]), {readOnly: true});
    assert.equal(snapshot.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(JSON.parse(snapshot.prepare('SELECT data FROM workspace').get().data).cases[0].attachments[0].data, data);
    snapshot.close();
    assert.equal(store.operations(admin).lastAttachmentMigration.compacted, true);
  } finally { store?.close(); await rm(directory, {recursive: true, force: true}); }
});

test('blob storage is transactional, deduplicated and scoped to project membership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-attachment-blob-'));
  const filename = join(directory, 'team.sqlite');
  const store = openTeamStore(filename);
  const inspection = new DatabaseSync(filename);
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    const stranger = await store.createUser(admin, {username: 'stranger', name: 'Stranger', password});
    store.importApplication(admin, applicationDemo());
    store.setMembership(admin, {userId: admin.id, projectId: 'demo-project', roles: ['专业监理']});
    let record = store.visibleWorkspace(admin).workspace.cases[0];
    const data = 'data:application/octet-stream;base64,' + Buffer.from([0, 1, 255, 128]).toString('base64');
    const request = {type: 'attachment', recordId: record.id, expectedRevision: record.revision, operationId: crypto.randomUUID(), attachment: {name: 'binary.bin', data}};
    inspection.exec("CREATE TRIGGER reject_attachment BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'attachment rollback'); END");
    assert.throws(() => store.command(admin, request, {inlineAttachments: false}), /attachment rollback/);
    assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM attachment_blobs').get().n, 0);
    inspection.exec('DROP TRIGGER reject_attachment');
    record = store.command(admin, request, {inlineAttachments: false}).record;
    assert.deepEqual(store.command(admin, request, {inlineAttachments: false}).record, record);
    assert.equal(record.attachments.length, 1);
    const file = record.attachments[0];
    assert.throws(() => store.attachment(stranger, record.id, file.id), error => error.status === 404);
    assert.deepEqual(store.attachment(admin, record.id, file.id).data, Buffer.from([0, 1, 255, 128]));
    record = store.command(admin, {...request, expectedRevision: record.revision, operationId: crypto.randomUUID()}, {inlineAttachments: false}).record;
    assert.equal(record.attachments.length, 2);
    assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM attachment_blobs').get().n, 1);
    inspection.prepare('UPDATE attachment_blobs SET data=zeroblob(size)').run();
    assert.throws(() => store.attachment(admin, record.id, file.id), error => error.status === 500);
    await assert.rejects(store.backup(join(directory, 'corrupt.sqlite')), /校验失败/);
    assert.equal(store.operations(admin).lastBackup, null);
  } finally { inspection.close(); store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('delivery confirmations preserve attribution, reject stale writes and require review after configuration changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-delivery-'));
  const filename = join(directory, 'team.sqlite');
  const store = openTeamStore(filename);
  const inspection = new DatabaseSync(filename);
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Actual admin', password});
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password});
    store.importApplication(admin, applicationDemo());
    const scope = 'project:demo-project';
    const report = store.deliveryReport(admin, scope);
    assert.ok(report.checks.every(item => item.effectiveStatus === 'pending' && item.revision === 0));
    assert.throws(() => store.deliveryReport(member, scope), error => error.status === 403);
    assert.throws(() => store.deliveryReport(admin, 'project:missing'), error => error.status === 404);
    const request = {scope, checkId: 'forms', expectedRevision: 0, expectedContextFingerprint: report.contextFingerprint, expectedRestoreMarker: report.restoreMarker, status: 'passed', reviewer: 'Fictional reviewer', evidence: 'Fictional table verified in test', operationId: crypto.randomUUID(), actor: {name: 'Forged'}};
    assert.throws(() => store.updateDelivery(member, request), error => error.status === 403);
    assert.throws(() => store.updateDelivery(admin, {...request, reviewer: ''}), /确认人和依据/);
    assert.throws(() => store.updateDelivery(admin, {...request, checkId: 'unknown'}), /检查项/);
    const result = store.updateDelivery(admin, request);
    assert.equal(result.record.actor.name, 'Actual admin');
    assert.deepEqual(store.updateDelivery(admin, request), result);
    assert.equal(store.deliveryReport(admin, scope).history.length, 1);
    assert.throws(() => store.updateDelivery(admin, {...request, operationId: crypto.randomUUID()}), error => error.status === 409);
    assert.throws(() => store.updateDelivery(admin, {...request, evidence: 'Changed payload'}), error => error.status === 409);
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: ['专业监理']});
    assert.equal(store.deliveryReport(admin, scope).checks[0].effectiveStatus, 'needs-review');
    assert.throws(() => store.updateDelivery(admin, {...request, expectedRevision: 1, operationId: crypto.randomUUID()}), /配置已变化/);
    const next = {...request, expectedRevision: 1, expectedContextFingerprint: store.deliveryReport(admin, scope).contextFingerprint, operationId: crypto.randomUUID()};
    inspection.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'delivery transaction failure'); END");
    assert.throws(() => store.updateDelivery(admin, next), /delivery transaction failure/);
    assert.equal(store.deliveryReport(admin, scope).history.length, 1);
    assert.equal(store.deliveryReport(admin, scope).checks[0].revision, 1);
    inspection.exec('DROP TRIGGER fail_delivery');
    store.updateDelivery(admin, next);
    assert.equal(store.deliveryReport(admin, scope).checks[0].effectiveStatus, 'passed');
    const definitions = applicationDemo(); definitions.templates[0].version++; definitions.templates[0].title += ' v2';
    store.updateDefinitions(admin, definitions);
    assert.equal(store.deliveryReport(admin, scope).checks[0].effectiveStatus, 'needs-review');
    const instance = {...request, scope: 'instance', checkId: 'https', expectedContextFingerprint: store.deliveryReport(admin, 'instance', 'https://first.example').contextFingerprint, operationId: crypto.randomUUID()};
    store.updateDelivery(admin, instance, 'https://first.example');
    assert.equal(store.deliveryReport(admin, 'instance', 'https://first.example').checks[0].effectiveStatus, 'passed');
    assert.equal(store.deliveryReport(admin, 'instance', 'https://second.example').checks[0].effectiveStatus, 'needs-review');
  } finally { inspection.close(); store.close(); await rm(directory, {recursive: true, force: true}); }
});

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


test('project handoff includes scoped records, offline forms and verified original files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-handoff-'));
  const store = openTeamStore(join(directory, 'team.sqlite'));
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password});
    const app = applicationDemo();
    const other = createProject(app.applications[0].id, 'Private project marker');
    app.projects.push(other);
    const otherRecord = structuredClone(app.cases[0]);
    otherRecord.id = 'private-record'; otherRecord.projectId = other.id; otherRecord.project = other.name;
    otherRecord.values = {}; otherRecord.provenance = []; app.cases.push(otherRecord);
    app.projects[0].name = '<script>project</script>';
    app.cases[0].attachments.push({id: 'a', name: '../same\\<img src=x>.png', size: 4, data: 'data:application/octet-stream;base64,AP8BgQ=='});
    app.cases[0].attachments.push({id: 'b', name: '../same\\<img src=x>.png', size: 1, data: 'data:application/octet-stream;base64,VQ=='});
    store.importApplication(admin, app);
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: ['专业监理']});
    const before = store.visibleWorkspace(member, {inlineAttachments: false});
    const zip = store.projectArchive(member, 'demo-project');
    const files = unzipSync(zip);
    const manifest = JSON.parse(Buffer.from(files['manifest.json']));
    assert.equal(manifest.files.length, Object.keys(files).length - 1);
    for (const item of manifest.files) {
      assert.equal(item.bytes, files[item.path].length);
      assert.equal(item.sha256, createHash('sha256').update(files[item.path]).digest('hex'));
      assert.ok(!item.path.includes('..'));
    }
    const data = JSON.parse(Buffer.from(files['project.json']));
    assert.equal(data.records.length, 1);
    assert.equal(data.project.id, 'demo-project');
    assert.equal(data.records[0].events.length, app.cases[0].events.length);
    assert.deepEqual(Buffer.from(files[data.records[0].attachments[0].exportPath]), Buffer.from([0, 255, 1, 129]));
    assert.deepEqual(Buffer.from(files[data.records[0].attachments[1].exportPath]), Buffer.from([85]));
    const html = Buffer.from(files['index.html']).toString();
    assert.ok(html.includes('&lt;script&gt;project&lt;/script&gt;'));
    assert.ok(!html.includes('<img src=x>'));
    assert.ok(Object.values(files).every(bytes => !Buffer.from(bytes).includes('Private project marker')));
    assert.ok(!Object.hasOwn(data, 'users'));
    assert.deepEqual(store.visibleWorkspace(member, {inlineAttachments: false}), before);
    assert.throws(() => store.projectArchive(member, other.id), /不可访问/);
    store.setMembership(admin, {userId: member.id, projectId: 'demo-project', roles: []});
    assert.throws(() => store.projectArchive(member, 'demo-project'), /不可访问/);
    store.setDisabled(admin, {userId: member.id, disabled: true});
    assert.throws(() => store.projectArchive(member, 'demo-project'), /停用/);
    assert.ok(store.projectArchive(admin, other.id).length);
    const db = new DatabaseSync(join(directory, 'team.sqlite'));
    db.prepare('UPDATE attachment_blobs SET data=?').run(Buffer.from([99])); db.close();
    assert.throws(() => store.projectArchive(admin, 'demo-project'), /校验失败/);
    assert.equal(store.visibleWorkspace(admin, {inlineAttachments: false}).workspace.cases.length, 2);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('project handoff rejects oversized attachments before reading and cross-project links', () => {
  const app = applicationDemo();
  app.cases[0].attachments = [{name: 'large.bin', size: projectExportLimit + 1}];
  assert.throws(() => buildProjectArchive(app, 'demo-project', () => assert.fail('must reject before blob read')), /64 MiB/);
  app.cases[0].attachments = [];
  app.cases[0].relatedId = 'outside-project';
  assert.throws(() => buildProjectArchive(app, 'demo-project', () => {}), /关联超出/);
});


test('project export releases its single-transfer slot after an interrupted HTTP download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-export-interrupt-'));
  const {server, store} = createTeamServer({database: join(directory, 'team.sqlite')});
  let stalled;
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password});
    const app = applicationDemo();
    for (let index = 0; index < 3; index++) app.cases[0].attachments.push({id: 'large-' + index, name: 'large.bin', size: 8 * 1024 * 1024, data: 'data:application/octet-stream;base64,' + Buffer.alloc(8 * 1024 * 1024, index).toString('base64')});
    store.importApplication(admin, app);
    const session = await store.login('admin', password);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const options = {hostname: '127.0.0.1', port: server.address().port, path: '/api/team/project-export?projectId=demo-project', headers: {Host: '127.0.0.1:4186', Cookie: 'flowlens_session=' + session.token}};
    const request = () => new Promise((resolve, reject) => { http.get(options, resolve).on('error', reject); });
    // Hold the first response body regardless of OS socket-buffer size.
    server.prependOnceListener('request', (_request, response) => {
      response.end = function () { this.flushHeaders(); return this; };
    });
    stalled = await request();
    assert.equal(stalled.statusCode, 200);
    stalled.pause();
    const busy = await request();
    assert.equal(busy.statusCode, 503); busy.resume();
    const closed = new Promise(resolve => stalled.once('close', resolve));
    stalled.destroy(); await closed;
    // Wait for the server-side close event, then consume a fresh complete transfer.
    let retry;
    for (let attempt = 0; attempt < 20; attempt++) {
      retry = await request();
      if (retry.statusCode !== 503) break;
      retry.resume();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(retry.statusCode, 200);
    const chunks = [];
    for await (const chunk of retry) chunks.push(chunk);
    assert.ok(unzipSync(Buffer.concat(chunks))['manifest.json']);
  } finally {
    stalled?.destroy(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
});
