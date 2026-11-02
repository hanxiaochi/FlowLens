import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {applicationDemo} from '../apps-demo.mjs';

const id = 'flowlens-ci-' + randomUUID();
const image = id + ':test';
const volume = id + '-data';
const password = randomUUID();
const origin = 'http://127.0.0.1:4186';
const docker = (args, options = {}) => execFileSync('docker', args, {encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'], ...options});
async function api(path, data, cookie) {
  const response = await fetch(origin + '/api/team/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {'Content-Type': 'application/json', 'X-FlowLens-Request': '1', ...(cookie ? {Cookie: cookie} : {})},
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  return {status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0]};
}
async function healthy() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await fetch(origin + '/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Error('Container health endpoint did not become ready');
}
let created = false, built = false, volumeCreated = false;
try {
  docker(['build', '-f', 'Dockerfile.team', '-t', image, '.']); built = true;
  docker(['volume', 'create', volume]); volumeCreated = true;
  docker(['run', '-d', '--name', id, '--memory=1g', '-p', '127.0.0.1:4186:4186', '-e', 'FLOWLENS_ORIGIN=' + origin, '-v', volume + ':/data', image]); created = true;
  await healthy();
  docker(['exec', '-e', 'FLOWLENS_ADMIN_PASSWORD', id, 'node', 'scripts/team-admin.mjs', 'init'], {env: {...process.env, FLOWLENS_ADMIN_PASSWORD: password}});
  const admin = await api('login', {username: 'admin', password}); assert.equal(admin.status, 200);
  assert.equal((await api('import', applicationDemo(), admin.cookie)).status, 200);
  assert.equal((await api('membership', {userId: admin.body.user.id, projectId: 'demo-project', roles: ['专业监理']}, admin.cookie)).status, 200);
  const before = await api('workspace', undefined, admin.cookie); assert.equal(before.body.workspace.cases.length, 1);
  const record = before.body.workspace.cases[0];
  const request = {type: 'save', recordId: record.id, expectedRevision: record.revision, values: {issue: 'Linux container acceptance'}, operationId: randomUUID()};
  assert.equal((await api('command', request, admin.cookie)).status, 200);
  docker(['exec', id, 'node', 'scripts/team-admin.mjs', 'backup', '/data/acceptance-backup.sqlite']);
  docker(['restart', id]); await healthy();
  const after = await api('workspace', undefined, admin.cookie);
  assert.equal(after.body.workspace.cases[0].values.issue, 'Linux container acceptance');
  assert.equal((await api('command', request, admin.cookie)).body.record.revision, record.revision + 1);
  docker(['exec', '-e', 'FLOWLENS_DATABASE=/data/restored.sqlite', id, 'node', 'scripts/team-admin.mjs', 'restore', '/data/acceptance-backup.sqlite']);
  const check = "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/restored.sqlite');if(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n!==0)process.exit(1);const w=JSON.parse(db.prepare('SELECT data FROM workspace').get().data);if(w.cases[0].values.issue!=='Linux container acceptance')process.exit(1);db.close();";
  docker(['exec', id, 'node', '-e', check]);
  console.log('PASS Linux container build, HTTP login, import, permission, write, restart, retry, backup and restore');
} finally {
  if (created) docker(['rm', '-f', id]);
  if (volumeCreated) docker(['volume', 'rm', volume]);
  if (built) docker(['image', 'rm', image]);
}
