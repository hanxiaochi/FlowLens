import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, rmdir, writeFile} from 'node:fs/promises';
import https from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applicationDemo} from '../apps-demo.mjs';

// Runs only on an isolated Docker host with ports 80 and 443 available.
const project = 'flowlens-compose-' + randomUUID();
const password = randomUUID();
const environment = {...process.env, FLOWLENS_DOMAIN: 'localhost', FLOWLENS_ADMIN_PASSWORD: password};
const directory = await mkdtemp(join(tmpdir(), 'flowlens-compose-'));
const override = join(directory, 'restore.yaml');
const docker = args => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 240000, env: environment, stdio: ['ignore', 'pipe', 'pipe']
});
const compose = args => docker(['compose', '-p', project, '-f', 'compose.team.yaml', ...args]);
let ca;
function request(path, data, cookie, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = data === undefined ? undefined : JSON.stringify(data);
    const req = https.request({
      hostname: 'localhost', port: 443, path, ca, method: payload ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json', 'X-FlowLens-Request': '1',
        Origin: 'https://localhost', ...(cookie ? {Cookie: cookie} : {}), ...extraHeaders
      }, timeout: 5000
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body}));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Error('HTTPS request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}
async function login() {
  const response = await request('/api/team/login', {username: 'admin', password});
  assert.equal(response.status, 200, response.body);
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /; Secure/i);
  assert.match(cookie, /; HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  return {cookie: cookie.split(';')[0], user: JSON.parse(response.body).user};
}
try {
  compose(['config', '--quiet']);
  compose(['build']);
  compose(['run', '--rm', '-e', 'FLOWLENS_ADMIN_PASSWORD', 'app', 'node', 'scripts/team-admin.mjs', 'init']);
  compose(['up', '-d', '--wait', '--wait-timeout', '120']);
  const app = compose(['ps', '-q', 'app']).trim();
  assert.equal(docker(['inspect', '--format', '{{.Config.User}}', app]).trim(), 'node');
  assert.equal(docker(['inspect', '--format', '{{.State.Health.Status}}', app]).trim(), 'healthy');
  // localhost uses Caddy's local CA. Trust only that CA for HTTPS verification.
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      ca = compose(['exec', '-T', 'gateway', 'cat', '/data/caddy/pki/authorities/local/root.crt']);
      if ((await request('/health')).status === 200) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/')).status, 200);
  const admin = await login();
  assert.equal((await request('/api/team/import', applicationDemo(), admin.cookie)).status, 200);
  assert.equal((await request('/api/team/membership', {userId: admin.user.id, projectId: 'demo-project', roles: ['专业监理']}, admin.cookie)).status, 200);
  const before = JSON.parse((await request('/api/team/workspace', undefined, admin.cookie)).body);
  const record = before.workspace.cases[0];
  const command = {type: 'save', recordId: record.id, expectedRevision: record.revision, values: {issue: 'Compose TLS acceptance'}, operationId: randomUUID()};
  assert.equal((await request('/api/team/command', command, admin.cookie, {Origin: 'https://untrusted.example'})).status, 403);
  assert.equal((await request('/api/team/command', command, admin.cookie)).status, 200);
  compose(['exec', '-T', 'app', 'node', 'scripts/team-admin.mjs', 'backup', '/data/compose-backup.sqlite']);
  compose(['exec', '-T', '-e', 'FLOWLENS_DATABASE=/data/restored.sqlite', 'app', 'node', 'scripts/team-admin.mjs', 'restore', '/data/compose-backup.sqlite']);
  await writeFile(override, 'services:\n  app:\n    environment:\n      FLOWLENS_DATABASE: /data/restored.sqlite\n');
  compose(['-f', override, 'up', '-d', '--wait', '--wait-timeout', '120', '--force-recreate', 'app']);
  assert.equal((await request('/api/team/workspace', undefined, admin.cookie)).status, 401);
  const restored = await login();
  const after = JSON.parse((await request('/api/team/workspace', undefined, restored.cookie)).body);
  assert.equal(after.workspace.cases[0].values.issue, 'Compose TLS acceptance');
  assert.equal((await request('/api/team/command', command, restored.cookie)).status, 200);
  console.log('PASS Compose config, nonroot app, Docker healthcheck, Caddy trusted HTTPS, secure cookies, same-origin protection, business write, backup restore and HTTPS re-login');
} finally {
  try { compose(['down', '--volumes', '--remove-orphans', '--rmi', 'local']); }
  catch { console.error('Cleanup failed for isolated Compose project ' + project); process.exitCode = 1; }
  await rm(override, {force: true});
  await rmdir(directory);
}
