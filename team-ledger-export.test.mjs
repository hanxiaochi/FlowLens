import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {DOMParser} from '@xmldom/xmldom';
import {unzipSync} from './team-vendor/fflate.mjs';
import {buildProjectLedger} from './team-ledger-export.mjs';
import {applicationDemo} from './apps-demo.mjs';
import {createTeamServer} from './team-server.mjs';

function inspect(bytes) {
  const files = unzipSync(bytes), documents = {};
  for (const [path, data] of Object.entries(files)) {
    const errors = [];
    documents[path] = new DOMParser({onError: (level, message) => errors.push(message)}).parseFromString(Buffer.from(data).toString(), 'application/xml');
    assert.deepEqual(errors, [], path);
  }
  return {files, documents, cells: path => [...documents[path].getElementsByTagName('c')].map(cell => ({address: cell.getAttribute('r'), type: cell.getAttribute('t'), text: cell.textContent}))};
}
test('Excel ledger retains identifiers, literal formulas, historical fields and linked detail rows', () => {
  const workspace = applicationDemo(), record = workspace.cases[0];
  const detail = record.template.fields.find(field => field.type === 'table');
  record.values['instruction-no'] = '000012345678901234567890';
  record.values.issue = '=HYPERLINK("https://example.invalid","测试")\r\n<&> 中文';
  record.values[detail.id] = JSON.stringify([{[detail.columns[0].id]: '000001', [detail.columns[1].id]: '换行\n明细'}]);
  const historical = structuredClone(record); historical.id = 'historical'; historical.template.version++;
  historical.template.fields.push({id: 'old-only', label: '历史字段', type: 'text', owner: 'draft'}); historical.values['old-only'] = '保留';
  workspace.cases.push(historical);
  workspace.projects.push({...workspace.projects[0], id: 'other-project'});
  workspace.cases.push({...structuredClone(record), id: 'private', projectId: 'other-project', values: {issue: 'OTHER_PROJECT_SECRET'}});
  const before = structuredClone(workspace);
  const {documents, cells, files} = inspect(buildProjectLedger(workspace, record.projectId));
  assert.deepEqual(workspace, before);
  const names = [...documents['xl/workbook.xml'].getElementsByTagName('sheet')].map(sheet => sheet.getAttribute('name'));
  assert.equal(names.length, 5); assert.equal(new Set(names).size, 5);
  const main = cells('xl/worksheets/sheet2.xml');
  assert.ok(main.some(cell => cell.text === record.values['instruction-no'] && cell.type === 'inlineStr'));
  assert.ok(main.some(cell => cell.text === record.values.issue));
  assert.ok(cells('xl/worksheets/sheet3.xml').some(cell => cell.text === '000001'));
  assert.ok(cells('xl/worksheets/sheet3.xml').some(cell => cell.text === record.id));
  assert.ok(cells('xl/worksheets/sheet4.xml').some(cell => cell.text === '保留'));
  for (const [path, doc] of Object.entries(documents)) {
    assert.equal(doc.getElementsByTagName('f').length, 0, path);
    assert.ok(!Buffer.from(files[path]).toString().includes('OTHER_PROJECT_SECRET'));
    assert.equal(doc.getElementsByTagName('hyperlink').length, 0);
  }
  assert.equal(documents['xl/worksheets/sheet2.xml'].getElementsByTagName('pane')[0].getAttribute('state'), 'frozen');
});

test('ledger handles empty projects, safe sheet names, escaped controls and rejects lossy exports', () => {
  const workspace = applicationDemo(), record = workspace.cases[0];
  const empty = structuredClone(workspace); empty.cases = [];
  assert.equal(inspect(buildProjectLedger(empty, record.projectId)).documents['xl/workbook.xml'].getElementsByTagName('sheet').length, 1);
  record.template.title = '很长的表式😀'.repeat(12) + '[]/*';
  record.values.issue = '_x0041_\x01';
  const result = inspect(buildProjectLedger(workspace, record.projectId));
  for (const sheet of result.documents['xl/workbook.xml'].getElementsByTagName('sheet')) assert.ok(sheet.getAttribute('name').length <= 31);
  assert.ok(result.cells('xl/worksheets/sheet2.xml').some(cell => cell.text === '_x005F_x0041__x0001_'));
  record.values.issue = 'x'.repeat(32768);
  assert.throws(() => buildProjectLedger(workspace, record.projectId), error => error.status === 413);
  record.values.issue = '\ud800';
  assert.throws(() => buildProjectLedger(workspace, record.projectId), /Unicode/);
  record.values.issue = ''; record.relatedId = 'outside';
  assert.throws(() => buildProjectLedger(workspace, record.projectId), /关联超出/);
});

test('ledger bounds historical structure expansion before emitting a partial workbook', () => {
  const workspace = applicationDemo(), record = workspace.cases[0];
  workspace.cases = Array.from({length: 201}, (_, index) => ({...record, id: 'record-' + index, template: {...record.template, version: index + 1, fields: []}, values: {}}));
  assert.throws(() => buildProjectLedger(workspace, record.projectId), error => error.status === 413);
});

test('same-version historical structures remain separate and maximum cell text stays exact', () => {
  const workspace = applicationDemo(), record = workspace.cases[0];
  record.values.issue = '中'.repeat(32767);
  const changed = structuredClone(record);
  changed.id = 'same-version-other-structure';
  changed.template.fields.push({id: 'historical-note', label: '旧表备注', type: 'text', owner: 'draft'});
  changed.values['historical-note'] = '独立列';
  workspace.cases.push(changed);
  const result = inspect(buildProjectLedger(workspace, record.projectId));
  assert.equal(result.documents['xl/workbook.xml'].getElementsByTagName('sheet').length, 5);
  assert.ok(result.cells('xl/worksheets/sheet2.xml').some(cell => cell.text === record.values.issue));
  assert.ok(!result.cells('xl/worksheets/sheet2.xml').some(cell => cell.text === '旧表备注 [historical-note]'));
  assert.ok(result.cells('xl/worksheets/sheet4.xml').some(cell => cell.text === '独立列'));
});

test('ledger rejects cell-count and XML expansion limits before producing a workbook', () => {
  const workspace = applicationDemo(), record = workspace.cases[0];
  record.template.fields = Array.from({length: 200}, (_, index) => ({id: 'f' + index, label: 'F', type: 'text'}));
  record.values = {};
  workspace.cases = Array.from({length: 2500}, (_, index) => ({...record, id: 'r' + index}));
  assert.throws(() => buildProjectLedger(workspace, record.projectId), error => error.status === 413 && /单元格/.test(error.message));
  record.template.fields = [{id: 'expanded', label: 'XML expansion', type: 'text'}];
  record.values = {expanded: '&'.repeat(32767)};
  workspace.cases = Array.from({length: 420}, (_, index) => ({...record, id: 'r' + index}));
  assert.throws(() => buildProjectLedger(workspace, record.projectId), error => error.status === 413 && /64 MiB/.test(error.message));
});

test('ledger HTTP export uses current project membership and releases export slot after denial', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-ledger-'));
  const {server, store} = createTeamServer({database: join(directory, 'team.sqlite')});
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password: 'ledger-test-password'});
    const member = await store.createUser(admin, {username: 'member', name: 'Member', password: 'ledger-test-password'});
    const sample = applicationDemo(); store.importApplication(admin, sample);
    const projectId = sample.projects[0].id;
    store.setMembership(admin, {userId: member.id, projectId, roles: ['专业监理']});
    const session = await store.login('member', 'ledger-test-password');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const get = (id = projectId) => new Promise((resolve, reject) => {
      const req = http.get({hostname: '127.0.0.1', port: server.address().port, path: '/api/team/project-ledger?projectId=' + id, headers: {Host: '127.0.0.1:4186', Cookie: 'flowlens_session=' + session.token}}, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks)}));
      }); req.on('error', reject);
    });
    const before = store.visibleWorkspace(admin);
    assert.equal((await get('unassigned')).status, 404);
    const exported = await get(); assert.equal(exported.status, 200);
    assert.equal(exported.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(exported.headers['content-disposition'].endsWith('.xlsx')); inspect(exported.bytes);
    assert.deepEqual(store.visibleWorkspace(admin), before);
    store.setMembership(admin, {userId: member.id, projectId, roles: []});
    assert.equal((await get()).status, 404);
    assert.ok(store.projectLedger(admin, projectId).length);
    store.setDisabled(admin, {userId: member.id, disabled: true});
    assert.equal((await get()).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true}); }
});

test('interrupted ledger transfer releases the shared archive export slot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-ledger-interrupt-'));
  const {server, store} = createTeamServer({database: join(directory, 'team.sqlite')});
  let stalled;
  try {
    const admin = await store.createUser(null, {username: 'admin', name: 'Admin', password: 'ledger-test-password'});
    store.importApplication(admin, applicationDemo());
    const session = await store.login('admin', 'ledger-test-password');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const request = (endpoint = 'project-ledger') => new Promise((resolve, reject) => {
      http.get({hostname: '127.0.0.1', port: server.address().port, path: '/api/team/' + endpoint + '?projectId=demo-project', headers: {Host: '127.0.0.1:4186', Cookie: 'flowlens_session=' + session.token}}, resolve).on('error', reject);
    });
    server.prependOnceListener('request', (_request, response) => {
      response.end = function () { this.flushHeaders(); return this; };
    });
    stalled = await request(); assert.equal(stalled.statusCode, 200); stalled.pause();
    for (const endpoint of ['project-ledger', 'project-export']) {
      const busy = await request(endpoint); assert.equal(busy.statusCode, 503); busy.resume();
    }
    const closed = new Promise(resolve => stalled.once('close', resolve));
    stalled.destroy(); await closed;
    let retry;
    for (let attempt = 0; attempt < 20; attempt++) {
      retry = await request();
      if (retry.statusCode !== 503) break;
      retry.resume(); await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(retry.statusCode, 200);
    const chunks = []; for await (const chunk of retry) chunks.push(chunk);
    inspect(Buffer.concat(chunks));
    const archive = await request('project-export'); assert.equal(archive.statusCode, 200);
    for await (const chunk of archive) { /* consume the complete transfer */ }
  } finally {
    stalled?.destroy(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
});
