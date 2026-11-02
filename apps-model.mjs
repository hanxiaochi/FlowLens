import {createCase, applyOperation, uid} from './forms-model.mjs';
import {validateFieldValue} from './forms-schema.mjs';

export function createApplication(name, templateIds) {
  if (!name?.trim() || name.length > 200 || !templateIds.length) throw Error('请填写应用名称并选择至少一份模板');
  return {id: uid(), name: name.trim(), templateIds: [...new Set(templateIds)], relations: [], bindings: []};
}

export function createProject(appId, name, contractor = '') {
  if (!name?.trim() || name.length > 200 || contractor.length > 500) throw Error('请填写有效项目名称和施工单位');
  return {id: uid(), appId, name: name.trim(), contractor};
}

function application(workspace, appId) {
  const app = workspace.applications?.find(item => item.id === appId);
  if (!app) throw Error('应用不存在');
  return app;
}

export function validateRelation(app, relation, templates) {
  const source = templates.find(item => item.id === relation.from);
  const target = templates.find(item => item.id === relation.to);
  if (!relation.id || !relation.label?.trim() || relation.label.length > 200 || !source || !target || source.id === target.id) throw Error('请选择不同的上游、下游模板并填写关系名称');
  if (![source.id, target.id].every(id => app.templateIds.includes(id))) throw Error('关联模板必须属于同一应用');
  if (!Array.isArray(relation.mappings) || relation.mappings.length > 100) throw Error('字段映射无效');
  const seen = new Set();
  for (const mapping of relation.mappings) {
    const from = source.fields.find(field => field.id === mapping.from);
    const to = target.fields.find(field => field.id === mapping.to);
    if (!from || !to || to.owner !== 'draft' || seen.has(to.id)) throw Error('每个下游填报字段只能映射一次');
    if ((from.type ?? 'text') !== (to.type ?? 'text')) throw Error('映射字段需使用相同类型');
    seen.add(to.id);
  }
  // Relations form a directed acyclic graph. Historical records keep their own link snapshot.
  const edges = [...app.relations.filter(item => item.id !== relation.id), relation];
  function visit(id, path) {
    if (path.has(id)) throw Error('业务关系不能形成循环');
    const next = new Set([...path, id]);
    for (const edge of edges.filter(item => item.from === id)) visit(edge.to, next);
  }
  visit(relation.from, new Set());
  return structuredClone(relation);
}

export function startProjectCase(workspace, {appId, projectId, templateId, sourceId, relationId, role}) {
  const app = application(workspace, appId);
  const project = workspace.projects?.find(item => item.id === projectId && item.appId === appId);
  const template = workspace.templates.find(item => item.id === templateId);
  if (!project || !template || !app.templateIds.includes(templateId)) throw Error('请选择当前应用中的项目和模板');
  let source, relation;
  if (sourceId || relationId) {
    relation = app.relations.find(item => item.id === relationId && item.to === templateId);
    source = workspace.cases.find(item => item.id === sourceId);
    if (!relation || !source || source.appId !== appId || source.projectId !== projectId || source.template.id !== relation.from) throw Error('上游业务与当前项目或关系不一致');
    if (source.status !== 'complete') throw Error('请先完成上游单据的办理，再发起下游');
    const existing = workspace.cases.find(item => item.projectId === projectId && item.link?.sourceId === sourceId && item.link.relationId === relationId);
    if (existing) return {record: structuredClone(existing), existing: true};
  } else if (app.relations.some(item => item.to === templateId)) {
    throw Error('请从关联的上游单据发起这份业务');
  }
  let record = createCase(template, {project: project.name, role: role || template.submitterRole || '填报人', relatedId: source?.id ?? null});
  record.appId = appId;
  record.projectId = projectId;
  record.provenance = [];
  const values = {};
  for (const binding of app.bindings.filter(item => item.templateId === templateId)) {
    const field = template.fields.find(item => item.id === binding.fieldId);
    const value = project[binding.key] ?? '';
    if (!field || field.owner !== 'draft') throw Error('项目资料映射已经变化，请重新确认');
    validateFieldValue(field, value);
    values[field.id] = value;
    record.provenance.push({fieldId: field.id, source: 'project', sourceId: project.id, key: binding.key, value});
  }
  if (relation) {
    for (const mapping of relation.mappings) {
      const field = template.fields.find(item => item.id === mapping.to);
      const sourceField = source.template.fields.find(item => item.id === mapping.from);
      if (!sourceField || !field || field.owner !== 'draft') throw Error('历史上游与当前字段映射不兼容，请核对模板');
      const value = source.values[mapping.from] ?? '';
      validateFieldValue(field, value);
      values[field.id] = value;
      record.provenance.push({fieldId: field.id, source: 'record', sourceId: source.id, sourceRevision: source.revision, sourceFieldId: mapping.from, value});
    }
    record.link = {relationId: relation.id, sourceId: source.id, sourceRevision: source.revision, label: relation.label, mappings: structuredClone(relation.mappings)};
  }
  if (Object.keys(values).length) record = applyOperation(record, {type: 'save', role: record.submitter, values, note: '带入项目资料与上游已保存字段，请核对后提交'});
  return {record, existing: false};
}

export function validateApplications(workspace) {
  const apps = workspace.applications ?? [];
  const projects = workspace.projects ?? [];
  if (!Array.isArray(apps) || apps.length > 100 || !Array.isArray(projects) || projects.length > 1000) throw Error('应用或项目数量无效');
  const appIds = new Set();
  for (const app of apps) {
    if (typeof app.id !== 'string' || app.id.length > 200 || !app.id || appIds.has(app.id) || !app.name?.trim() || app.name.length > 200 || !Array.isArray(app.templateIds) || !app.templateIds.length || new Set(app.templateIds).size !== app.templateIds.length) throw Error('应用定义无效');
    appIds.add(app.id);
    if (!app.templateIds.every(id => workspace.templates.some(item => item.id === id))) throw Error('应用引用的模板不存在');
    if (!Array.isArray(app.relations) || !Array.isArray(app.bindings) || app.relations.length > 200 || app.bindings.length > 2000) throw Error('应用关系或映射无效');
    const relationIds = new Set();
    for (const relation of app.relations) {
      if (relationIds.has(relation.id)) throw Error('关系编号重复');
      relationIds.add(relation.id);
      validateRelation(app, relation, workspace.templates);
    }
    const bound = new Set();
    for (const binding of app.bindings) {
      const field = workspace.templates.find(item => item.id === binding.templateId)?.fields.find(item => item.id === binding.fieldId);
      const key = binding.templateId + '/' + binding.fieldId;
      if (!app.templateIds.includes(binding.templateId) || !field || field.owner !== 'draft' || !['name', 'contractor'].includes(binding.key) || bound.has(key)) throw Error('项目资料映射无效');
      if ((field.type ?? 'text') !== 'text') throw Error('项目名称和施工单位需映射到文字字段');
      bound.add(key);
    }
  }
  const projectIds = new Set();
  for (const project of projects) {
    if (!project.id || projectIds.has(project.id) || !appIds.has(project.appId)) throw Error('项目归属无效');
    createProject(project.appId, project.name, project.contractor);
    projectIds.add(project.id);
  }
  for (const record of workspace.cases) {
    if (!record.appId && !record.projectId) continue;
    const app = apps.find(item => item.id === record.appId);
    if (!app || !app.templateIds.includes(record.template.id) || !projects.some(item => item.id === record.projectId && item.appId === app.id)) throw Error('业务的应用与项目归属无效');
    if (record.relatedId) {
      const source = workspace.cases.find(item => item.id === record.relatedId);
      if (!source || source.appId !== record.appId || source.projectId !== record.projectId) throw Error('关联业务必须属于同一项目');
    }
    if (record.link && (record.link.sourceId !== record.relatedId || !Number.isSafeInteger(record.link.sourceRevision) || record.link.sourceRevision < 0 || typeof record.link.relationId !== 'string' || typeof record.link.label !== 'string' || !Array.isArray(record.link.mappings))) throw Error('关联来源快照无效');
    if (record.provenance !== undefined) {
      if (!Array.isArray(record.provenance) || record.provenance.length > 1000) throw Error('字段来源快照无效');
      for (const entry of record.provenance) {
        if (!entry || !record.template.fields.some(field => field.id === entry.fieldId) || typeof entry.value !== 'string' || !['project', 'record'].includes(entry.source)) throw Error('字段来源快照无效');
        if (entry.source === 'project' && entry.sourceId !== record.projectId) throw Error('字段项目来源无效');
        if (entry.source === 'record' && (entry.sourceId !== record.relatedId || !Number.isSafeInteger(entry.sourceRevision))) throw Error('字段上游来源无效');
      }
    }
  }
}

export function applicationPackage(workspace, appId) {
  const app = application(workspace, appId);
  const cases = workspace.cases.filter(item => item.appId === appId);
  const ids = new Set(cases.map(item => item.id));
  if (cases.some(item => item.relatedId && !ids.has(item.relatedId))) throw Error('存在应用外关联，请导出完整工作区');
  return {
    format: 'flowlens-forms', version: 3,
    applications: [structuredClone(app)],
    projects: structuredClone(workspace.projects.filter(item => item.appId === appId)),
    templates: structuredClone(workspace.templates.filter(item => app.templateIds.includes(item.id))),
    cases: structuredClone(cases)
  };
}
