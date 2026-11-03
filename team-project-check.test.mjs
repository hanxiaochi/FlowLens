import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {zipSync, unzipSync} from './team-vendor/fflate.mjs';
import {buildProjectArchive} from './team-project-export.mjs';
import {checkProjectArchive} from './team-project-check.mjs';
import {applicationDemo} from './apps-demo.mjs';
import {emptyWorkspace} from './forms-store.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
function fixture() {
  const workspace = applicationDemo();
  const data = Buffer.from([0, 255, 1, 129]);
  workspace.cases[0].attachments.push({id: 'fixture', name: 'evidence.bin', size: data.length, blobId: hash(data), mediaType: 'application/octet-stream'});
  workspace.cases[0].events[0].actor = {id: 'historical-user', name: '历史监理'};
  return {workspace, archive: buildProjectArchive(structuredClone(workspace), 'demo-project', () => data)};
}
function updateManifest(files) {
  files['manifest.json'] = Buffer.from(JSON.stringify({format: 'flowlens-file-manifest', version: 1, files: Object.entries(files).filter(([path]) => path !== 'manifest.json').map(([path, data]) => ({path, bytes: data.length, sha256: hash(data)}))}));
  return files;
}
function mutate(archive, action, {manifest = false, level = 0} = {}) {
  const files = unzipSync(archive); action(files);
  return zipSync(manifest ? updateManifest(files) : files, {level});
}

test('project checker validates stored and deflated handoffs and reports current conflicts without mutation', () => {
  const {workspace, archive} = fixture();
  const original = structuredClone(workspace);
  for (const bytes of [archive, mutate(archive, () => {}, {level: 6})]) {
    const report = checkProjectArchive(bytes, workspace);
    assert.equal(report.integrityPassed, true);
    assert.equal(report.records, 1); assert.equal(report.attachments, 1);
    assert.deepEqual(report.historicalActors, [{id: 'historical-user', name: '历史监理'}]);
    assert.ok(report.conflicts.some(item => item.kind === 'templates' && item.sameDefinition));
    assert.equal(report.archiveSha256, hash(bytes));
    assert.equal(checkProjectArchive(bytes, emptyWorkspace()).conflicts.length, 0);
  }
  assert.deepEqual(workspace, original);
});

test('project checker rejects missing, extra, corrupted and duplicated manifest entries', () => {
  const {archive} = fixture();
  const corruptions = [
    files => { delete files['forms/1.html']; },
    files => { files['forms/2.html'] = Buffer.from('extra'); },
    files => { files['attachments/1-1.bin'] = Buffer.from('changed'); },
    files => { const m = JSON.parse(Buffer.from(files['manifest.json'])); m.files[1] = m.files[0]; files['manifest.json'] = Buffer.from(JSON.stringify(m)); }
  ];
  for (const action of corruptions) assert.throws(() => checkProjectArchive(mutate(archive, action), emptyWorkspace()), /清单|SHA256/);
  assert.throws(() => checkProjectArchive(mutate(archive, files => { files['forms/2.html'] = Buffer.from('extra'); }, {manifest: true}), emptyWorkspace()), /未关联/);
  assert.throws(() => checkProjectArchive(mutate(archive, files => { files['attachments/1-1.bin'] = Buffer.from('changed'); }, {manifest: true}), emptyWorkspace()), /附件内容/);
});

test('project checker rejects traversal, duplicate ZIP names, local header mismatch and truncated archives', () => {
  const {archive} = fixture();
  for (const name of ['../index.html', 'C:/index.html', 'forms\\1.html', 'forms/1.HTML', 'forms/\u0000.html']) {
    assert.throws(() => checkProjectArchive(mutate(archive, files => { files[name] = Buffer.from('bad'); }), emptyWorkspace()), /路径/);
  }
  const duplicate = Buffer.from(mutate(archive, files => { files['forms/2.html'] = Buffer.from('extra'); }));
  let offset = 0;
  while ((offset = duplicate.indexOf('forms/2.html', offset)) !== -1) { duplicate.write('forms/1.html', offset); offset += 12; }
  assert.throws(() => checkProjectArchive(duplicate, emptyWorkspace()), /重复/);
  const mismatch = Buffer.from(archive); mismatch.writeUInt32LE(1, 18);
  assert.throws(() => checkProjectArchive(mismatch, emptyWorkspace()), /不一致/);
  assert.throws(() => checkProjectArchive(Buffer.from(archive).subarray(0, archive.length - 10), emptyWorkspace()), /截断/);
});

test('project checker bounds actual deflate output and rejects invalid project relationships', () => {
  const {archive} = fixture();
  const expanded = Buffer.from(mutate(archive, files => { files['index.html'] = Buffer.alloc(1024 * 1024, 65); }, {level: 6}));
  // Forge the matching central/local declarations while leaving the compressed stream large.
  let central = expanded.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (central !== -1) {
    const length = expanded.readUInt16LE(central + 28);
    const name = expanded.subarray(central + 46, central + 46 + length).toString();
    if (name === 'index.html') {
      expanded.writeUInt32LE(1, central + 24);
      expanded.writeUInt32LE(1, expanded.readUInt32LE(central + 42) + 22); break;
    }
    central = expanded.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), central + 4);
  }
  assert.throws(() => checkProjectArchive(expanded, emptyWorkspace()), /解压失败/);
  for (const change of [project => { project.records[0].relatedId = 'missing'; }, project => { project.records[0].projectId = 'outside'; }, project => { project.records[0].template.version = -1; }, project => { project.records[0].provenance = [{fieldId: 'project', value: 'x', source: 'record', sourceRevision: 1}]; }]) {
    assert.throws(() => checkProjectArchive(mutate(archive, files => { const project = JSON.parse(Buffer.from(files['project.json'])); change(project); files['project.json'] = Buffer.from(JSON.stringify(project)); }, {manifest: true}), emptyWorkspace()));
  }
});


test('project checker rejects encrypted, symlink, ZIP64 and CRC-damaged entries', () => {
  const {archive} = fixture();
  const central = Buffer.from(archive).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  for (const mutateBytes of [
    bytes => bytes.writeUInt16LE(1, central + 8),
    bytes => bytes.writeUInt32LE(0xa0000000, central + 38),
    bytes => bytes.writeUInt32LE(0xffffffff, central + 24),
    bytes => { const offset = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28); bytes[offset] ^= 1; }
  ]) {
    const bytes = Buffer.from(archive); mutateBytes(bytes);
    assert.throws(() => checkProjectArchive(bytes, emptyWorkspace()), /不支持|超限|CRC/);
  }
});
