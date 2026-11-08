import {createHash} from 'node:crypto';
import {upgradeWorkspace} from './forms-store.mjs';

export function prepareProjectRestore(inspection, options, user) {
  if (typeof options.operationId !== 'string' || !/^[\w-]{8,100}$/.test(options.operationId)) throw Error('需要有效恢复操作编号');
  if (typeof options.projectName !== 'string' || !options.projectName.trim() || options.projectName.trim().length > 200) throw Error('新项目名称需为 1–200 个字符');
  if (options.archiveSha256 !== inspection.report.archiveSha256) throw Error('资料包已变化，请重新检查');
  if (!Array.isArray(options.memberships) || options.memberships.length > 100) throw Error('请选择有效的目标成员安排');
  const workspace = structuredClone(inspection.workspace);
  const mappings = {};
  for (const key of ['projects', 'applications', 'templates', 'cases']) {
    mappings[key] = new Map(workspace[key].map(item => [item.id, 'restored-' + createHash('sha256').update(options.operationId + '/' + key + '/' + item.id).digest('hex').slice(0, 32)]));
  }
  const sourceProject = structuredClone(workspace.projects[0]);
  const app = workspace.applications[0];
  app.id = mappings.applications.get(app.id);
  app.name = (app.name.slice(0, 190) + ' · 恢复副本');
  app.templateIds = app.templateIds.map(id => mappings.templates.get(id));
  for (const relation of app.relations) {
    relation.from = mappings.templates.get(relation.from);
    relation.to = mappings.templates.get(relation.to);
  }
  for (const binding of app.bindings) binding.templateId = mappings.templates.get(binding.templateId);
  for (const requirement of app.requirements ?? []) {
    const target = requirement.target;
    target.templateId = mappings.templates.get(target.templateId) ?? target.templateId;
    if (target.kind === 'template') target.id = mappings.templates.get(target.id) ?? target.id;
  }
  for (const template of workspace.templates) template.id = mappings.templates.get(template.id);
  const project = workspace.projects[0];
  project.id = mappings.projects.get(project.id);
  project.appId = app.id;
  project.name = options.projectName.trim();
  const restoredAt = new Date().toISOString();
  const externalActor = actor => {
    if (!actor) return undefined;
    if (typeof actor.id !== 'string' || actor.id.length > 200 || typeof actor.name !== 'string' || actor.name.length > 500) throw Error('历史操作者信息无效');
    return {id: actor.id, name: actor.name, external: true};
  };
  for (const record of workspace.cases) {
    const originalId = record.id;
    record.id = mappings.cases.get(record.id);
    record.appId = app.id;
    record.projectId = project.id;
    record.project = project.name;
    record.template.id = mappings.templates.get(record.template.id);
    if (record.relatedId) record.relatedId = mappings.cases.get(record.relatedId);
    if (record.link) record.link.sourceId = mappings.cases.get(record.link.sourceId);
    for (const entry of record.provenance ?? []) entry.sourceId = (entry.source === 'project' ? mappings.projects : mappings.cases).get(entry.sourceId);
    if (record.createdBy) record.createdBy = externalActor(record.createdBy);
    for (const event of record.events) if (event.actor) event.actor = externalActor(event.actor);
    // Retain previous imported provenance as external source material.
    if (record.restoration) record.sourceRestoration = {restoration: record.restoration, previous: record.sourceRestoration};
    record.restoration = {archiveSha256: inspection.report.archiveSha256, sourceRecordId: originalId, sourceProjectId: sourceProject.id, sourceProjectName: sourceProject.name, restoredAt, restoredBy: {id: user.id, name: user.name}};
    for (const attachment of record.attachments) delete attachment.exportPath;
  }
  upgradeWorkspace(workspace, {allowAttachmentReferences: true});
  const roles = new Set(inspection.report.requiredRoles);
  const members = new Set();
  for (const membership of options.memberships) {
    if (!membership || typeof membership.userId !== 'string' || members.has(membership.userId) || !Array.isArray(membership.roles) || !membership.roles.length || membership.roles.length > 30 || new Set(membership.roles).size !== membership.roles.length || membership.roles.some(role => !roles.has(role))) throw Error('成员与办理角色安排无效');
    members.add(membership.userId);
  }
  return {workspace, mappings: Object.fromEntries(Object.entries(mappings).map(([key, values]) => [key, Object.fromEntries(values)])), project};
}
