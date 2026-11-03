import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Run only in the dedicated capacity container network. No configurable public URL.
const [mode, directoryArgument, runtimeArgument] = process.argv.slice(2);
assert.ok(['init', 'run', 'verify', 'verify-restart'].includes(mode) && directoryArgument && runtimeArgument,
  'Usage: node measure-team-capacity.mjs init|run|verify|verify-restart <private QA directory> <runtime directory>');
const directory = resolve(directoryArgument);
const runtime = resolve(runtimeArgument);
const dataDirectory = join(directory, 'data');
const origin = 'http://127.0.0.1:4186';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const {openTeamStore} = await import(pathToFileURL(join(runtime, 'team-store.mjs')));
const {unzipSync} = await import(pathToFileURL(join(runtime, 'team-vendor/fflate.mjs')));

if (mode === 'init') {
  await mkdir(dataDirectory, {mode: 0o700}); // Refuse to reuse any prior database directory.
  const password = randomUUID();
  const store = openTeamStore(join(dataDirectory, 'team.sqlite'));
  try { await store.createUser(null, {username: 'capacity-admin', name: '虚构容量管理员', password}); }
  finally { store.close(); }
  await writeFile(join(directory, 'credentials.json'), JSON.stringify({password}), {mode: 0o600});
  console.log('Initialized an isolated synthetic capacity database');
  process.exit(0);
}

const credentials = JSON.parse(await readFile(join(directory, 'credentials.json'), 'utf8'));
let activePhase;
async function request(path, {data, cookie, binary = false, measure = true} = {}) {
  const start = performance.now();
  const response = await fetch(origin + '/api/team/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {'Content-Type': 'application/json', 'X-FlowLens-Request': '1', 'X-FlowLens-Client': '2', ...(cookie ? {Cookie: cookie} : {})},
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(30000)
  });
  const body = binary ? new Uint8Array(await response.arrayBuffer()) : await response.json();
  if (measure) activePhase?.push({path: path.split('?')[0], status: response.status, milliseconds: performance.now() - start});
  return {status: response.status, body, cookie: response.headers.get('set-cookie')?.split(';')[0]};
}
async function ok(path, options) {
  const result = await request(path, options);
  assert.equal(result.status, 200, path + ' status ' + result.status);
  return result.body;
}
async function login(username, password) {
  const result = await request('login', {data: {username, password}});
  assert.equal(result.status, 200); return result.cookie;
}
const admin = await login('capacity-admin', credentials.password);

if (mode === 'verify' || mode === 'verify-restart') {
  const expected = JSON.parse(await readFile(join(directory, 'expected-private.json'), 'utf8'));
  const oldSessionStatus = (await request('me', {cookie: expected.oldCookie})).status;
  assert.equal(oldSessionStatus, mode === 'verify' ? 401 : 200);
  const actual = await ok('workspace', {cookie: admin});
  assert.equal(hash(JSON.stringify(actual)), expected.workspaceSha256);
  for (const record of actual.workspace.cases) for (const file of record.attachments) {
    const bytes = await ok('attachment?recordId=' + encodeURIComponent(record.id) + '&attachmentId=' + encodeURIComponent(file.id), {cookie: admin, binary: true});
    assert.equal(hash(bytes), file.blobId);
  }
  const result = {passed: true, records: actual.workspace.cases.length, oldSessionStatus, workspaceMatched: true, allAttachmentHashesMatched: true};
  await writeFile(join(directory, mode === 'verify' ? 'restore-verification.json' : 'restart-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  process.exit(0);
}

const phases = [];
const samples = [];
const recordCount = Number(process.env.FLOWLENS_CAPACITY_RECORDS ?? 50);
assert.ok(Number.isInteger(recordCount) && recordCount >= 9 && recordCount <= 500);
const report = {version: process.env.FLOWLENS_CAPACITY_VERSION ?? 'unspecified', scriptSha256: hash(await readFile(new URL(import.meta.url))), runtime: process.version, syntheticData: true, target: 'isolated loopback HTTP', serverLimits: {cpus: 1, memoryMiB: 512}, phases, samples};
const commits = new Map();
function summary(measurements) {
  const times = measurements.map(item => item.milliseconds).sort((a, b) => a - b);
  const percentile = fraction => Math.round(times[Math.max(0, Math.ceil(times.length * fraction) - 1)] * 10) / 10;
  const statuses = {};
  for (const item of measurements) statuses[item.status] = (statuses[item.status] ?? 0) + 1;
  return {requests: times.length, statuses, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1)};
}
async function phase(name, work) {
  const measurements = []; activePhase = measurements;
  const start = performance.now();
  try {
    await work();
    const byRoute = {};
    for (const route of new Set(measurements.map(item => item.path))) byRoute[route] = summary(measurements.filter(item => item.path === route));
    const result = {name, elapsedMs: Math.round(performance.now() - start), ...summary(measurements), byRoute};
    phases.push(result); console.log(JSON.stringify({phase: name, ...summary(measurements)}));
  } finally { activePhase = undefined; }
}
let sampling = true;
let sampler;
try {
  const fixture = JSON.parse(await readFile(join(directory, 'fixture.json'), 'utf8'));
  assert.equal(fixture.projects.length, 1);
  assert.equal(fixture.cases.length, 1);
  assert.equal(fixture.cases[0].status, 'draft');
  const projectId = fixture.projects[0].id;
  const templateId = fixture.cases[0].template.id;
  const role = fixture.cases[0].submitter;
  await ok('import', {cookie: admin, data: fixture});
  const identity = await ok('me', {cookie: admin});
  await ok('membership', {cookie: admin, data: {userId: identity.user.id, projectId, roles: [role]}});
  const workers = [];
  for (let index = 0; index < 8; index++) {
    const username = 'capacity-worker-' + index, password = randomUUID();
    const created = await request('users', {cookie: admin, data: {username, password, name: '虚构成员 ' + index}});
    assert.equal(created.status, 201);
    await ok('membership', {cookie: admin, data: {userId: created.body.id, projectId, roles: [role]}});
    const cookie = await login(username, password);
    const result = await ok('command', {cookie, data: {type: 'create', projectId, templateId, operationId: randomUUID()}});
    workers.push({cookie, recordId: result.record.id});
  }
  for (let index = 9; index < recordCount; index++) await ok('command', {cookie: admin, data: {type: 'create', projectId, templateId, operationId: randomUUID()}});
  for (let index = 0; index < 3; index++) {
    const worker = workers[index];
    const workspace = await ok('workspace', {cookie: worker.cookie});
    const record = workspace.workspace.cases.find(item => item.id === worker.recordId);
    await ok('command', {cookie: worker.cookie, data: {type: 'attachment', recordId: record.id, expectedRevision: record.revision, operationId: randomUUID(), attachment: {name: 'synthetic-' + index + '.bin', data: 'data:application/octet-stream;base64,' + Buffer.alloc(8 * 1024 * 1024, index + 1).toString('base64')}}});
  }
  const initial = await ok('workspace', {cookie: admin});
  assert.equal(initial.workspace.cases.length, recordCount);
  report.initialRecords = recordCount;
  report.initialAttachmentBytes = 24 * 1024 * 1024;
  const initialState = new Map(initial.workspace.cases.map(record => [record.id, {revision: record.revision, events: record.events.length}]));
  sampler = (async () => {
    while (sampling) {
      const status = await ok('operations', {cookie: admin, measure: false});
      samples.push({at: new Date().toISOString(), memoryBytes: status.memoryBytes, workspaceBytes: status.workspaceBytes});
      await delay(5000);
    }
  })().catch(error => { report.samplingError = error.message; });
  async function writeCycle(worker, label) {
    const before = await ok('workspace', {cookie: worker.cookie});
    const record = before.workspace.cases.find(item => item.id === worker.recordId);
    const input = {type: 'save', recordId: record.id, expectedRevision: record.revision, operationId: randomUUID(), values: {issue: label}};
    const saved = await ok('command', {cookie: worker.cookie, data: input});
    assert.equal(saved.record.revision, record.revision + 1);
    commits.set(record.id, (commits.get(record.id) ?? 0) + 1);
    assert.deepEqual(await ok('command', {cookie: worker.cookie, data: input}), saved);
    const after = await ok('workspace', {cookie: worker.cookie});
    assert.equal(after.workspace.cases.find(item => item.id === record.id).revision, saved.record.revision);
  }
  for (const count of [1, 4, 8]) await phase('independent-records-' + count, async () => {
    await Promise.all(workers.slice(0, count).map(async (worker, workerIndex) => {
      for (let index = 0; index < 20; index++) await writeCycle(worker, '虚构批次 ' + count + '-' + workerIndex + '-' + index);
    }));
  });
  await phase('same-revision-conflict-and-retry', async () => {
    const state = await ok('workspace', {cookie: admin});
    const record = state.workspace.cases.find(item => item.id === workers[0].recordId);
    const inputs = workers.map((worker, index) => ({type: 'save', recordId: record.id, expectedRevision: record.revision, operationId: randomUUID(), values: {issue: '并发冲突 ' + index}}));
    const results = await Promise.all(workers.map((worker, index) => request('command', {cookie: worker.cookie, data: inputs[index]})));
    assert.equal(results.filter(item => item.status === 200).length, 1);
    assert.equal(results.filter(item => item.status === 409).length, 7);
    const winner = results.findIndex(item => item.status === 200);
    commits.set(record.id, (commits.get(record.id) ?? 0) + 1);
    const replays = await Promise.all(Array.from({length: 8}, () => ok('command', {cookie: workers[winner].cookie, data: inputs[winner]})));
    for (const replay of replays) assert.deepEqual(replay, results[winner].body);
  });
  await phase('export-with-concurrent-reads', async () => {
    const [archive] = await Promise.all([
      ok('project-export?projectId=' + encodeURIComponent(projectId), {cookie: admin, binary: true}),
      ...workers.map(worker => ok('workspace', {cookie: worker.cookie}))
    ]);
    const files = unzipSync(archive);
    const manifest = JSON.parse(Buffer.from(files['manifest.json']));
    for (const file of manifest.files) { assert.equal(files[file.path].length, file.bytes); assert.equal(hash(files[file.path]), file.sha256); }
    report.exportBytes = archive.length;
  });
  const seconds = Number(process.env.FLOWLENS_CAPACITY_STEADY_SECONDS ?? 120);
  assert.ok(Number.isInteger(seconds) && seconds >= 0 && seconds <= 300);
  if (seconds) await phase('steady-four-clients-' + seconds + 's', async () => {
    const deadline = performance.now() + seconds * 1000;
    let completed = 0;
    await Promise.all(workers.slice(0, 4).map(async (worker, index) => {
      let iteration = 0;
      while (performance.now() < deadline && iteration < 1000) {
        await writeCycle(worker, '连续操作 ' + index + '-' + iteration++); completed++;
        if (completed % 100 === 0) console.log(JSON.stringify({steadyCompleted: completed}));
        await delay(250);
      }
    }));
    report.steadyWrites = completed;
  });
  sampling = false; await sampler;
  const final = await ok('workspace', {cookie: admin});
  for (const record of final.workspace.cases) {
    assert.equal(record.revision, initialState.get(record.id).revision + (commits.get(record.id) ?? 0));
    assert.equal(record.events.length, initialState.get(record.id).events + (commits.get(record.id) ?? 0));
  }
  report.committedWrites = [...commits.values()].reduce((sum, count) => sum + count, 0);
  report.finalWorkspaceBytes = (await ok('operations', {cookie: admin})).workspaceBytes;
  report.finalStateVerified = true;
  report.passed = true;
  await writeFile(join(directory, 'expected-private.json'), JSON.stringify({oldCookie: admin, workspaceSha256: hash(JSON.stringify(final))}), {mode: 0o600});
} catch (error) {
  report.passed = false; report.error = error.message; process.exitCode = 1;
} finally {
  sampling = false;
  if (sampler) await sampler.catch(error => { report.samplingError = error.message; process.exitCode = 1; });
  if (report.samplingError) { report.passed = false; process.exitCode = 1; }
  report.driverPeakRssKiB = process.resourceUsage().maxRSS;
  await writeFile(join(directory, 'capacity-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({passed: report.passed, committedWrites: report.committedWrites, error: report.error}));
}
