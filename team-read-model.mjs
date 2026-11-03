import {projectRoles} from './apps-model.mjs';

function templateSummary(template) {
  return {id: template.id, title: template.title, version: template.version, submitterRole: template.submitterRole,
    workflow: template.workflow.map(({id, label, role, kind}) => ({id, label, role, kind}))};
}

export function summarizeWorkspace(value, memberships, {projectId = '', page = '1', filter = 'all', search = ''} = {}) {
  const requestedPage = Number(page);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !['all', 'pending'].includes(filter) || typeof search !== 'string' || search.length > 200) throw Error('清单分页或筛选参数无效');
  const selectedProject = value.projects.find(item => item.id === projectId) ?? value.projects[0];
  const selectedId = selectedProject?.id ?? '';
  const roles = memberships.find(item => item.projectId === selectedId)?.roles ?? [];
  const records = value.cases.filter(item => item.projectId === selectedId);
  const pending = record => record.status !== 'complete' && roles.includes(record.status === 'draft' ? record.submitter : record.template.workflow[record.step]?.role);
  const needle = search.trim().toLowerCase();
  const matches = records.filter(record => (filter === 'all' || pending(record)) && (!needle || [record.id, record.title, ...Object.values(record.values)].some(value => String(value).toLowerCase().includes(needle))));
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(requestedPage, pages);
  const roleOptions = Object.fromEntries(value.projects.map(project => [project.id, projectRoles(value, project.id)]));
  return {
    projection: 'summary',
    workspace: {
      format: value.format, version: value.version, storageRevision: value.storageRevision,
      projects: value.projects,
      applications: value.applications.map(app => ({id: app.id, name: app.name, templateIds: app.templateIds, relations: app.relations.map(({id, from, to, label}) => ({id, from, to, label}))})),
      templates: value.templates.map(templateSummary),
      cases: matches.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(record => ({
        id: record.id, title: record.title, projectId: record.projectId, appId: record.appId,
        revision: record.revision, status: record.status, step: record.step, submitter: record.submitter,
        template: templateSummary(record.template), link: record.link ? {label: record.link.label} : undefined
      }))
    },
    memberships, roleOptions,
    listing: {projectId: selectedId, page: currentPage, pageSize, pages, filter, search, total: records.length, matched: matches.length, pending: records.filter(pending).length}
  };
}
