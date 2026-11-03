import {projectRoles} from './apps-model.mjs';

function templateSummary(template) {
  return {id: template.id, title: template.title, version: template.version, submitterRole: template.submitterRole,
    workflow: template.workflow.map(({id, label, role, kind}) => ({id, label, role, kind}))};
}

function fieldSummary(record) {
  const summary = [];
  for (const field of record.template.fields) {
    const value = record.values[field.id];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    let text = String(value);
    if (field.type === 'table') {
      try {
        const rows = JSON.parse(text);
        text = Array.isArray(rows) ? `${rows.length} 行明细` : '请打开单据查看明细';
      } catch { text = '请打开单据查看明细'; }
    }
    if (field.type === 'boolean') {
      if (text === 'true') text = '是';
      if (text === 'false') text = '否';
    }
    text = text.replace(/\s+/gu, ' ').trim();
    const characters = Array.from(text);
    summary.push({label: Array.from(field.label).slice(0, 60).join(''), text: characters.slice(0, 120).join('') + (characters.length > 120 ? '…' : '')});
    if (summary.length === 3) break;
  }
  return summary;
}

export function summarizeWorkspace(value, memberships, {projectId = '', page = '1', filter = 'all', search = '', recordId = ''} = {}) {
  const requestedPage = Number(page);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !['all', 'pending'].includes(filter) || typeof search !== 'string' || search.length > 200) throw Error('清单分页或筛选参数无效');
  const selectedProject = value.projects.find(item => item.id === projectId) ?? value.projects[0];
  const selectedId = selectedProject?.id ?? '';
  const roles = memberships.find(item => item.projectId === selectedId)?.roles ?? [];
  const records = value.cases.filter(item => item.projectId === selectedId);
  const record = recordId ? records.find(item => item.id === recordId) : undefined;
  if (recordId && !record) throw Object.assign(Error('业务不存在或不可访问'), {status: 404});
  const pending = record => record.status !== 'complete' && roles.includes(record.status === 'draft' ? record.submitter : record.template.workflow[record.step]?.role);
  const needle = search.trim().toLowerCase();
  const matches = records.filter(record => (filter === 'all' || pending(record)) && (!needle || [record.id, record.title, ...Object.values(record.values)].some(value => String(value).toLowerCase().includes(needle))));
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(requestedPage, pages);
  const roleOptions = Object.fromEntries(value.projects.map(project => [project.id, projectRoles(value, project.id)]));
  return {
    projection: 'summary',
    record,
    workspace: {
      format: value.format, version: value.version, storageRevision: value.storageRevision,
      projects: value.projects,
      applications: value.applications.map(app => ({id: app.id, name: app.name, templateIds: app.templateIds, relations: app.relations.map(({id, from, to, label}) => ({id, from, to, label}))})),
      templates: value.templates.map(templateSummary),
      cases: matches.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(record => ({
        id: record.id, title: record.title, projectId: record.projectId, appId: record.appId,
        revision: record.revision, status: record.status, step: record.step, submitter: record.submitter,
        summary: fieldSummary(record),
        template: templateSummary(record.template), link: record.link ? {label: record.link.label} : undefined
      }))
    },
    memberships, roleOptions,
    listing: {projectId: selectedId, page: currentPage, pageSize, pages, filter, search, total: records.length, matched: matches.length, pending: records.filter(pending).length}
  };
}
