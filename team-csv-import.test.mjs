import test from 'node:test';
import http from 'node:http';
import {createTeamServer} from './team-server.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareCsvImport, parseCsv} from './team-csv-import.mjs';
import {openTeamStore} from './team-store.mjs';
import {applicationDemo} from './apps-demo.mjs';

const optionsFor = plan => ({operationId: crypto.randomUUID(), planFingerprint: plan.planFingerprint, expectedUserId: plan.userId, expectedInstanceId: plan.instanceId});
test('CSV history preserves legacy receipts, pages records, and enforces current project access', async () => {
  const {directory, filename, store, admin, member, source} = await setup();
  try {
    const input = {...source, csv: '编号,要求\n' + Array.from({length: 52}, (_, i) => '00' + i + ',检查').join('\n')};
    const receipt = store.importCsv(member, input, optionsFor(store.previewCsvImport(member, input)));
    const listing = store.csvHistory(member, {projectId: source.projectId});
    assert.equal(listing.total, 1); assert.equal(listing.batches[0].actor.name, member.name);
    assert.ok(listing.batches[0].createdAt);
    const detail = store.csvHistory(member, {projectId: source.projectId, operationId: receipt.operationId, page: 2});
    assert.equal(detail.records.length, 2); assert.equal(detail.pages, 2);
    assert.deepEqual(detail.receipt, receipt); assert.equal(detail.records[0].stage, '待填写');
    assert.equal(detail.records[0].values, undefined);
    const connection = new DatabaseSync(filename);
    try {
      const legacy = {...receipt}; delete legacy.createdAt; delete legacy.actor;
      connection.prepare('UPDATE requests SET result=? WHERE id=?').run(JSON.stringify(legacy), receipt.operationId);
      const old = store.csvHistory(admin, {projectId: source.projectId}).batches[0];
      assert.equal(old.createdAt, null); assert.equal(old.actorNameHistorical, false);
      assert.equal(old.actor.name, member.name);
      for (let i = 0; i < 51; i++) {
        const id = 'history-fixture-' + i;
        connection.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(id, member.id, 'fixture', JSON.stringify({...legacy, operationId: id}));
      }
      assert.equal(store.csvHistory(admin, {projectId: source.projectId}).batches.length, 50);
      assert.equal(store.csvHistory(admin, {projectId: source.projectId, page: 2}).batches.length, 2);
    } finally { connection.close(); }
    assert.throws(() => store.csvHistory(member, {projectId: 'other', operationId: receipt.operationId}), error => error.status === 404);
    assert.throws(() => store.csvHistory(member, {projectId: source.projectId, page: -1}), error => error.status === 400);
    store.setMembership(admin, {userId: member.id, projectId: source.projectId, roles: []});
    assert.throws(() => store.csvHistory(member, {projectId: source.projectId}), error => error.status === 404);
    assert.throws(() => store.csvHistory(member, {projectId: source.projectId, operationId: receipt.operationId}), error => error.status === 404);
    store.setDisabled(admin, {userId: member.id, disabled: true});
    assert.equal(store.csvHistory(admin, {projectId: source.projectId}).total, 52);
    assert.throws(() => store.csvHistory(member, {projectId: source.projectId}), error => error.status === 401);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});
async function setup(recordCount = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-csv-'));
  const filename = join(directory, 'team.sqlite');
  const store = openTeamStore(filename);
  const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password: 'csv-test-password'});
  const member = await store.createUser(admin, {username: 'member', name: 'Member', password: 'csv-test-password'});
  const sample = applicationDemo();
  if (recordCount > 1) sample.cases = Array.from({length: recordCount}, (_, index) => ({...structuredClone(sample.cases[0]), id: 'existing-' + index}));
  store.importApplication(admin, sample);
  store.setMembership(admin, {userId: member.id, projectId: sample.projects[0].id, roles: ['专业监理']});
  const source = {projectId: sample.projects[0].id, templateId: sample.templates[0].id, csv: '编号,要求\n00001234567890123456789,"检查,第一项"\n00002,"两行\n要求"', mapping: ['instruction-no', 'issue']};
  return {directory, filename, store, admin, member, sample, source};
}

test('CSV preserves identifiers, quoting and physical row numbers and rejects ambiguous input', () => {
  assert.deepEqual(parseCsv('\uFEFF编号,要求\r\n00001,"a,""b""\r\nc"\r\n00002,end\r\n'), {
    headers: ['编号', '要求'], rows: [{line: 2, values: ['00001', 'a,"b"\r\nc']}, {line: 4, values: ['00002', 'end']}]
  });
  assert.deepEqual(parseCsv('a,b\n1,').rows[0].values, ['1', '']);
  assert.equal(parseCsv('a\n""').rows.length, 1);
  for (const input of ['a,a\n1,2', 'a,\n1,2', 'a\n"bad', 'a\nx"y', 'a\n"x"y', 'a\n', 'a\n' + 'x\n'.repeat(501)]) assert.throws(() => parseCsv(input));
  assert.throws(() => parseCsv('a\n' + 'x'.repeat(2 * 1024 * 1024)), /2 MiB/);
});

test('CSV discovery and preview are read-only and report errors, missing values and project overrides', async () => {
  const {directory, store, admin, member, source} = await setup();
  try {
    const before = store.visibleWorkspace(admin), audit = store.audit(admin);
    const discovery = store.previewCsvImport(member, {...source, mapping: undefined});
    assert.equal(discovery.ready, false); assert.equal(discovery.rowCount, 2);
    assert.ok(discovery.fields.every(field => field.owner === 'draft'));
    const plan = store.previewCsvImport(member, source);
    assert.equal(plan.ready, true); assert.equal(plan.records, undefined);
    assert.equal(plan.rows[0].values['instruction-no'], '00001234567890123456789');
    assert.ok(plan.rows[0].missingRequired.includes('整改期限'));
    const invalid = store.previewCsvImport(member, {...source, csv: '日期,项目\n2026-02-30,其他项目\n2026-01-01', mapping: ['deadline', 'project']});
    assert.equal(invalid.ready, false); assert.ok(invalid.rows[0].errors.length); assert.ok(invalid.rows[1].errors.length);
    assert.equal(invalid.rows[0].warnings[0].reason, '覆盖项目带入值');
    assert.throws(() => store.importCsv(member, {...source, csv: '日期,项目\n2026-02-30,其他项目\n2026-01-01', mapping: ['deadline', 'project']}, optionsFor(invalid)), /仍有错误/);
    assert.throws(() => store.previewCsvImport(member, {...source, mapping: ['issue', 'issue']}), /同一字段/);
    assert.throws(() => store.previewCsvImport(member, {...source, mapping: ['sign-opinion', 'issue']}), /填写字段/);
    assert.deepEqual(store.visibleWorkspace(admin), before); assert.deepEqual(store.audit(admin), audit);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('CSV imports one atomic batch, records actors, preserves old records and replays the original receipt', async () => {
  const {directory, store, admin, member, sample, source} = await setup();
  try {
    const before = store.visibleWorkspace(admin).workspace.cases;
    const plan = store.previewCsvImport(member, source), options = optionsFor(plan);
    const result = store.importCsv(member, source, options);
    assert.equal(result.imported, 2);
    assert.deepEqual(store.importCsv(member, source, options), result);
    const current = store.visibleWorkspace(admin).workspace.cases;
    assert.deepEqual(current.slice(0, before.length), before);
    assert.equal(current.length, before.length + 2);
    for (const record of current.slice(before.length)) {
      assert.equal(record.status, 'draft'); assert.equal(record.createdBy.id, member.id);
      assert.ok(record.events.every(event => event.actor.id === member.id));
    }
    assert.equal(current[before.length].values['instruction-no'], '00001234567890123456789');
    assert.equal(store.audit(admin).filter(event => event.action === 'cases.csv-import').length, 1);
    const updated = structuredClone(sample); updated.templates[0].version++; updated.templates[0].title += ' New';
    store.updateDefinitions(admin, updated);
    assert.deepEqual(store.importCsv(member, source, options), result);
    assert.throws(() => store.importCsv(member, {...source, csv: source.csv + '\n00003,new'}, options), /不同请求/);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('CSV rejects stale definitions, lost permissions, other accounts and other instances', async () => {
  const {directory, store, admin, member, sample, source} = await setup();
  try {
    assert.throws(() => store.previewCsvImport(admin, source), error => error.status === 403);
    const plan = store.previewCsvImport(member, source), options = optionsFor(plan);
    assert.throws(() => store.importCsv(member, source, {...options, expectedUserId: admin.id}), error => error.status === 409);
    assert.throws(() => store.importCsv(member, source, {...options, expectedInstanceId: 'other'}), error => error.status === 409);
    store.setMembership(admin, {userId: member.id, projectId: source.projectId, roles: []});
    assert.throws(() => store.importCsv(member, source, options), error => error.status === 403);
    store.setMembership(admin, {userId: member.id, projectId: source.projectId, roles: ['专业监理']});
    const updated = structuredClone(sample); updated.templates[0].version++; updated.templates[0].title += ' New';
    store.updateDefinitions(admin, updated);
    assert.throws(() => store.importCsv(member, source, options), error => error.status === 409);
    store.setMembership(admin, {userId: member.id, projectId: source.projectId, roles: ['专业监理', '施工单位']});
    assert.throws(() => store.previewCsvImport(member, {...source, templateId: sample.templates[1].id}), /上游/);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('CSV storage failure rolls back records, revision, audit and receipt before the same request succeeds', async () => {
  const {directory, filename, store, admin, member, source} = await setup();
  const inspection = new DatabaseSync(filename);
  try {
    const plan = store.previewCsvImport(member, source), options = optionsFor(plan);
    const before = store.visibleWorkspace(admin), audit = store.audit(admin);
    inspection.exec("CREATE TRIGGER fail_csv_receipt BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;");
    assert.throws(() => store.importCsv(member, source, options), /injected receipt failure/);
    assert.deepEqual(store.visibleWorkspace(admin), before); assert.deepEqual(store.audit(admin), audit);
    assert.equal(inspection.prepare('SELECT count(*) AS count FROM requests WHERE id=?').get(options.operationId).count, 0);
    inspection.exec('DROP TRIGGER fail_csv_receipt');
    assert.equal(store.importCsv(member, source, options).imported, 2);
  } finally { inspection.close(); store.close(); await rm(directory, {recursive: true, force: true}); }
});


test('CSV handles supported field identifiers that match object prototype names', () => {
  const workspace = applicationDemo();
  const template = workspace.templates[0];
  const field = template.fields.find(item => item.id === 'instruction-no');
  field.id = '__proto__';
  const result = prepareCsvImport(workspace, {projectId: workspace.projects[0].id, templateId: template.id, csv: '编号\n000001', mapping: ['__proto__']});
  assert.equal(result.records[0].values.__proto__, '000001');
  assert.equal(Object.getPrototypeOf(result.records[0].values), Object.prototype);
  assert.equal(result.records[0].events.at(-1).diff[0].before, '');
  const missing = prepareCsvImport(workspace, {projectId: workspace.projects[0].id, templateId: template.id, csv: '问题\n待核对', mapping: ['issue']});
  assert.ok(missing.rows[0].missingRequired.includes(field.label));
});


test('CSV duplicate review compares mapped values and preserves all rows for explicit confirmation', () => {
  const workspace = applicationDemo();
  const result = prepareCsvImport(workspace, {projectId: workspace.projects[0].id, templateId: workspace.templates[0].id,
    csv: '编号,备注\n0001,first\n0001,second\n0001,third\n1,fourth', mapping: ['instruction-no', '']});
  assert.deepEqual(result.rows.map(row => row.duplicateOf), [null, 2, 2, null]);
  assert.equal(result.records.length, 4); assert.equal(result.ready, true);
});

test('CSV rechecks batch capacity after another import while completed receipt remains replayable', async () => {
  const {directory, filename, store, admin, member, source} = await setup(2998);
  const peer = openTeamStore(filename);
  try {
    const first = optionsFor(store.previewCsvImport(member, source));
    const second = optionsFor(peer.previewCsvImport(member, source));
    const result = store.importCsv(member, source, first);
    assert.equal(result.imported, 2);
    assert.throws(() => peer.importCsv(member, source, second), error => error.status === 413);
    assert.deepEqual(peer.importCsv(member, source, first), result);
    assert.equal(store.visibleWorkspace(admin).workspace.cases.length, 3000);
    assert.equal(store.audit(admin).filter(event => event.action === 'cases.csv-import').length, 1);
  } finally { peer.close(); store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('CSV rejects oversized snapshot batches before writing any records', async () => {
  const {directory, store, admin, member, sample, source} = await setup();
  try {
    const updated = structuredClone(sample); updated.templates[0].version++;
    for (let index = 0; index < 40; index++) updated.templates[0].blocks.push({id: 'large-' + index, type: 'paragraph', text: 'x'.repeat(20000)});
    store.updateDefinitions(admin, updated);
    const before = store.visibleWorkspace(admin), audit = store.audit(admin);
    const oversized = {...source, csv: '编号\n' + '0001\n'.repeat(50), mapping: ['instruction-no']};
    assert.throws(() => store.previewCsvImport(member, oversized), error => error.status === 413);
    assert.deepEqual(store.visibleWorkspace(admin), before); assert.deepEqual(store.audit(admin), audit);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('CSV completed and pending requests are refused after CLI restore changes the instance', async () => {
  const {directory, store, admin, member, source} = await setup();
  let restored;
  try {
    const completed = optionsFor(store.previewCsvImport(member, source));
    store.importCsv(member, source, completed);
    const pending = optionsFor(store.previewCsvImport(member, source));
    const backup = join(directory, 'backup.sqlite'), target = join(directory, 'restored.sqlite');
    await store.backup(backup);
    const restore = spawnSync(process.execPath, [fileURLToPath(new URL('./scripts/team-admin.mjs', import.meta.url)), 'restore', backup], {env: {...process.env, FLOWLENS_DATABASE: target}, encoding: 'utf8', windowsHide: true});
    assert.equal(restore.status, 0, restore.stderr);
    restored = openTeamStore(target);
    const before = restored.visibleWorkspace(admin), audit = restored.audit(admin);
    assert.throws(() => restored.importCsv(member, source, completed), error => error.status === 409);
    assert.throws(() => restored.importCsv(member, source, pending), error => error.status === 409);
    assert.deepEqual(restored.visibleWorkspace(admin), before); assert.deepEqual(restored.audit(admin), audit);
  } finally { restored?.close(); store.close(); await rm(directory, {recursive: true, force: true}); }
});


test('concurrent CSV HTTP retries share a receipt and revoked roles prevent later imports', async () => {
  const {directory, filename, store, admin, member, source} = await setup();
  const {server} = createTeamServer({database: filename});
  try {
    const session = await store.login('member', 'csv-test-password');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const request = (path, input) => new Promise((resolve, reject) => {
      const req = http.request({hostname: '127.0.0.1', port: server.address().port, path: '/api/team/' + path, method: 'POST', headers: {Host: '127.0.0.1:4186', 'Content-Type': 'application/json', 'X-FlowLens-Request': '1', Cookie: 'flowlens_session=' + session.token}}, response => {
        let text = ''; response.setEncoding('utf8'); response.on('data', chunk => text += chunk);
        response.on('end', () => resolve({status: response.statusCode, body: JSON.parse(text)}));
      });
      req.on('error', reject); req.end(JSON.stringify(input));
    });
    const preview = await request('csv-preview', source); assert.equal(preview.status, 200);
    const payload = {source, options: optionsFor(preview.body)};
    const results = await Promise.all([request('csv-import', payload), request('csv-import', payload)]);
    assert.equal(results[0].status, 200); assert.deepEqual(results[1], results[0]);
    assert.equal(store.visibleWorkspace(admin).workspace.cases.length, 3);
    assert.equal(store.audit(admin).filter(event => event.action === 'cases.csv-import').length, 1);
    const pending = {source, options: optionsFor((await request('csv-preview', source)).body)};
    store.setMembership(admin, {userId: member.id, projectId: source.projectId, roles: []});
    assert.equal((await request('csv-import', pending)).status, 403);
    assert.equal((await request('csv-preview', source)).status, 403);
    assert.equal(store.visibleWorkspace(admin).workspace.cases.length, 3);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); await rm(directory, {recursive: true, force: true}); }
});
