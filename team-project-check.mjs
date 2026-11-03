import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {crc32, inflateRawSync} from 'node:zlib';
import {upgradeWorkspace} from './forms-store.mjs';
import {projectExportLimit} from './team-project-export.mjs';

export const projectArchiveLimit = 66 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValid = (condition, message) => { if (!condition) throw Error(message); };
const filePattern = /^(index\.html|manifest\.json|project\.json|forms\/[1-9][0-9]*\.html|attachments\/[1-9][0-9]*-[1-9][0-9]*\.[a-z0-9]{1,10})$/;

function archiveEntries(bytes) {
  requireValid(bytes.length >= 22, 'ZIP 文件不完整');
  requireValid(bytes.length <= projectArchiveLimit, '资料 ZIP 最大 66 MiB');
  let end = bytes.length - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && (bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end--;
  requireValid(end >= minimum, 'ZIP 末尾目录缺失或已截断');
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  requireValid(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 8) === count, '不支持分卷 ZIP');
  requireValid(count >= 3 && count <= 10000 && start + size === end, 'ZIP 目录范围或文件数量无效');
  const entries = [];
  const names = new Set();
  let cursor = start;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    requireValid(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'ZIP 中央目录无效');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const original = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    requireValid(next <= end && nameLength > 0, 'ZIP 文件名或附加数据越界');
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = rawName.toString('utf8');
    requireValid(Buffer.from(name).equals(rawName) && filePattern.test(name) && !names.has(name), 'ZIP 文件路径无效、重复或包含额外文件');
    requireValid((flags & ~0x800) === 0 && [0, 8].includes(method), '不支持加密、数据描述符或此压缩方式');
    requireValid(bytes.readUInt16LE(cursor + 34) === 0 && (bytes.readUInt32LE(cursor + 38) >>> 16 & 0xf000) !== 0xa000, '不支持分卷文件或符号链接');
    expanded += original;
    requireValid(expanded <= projectExportLimit && compressed <= projectArchiveLimit && offset < start, 'ZIP 展开大小或文件位置超限');
    entries.push({name, rawName, flags, method, checksum, compressed, original, offset});
    names.add(name);
    cursor = next;
  }
  requireValid(cursor === end, 'ZIP 目录包含未识别内容');
  let localEnd = 0;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    const offset = entry.offset;
    requireValid(offset === localEnd && offset + 30 <= start && bytes.readUInt32LE(offset) === 0x04034b50, 'ZIP 本地文件头重叠、缺失或包含额外内容');
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    requireValid(dataStart + entry.compressed <= start && bytes.subarray(offset + 30, offset + 30 + nameLength).equals(entry.rawName), 'ZIP 本地文件名或长度与目录不一致');
    requireValid(bytes.readUInt16LE(offset + 6) === entry.flags && bytes.readUInt16LE(offset + 8) === entry.method && bytes.readUInt32LE(offset + 14) === entry.checksum && bytes.readUInt32LE(offset + 18) === entry.compressed && bytes.readUInt32LE(offset + 22) === entry.original, 'ZIP 本地头与中央目录不一致');
    entry.dataStart = dataStart;
    localEnd = dataStart + entry.compressed;
  }
  requireValid(localEnd === start, 'ZIP 文件区包含未识别内容');
  return entries;
}

export function inspectProjectArchive(input, current) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const entries = archiveEntries(bytes);
  const files = new Map();
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed);
    let data;
    try { data = entry.method === 0 ? compressed : inflateRawSync(compressed, {maxOutputLength: Math.max(1, entry.original)}); }
    catch { throw Error('ZIP 解压失败或实际展开大小超过声明'); }
    requireValid(data.length === entry.original && crc32(data) === entry.checksum, 'ZIP 文件长度或 CRC 校验失败');
    files.set(entry.name, data);
  }
  function json(name, limit) {
    const data = files.get(name);
    requireValid(data && data.length <= limit, name + ' 缺失或超限');
    try { return JSON.parse(data.toString('utf8')); }
    catch { throw Error(name + ' JSON 无效'); }
  }
  const manifest = json('manifest.json', 2 * 1024 * 1024);
  requireValid(manifest.format === 'flowlens-file-manifest' && manifest.version === 1 && Array.isArray(manifest.files), '文件清单格式无效');
  requireValid(manifest.files.length === files.size - 1, '文件清单与 ZIP 文件数量不一致');
  const checked = new Set();
  for (const item of manifest.files) {
    requireValid(item && typeof item.path === 'string' && item.path !== 'manifest.json' && !checked.has(item.path), '文件清单含重复或无效条目');
    const data = files.get(item.path);
    requireValid(data && item.bytes === data.length && item.sha256 === hash(data), '文件缺失或 SHA256 不一致 · ' + item.path);
    checked.add(item.path);
  }
  const project = json('project.json', 32 * 1024 * 1024);
  requireValid(project.format === 'flowlens-project-handoff' && project.version === 1 && project.project && project.application && Array.isArray(project.records), '项目资料格式无效');
  const workspace = upgradeWorkspace({format: 'flowlens-forms', version: 3, projects: [project.project], applications: [project.application], templates: project.templates, cases: project.records}, {allowAttachmentReferences: true});
  requireValid(workspace.cases.every(record => record.projectId === project.project.id && record.appId === project.application.id), '资料包含其他项目的单据');
  const expectedFiles = new Set(['index.html', 'manifest.json', 'project.json']);
  let attachmentCount = 0;
  const historicalActors = new Map();
  for (const [index, record] of workspace.cases.entries()) {
    expectedFiles.add('forms/' + (index + 1) + '.html');
    for (const file of record.attachments) {
      requireValid(typeof file.exportPath === 'string' && file.exportPath.startsWith('attachments/') && !expectedFiles.has(file.exportPath), '附件路径缺失或重复');
      const data = files.get(file.exportPath);
      requireValid(data && data.length === file.size && hash(data) === file.blobId, '附件内容与项目记录不一致');
      expectedFiles.add(file.exportPath);
      attachmentCount++;
    }
    for (const event of record.events) if (event.actor) {
      requireValid(typeof event.actor.id === 'string' && typeof event.actor.name === 'string', '历史操作者信息无效');
      historicalActors.set(event.actor.id, {id: event.actor.id, name: event.actor.name});
    }
  }
  requireValid(expectedFiles.size === files.size && [...expectedFiles].every(name => files.has(name)), '资料包缺少文件或包含未关联文件');
  const conflicts = [];
  for (const key of ['projects', 'applications', 'templates', 'cases']) {
    for (const incoming of workspace[key]) {
      const existing = current[key].find(item => item.id === incoming.id);
      if (existing) conflicts.push({kind: key, id: incoming.id, name: incoming.title || incoming.name || incoming.id, incomingRevision: incoming.revision ?? null, currentRevision: existing.revision ?? null, sameDefinition: key === 'templates' || key === 'applications' ? isDeepStrictEqual(existing, incoming) : null});
    }
  }
  const report = {
    checkedAt: new Date().toISOString(), archiveSha256: hash(bytes), integrityPassed: true,
    project: {id: project.project.id, name: project.project.name}, records: workspace.cases.length,
    attachments: attachmentCount, files: files.size, expandedBytes: entries.reduce((sum, entry) => sum + entry.original, 0),
    targetRevision: current.storageRevision, conflicts, requiredRoles: [...new Set([...workspace.templates, ...workspace.cases.map(record => record.template)].flatMap(template => [template.submitterRole || '填报人', ...template.workflow.map(stage => stage.role)]))], historicalActors: [...historicalActors.values()],
    nextStep: conflicts.length ? '存在已有编号，请先核对差异与恢复目标。' : '编号未冲突，仍需确认表式、当前成员权限和历史账号对应。',
    notice: '文件检查通过。清单由资料包提供，业务真实性需交接双方确认。请先预览恢复方案，再确认目标项目和成员安排。'
  };
  return {report, workspace, files};
}

export function checkProjectArchive(input, current) {
  return inspectProjectArchive(input, current).report;
}
