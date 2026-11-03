import {createHash} from 'node:crypto';
import {zipSync} from './team-vendor/fflate.mjs';
import {printableForm} from './forms-print.mjs';

export const projectExportLimit = 64 * 1024 * 1024;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

// Called inside a database read transaction. Attachment reads share its snapshot.
export function buildProjectArchive(workspace, projectId, readAttachment) {
  const project = workspace.projects.find(item => item.id === projectId);
  if (!project) throw Error('项目不存在');
  const application = workspace.applications.find(item => item.id === project.appId);
  const records = workspace.cases.filter(item => item.projectId === project.id);
  const selected = {
    format: 'flowlens-project-handoff', version: 1,
    createdAt: new Date().toISOString(), storageRevision: workspace.storageRevision,
    project, application,
    templates: workspace.templates.filter(item => application.templateIds.includes(item.id)),
    records
  };
  const files = Object.create(null);
  const manifest = [];
  let totalBytes = 0;
  function addFile(path, data) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (manifest.length >= 10000) throw Object.assign(Error('单次资料包最多 10000 个文件'), {status: 413});
    totalBytes += bytes.length;
    if (totalBytes > projectExportLimit) throw Object.assign(Error('项目资料超过单次导出 64 MiB 上限，请联系维护人员使用数据库备份交接。'), {status: 413});
    files[path] = bytes;
    manifest.push({path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  const recordIds = new Set(records.map(record => record.id));
  const links = [];
  for (const [index, record] of records.entries()) {
    if (record.relatedId && !recordIds.has(record.relatedId)) throw Error('项目单据关联超出导出范围');
    const path = 'forms/' + (index + 1) + '.html';
    addFile(path, printableForm(record, {shared: true}));
    const attachments = [];
    for (const [fileIndex, attachment] of record.attachments.entries()) {
      // Generated numeric names prevent traversal and collisions from original names.
      const extension = /\.([a-zA-Z0-9]{1,10})$/.exec(attachment.name)?.[1].toLowerCase() || 'bin';
      const filePath = 'attachments/' + (index + 1) + '-' + (fileIndex + 1) + '.' + extension;
      if (totalBytes + attachment.size > projectExportLimit) throw Object.assign(Error('项目资料超过单次导出 64 MiB 上限，请联系维护人员使用数据库备份交接。'), {status: 413});
      addFile(filePath, readAttachment(record, attachment));
      attachment.exportPath = filePath;
      attachments.push(`<li><a href="${filePath}" download="${escapeHtml(attachment.name)}">${escapeHtml(attachment.name)}</a> · ${attachment.size} bytes</li>`);
    }
    links.push(`<section><h2><a href="${path}">${escapeHtml(record.title)}</a></h2><p>修订 ${record.revision} · ${record.status === 'complete' ? '已归档' : '办理中'}</p><ul>${attachments.join('')}</ul></section>`);
  }
  addFile('project.json', JSON.stringify(selected, null, 2));
  addFile('index.html', `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(project.name)} · 项目资料</title><style>body{max-width:960px;margin:48px auto;padding:24px;font:16px/1.7 system-ui;color:#282333;background:#faf8f4}section{padding:20px;margin:20px 0;border:1px solid #ded8e8;border-radius:20px;background:white}a{color:#59428a}h1{font-size:30px}li{overflow-wrap:anywhere}</style></head><body><h1>${escapeHtml(project.name)}</h1><p>FlowLens 项目资料 · ${escapeHtml(selected.createdAt)} · 工作区修订 ${selected.storageRevision}</p><p>请先完整解压，再打开表单和附件。表单包含已保存内容与办理历史，附件原名称见下方。附件为原始内容，打开前请确认来源。电子签章与正式签署需按项目要求核验。</p><p><a href="project.json">结构化项目资料</a> · <a href="manifest.json">文件 SHA256 清单</a></p><p>此资料包供阅读与交接，恢复服务使用管理员数据库备份。SHA256 可帮助检查传输完整性，校验清单自身由交接双方核对。</p>${links.join('') || '<p>此项目暂未创建业务单据。</p>'}</body></html>`);
  addFile('manifest.json', JSON.stringify({format: 'flowlens-file-manifest', version: 1, files: [...manifest]}, null, 2));
  // Store mode avoids CPU-heavy compression of already compressed scans and images.
  return zipSync(files, {level: 0});
}
