import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import {applicationDemo} from './apps-demo.mjs';

test('standalone distribution starts without dependencies and its CLI restores data and revokes sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-package-'));
  const output = join(directory, 'runtime');
  const source = new URL('./scripts/build-team.mjs', import.meta.url);
  const database = join(directory, 'business.sqlite');
  const restoredDatabase = join(directory, 'restored.sqlite');
  let server, store;
  function cli(args, filename = database, extra = {}) {
    return spawnSync(process.execPath, ['scripts/team-admin.mjs', ...args], {
      cwd: output, encoding: 'utf8', timeout: 15000,
      env: {...process.env, FLOWLENS_DATABASE: filename, ...extra}
    });
  }
  try {
    const build = spawnSync(process.execPath, [fileURLToPath(source), output], {encoding: 'utf8', timeout: 15000});
    assert.equal(build.status, 0, build.stderr);
    const files = await readdir(output, {recursive: true});
    assert.ok(!files.some(file => /node_modules|\.sqlite|^\.env$/.test(file)));
    const manifest = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'));
    assert.equal(manifest.engines.node, '>=24');
    assert.equal(manifest.dependencies, undefined);
    const password = crypto.randomUUID();
    const initialized = cli(['init'], database, {FLOWLENS_ADMIN_PASSWORD: password, FLOWLENS_ADMIN_USER: 'admin'});
    assert.equal(initialized.status, 0, initialized.stderr);
    const {createTeamServer} = await import(pathToFileURL(join(output, 'team-server.mjs')));
    ({server, store} = createTeamServer({database, origin: 'http://127.0.0.1:4186'}));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const health = await new Promise((resolve, reject) => {
      const request = http.get({hostname: '127.0.0.1', port: server.address().port, path: '/health', headers: {Host: '127.0.0.1:4186'}}, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
    });
    assert.equal(health, 200);
    const session = await store.login('admin', password);
    store.importApplication(session.user, applicationDemo());
    store.setMembership(session.user, {userId: session.user.id, projectId: 'demo-project', roles: ['专业监理']});
    const record = store.visibleWorkspace(session.user).workspace.cases[0];
    const attachmentBytes = Buffer.from('Fictional inspection evidence\n附件恢复验收\n\x00\xff', 'utf8');
    store.command(session.user, {
      type: 'attachment', recordId: record.id, expectedRevision: record.revision,
      operationId: crypto.randomUUID(),
      attachment: {name: '验收附件.bin', data: 'data:application/octet-stream;base64,' + attachmentBytes.toString('base64')}
    });
    const before = store.visibleWorkspace(session.user);
    const backup = join(directory, 'backup.sqlite');
    const backedUp = cli(['backup', backup]);
    assert.equal(backedUp.status, 0, backedUp.stderr);
    assert.notEqual(cli(['backup', backup]).status, 0);
    await new Promise(resolve => server.close(resolve)); server = null; store = null;
    const restored = cli(['restore', backup], restoredDatabase);
    assert.equal(restored.status, 0, restored.stderr);
    const {openTeamStore} = await import(pathToFileURL(join(output, 'team-store.mjs')));
    store = openTeamStore(restoredDatabase);
    assert.throws(() => store.session(session.token), /过期/);
    const newSession = await store.login('admin', password);
    assert.deepEqual(store.visibleWorkspace(newSession.user), before);
    const restoredAttachment = store.visibleWorkspace(newSession.user).workspace.cases[0].attachments.at(-1);
    assert.equal(restoredAttachment.name, '验收附件.bin');
    assert.equal(restoredAttachment.size, attachmentBytes.length);
    assert.deepEqual(Buffer.from(restoredAttachment.data.split(',')[1], 'base64'), attachmentBytes);
    store.close(); store = null;
    const bytes = await readFile(restoredDatabase);
    assert.notEqual(cli(['restore', backup], restoredDatabase).status, 0);
    assert.deepEqual(await readFile(restoredDatabase), bytes);
    const invalid = join(directory, 'invalid.sqlite');
    await writeFile(invalid, 'invalid backup');
    assert.notEqual(cli(['restore', invalid], join(directory, 'rejected.sqlite')).status, 0);
    assert.ok(!(await readdir(directory)).includes('rejected.sqlite'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    else store?.close();
    // This directory was created by this test beneath the operating-system temp root.
    assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'), true);
    await rm(directory, {recursive: true, force: true});
  }
});
