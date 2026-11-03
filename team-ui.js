import {projectRoles} from './apps-model.mjs';
import {canEdit} from './forms-model.mjs';
import {renderDetailField} from './forms-detail-ui.js';
import {printableForm} from './forms-print.mjs';
import {deliveryStatusLabels} from './team-delivery.mjs';

const content = document.querySelector('#content');
const account = document.querySelector('#account');
const notice = document.querySelector('#notice');
let user, workspace, memberships = [], selectedId = '', projectId = '', busy = false, pending = null;
let deliveryDraft = null;
let selectedRecord = null, listing = null, roleOptions = {};
let listQuery = {page: 1, filter: 'all', search: ''};
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const button = (text, action, className) => {
  const element = node('button', text, className); element.type = 'button'; element.onclick = () => task(action); return element;
};
const input = (name, type = 'text') => {
  const field = node('input'); field.type = type; field.setAttribute('aria-label', name); return field;
};
const label = (text, field) => { const element = node('label', text); element.append(field); return element; };
const select = (name, options, value) => {
  const element = node('select'); element.setAttribute('aria-label', name);
  for (const [id, text] of options) element.append(new Option(text, id));
  element.value = value ?? options[0]?.[0] ?? ''; return element;
};
function say(text, error = false) { notice.textContent = text; notice.classList.toggle('error', error); }
async function api(path, data) {
  const response = await fetch('/api/team/' + path, {method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-FlowLens-Request': '1', 'X-FlowLens-Client': '3'}, body: data === undefined ? undefined : JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.error || '请求失败'), {status: response.status});
  return result;
}
async function task(action) {
  if (busy) return;
  busy = true; content.inert = true; account.inert = true;
  try { await action(); }
  catch (error) { say(error.message + (error.status === 401 ? '。请先下载草稿，然后重新登录。' : ''), true); }
  finally { busy = false; content.inert = false; account.inert = false; }
}
function download(name, value, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([value], {type})); const link = node('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function downloadFromServer(path, name, type = 'application/octet-stream') {
  const controller = new AbortController(); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 120000);
  say('正在下载 ' + name + '，可以取消后重试。');
  const cancel = node('button', '取消下载'); cancel.type = 'button'; cancel.onclick = () => controller.abort(); notice.append(cancel);
  try {
    const response = await fetch(path, {credentials: 'same-origin', signal: controller.signal});
    if (!response.ok) { const result = await response.json(); throw Object.assign(Error(result.error || '下载失败'), {status: response.status}); }
    download(name, await response.blob(), type);
    say('文件已交给浏览器下载，请查看下载列表。');
  } catch (error) {
    if (controller.signal.aborted && !timedOut) { say('已取消下载，可以重新尝试。'); return; }
    if (timedOut) throw Error('下载超时，请检查网络后重试。');
    throw error;
  } finally { clearTimeout(timer); }
}
function current() { return selectedRecord?.id === selectedId ? selectedRecord : undefined; }
function roleFor(record) { return record.status === 'draft' ? record.submitter : record.template.workflow[record.step]?.role; }
function roles() { return memberships.find(item => item.projectId === projectId)?.roles ?? []; }
function values() { return Object.fromEntries(Array.from(content.querySelectorAll('[data-field]')).map(field => [field.dataset.field, field.value])); }
function dirty() {
  if (deliveryDraft) return true;
  const record = current();
  return record && (Object.entries(values()).some(([key, value]) => value !== (record.values[key] ?? '')) || !!content.querySelector('#operation-note')?.value);
}
function clean() { if (dirty() || pending) { say('当前有填写内容或待确认请求，请保存、下载草稿后重新读取，或重试原请求。', true); return false; } return true; }
function draft() { download('FlowLens-协作草稿.json', JSON.stringify(deliveryDraft ?? {recordId: selectedId, revision: current()?.revision, values: values(), note: content.querySelector('#operation-note')?.value ?? '', pending}, null, 2)); }
window.addEventListener('beforeunload', event => { if (dirty() || pending) { event.preventDefault(); event.returnValue = ''; } });
async function refresh(nextQuery = listQuery, requestedProject = projectId) {
  const recordId = selectedRecord?.projectId === requestedProject ? selectedId : '';
  const query = new URLSearchParams({...nextQuery, projectId: requestedProject, recordId});
  const result = await api('workspace?' + query);
  if (result.projection !== 'summary' || !result.listing) throw Error('服务端读取协议已变化，请下载草稿并刷新页面。');
  workspace = result.workspace; memberships = result.memberships; listing = result.listing; roleOptions = result.roleOptions;
  projectId = listing.projectId;
  listQuery = {page: listing.page, filter: listing.filter, search: listing.search};
  if (selectedId && selectedRecord?.projectId !== projectId) { selectedId = ''; selectedRecord = null; }
  if (selectedId) selectedRecord = result.record;
}
function accountView() {
  account.replaceChildren();
  if (!user) return;
  account.append(node('span', user.name + ' · ' + user.username));
  const controls = node('div', undefined, 'toolbar');
  controls.append(button('我的项目', async () => { if (!clean()) return; selectedId = ''; await refresh(); home(); }), button('修改密码', () => { if (clean()) passwordView(); }), button('退出登录', async () => { if (!clean()) return; await api('logout', {}); user = null; workspace = null; selectedId = ''; loginView(); }));
  controls.append(button('下载草稿并重新登录', () => { draft(); user = null; selectedId = ''; pending = null; deliveryDraft = null; loginView(); }));
  if (user.admin) controls.append(button('资料包检查', () => { if (clean()) projectCheckView(); }), button('管理后台', async () => { if (clean()) await adminView(); }), button('运行状态', async () => { if (clean()) await operationsView(); }));
  if (user.admin) controls.append(button('交付检查', async () => { if (clean()) await deliveryView(); }));
  if (user.admin && savedProjectRestore()) controls.append(button('继续待确认恢复', () => { if (clean()) restoreRetryView(); }));
  account.append(controls);
}
function loginView() {
  selectedRecord = null; listing = null; roleOptions = {}; projectId = ''; listQuery = {page: 1, filter: 'all', search: ''};
  account.replaceChildren(); content.replaceChildren();
  const panel = node('div', undefined, 'panel login');
  panel.append(node('span', 'SHARED WORKSPACE', 'badge'), node('h1', '一起把业务办完'), node('p', '使用管理员分配的账号登录。你的项目和办理权限由服务器确认。', 'muted'));
  const username = input('账号'); username.autocomplete = 'username'; username.required = true;
  const password = input('密码', 'password'); password.autocomplete = 'current-password'; password.required = true;
  const form = node('form'); const submit = node('button', '登录', 'primary'); submit.type = 'submit';
  form.append(label('账号', username), label('密码', password), submit);
  form.onsubmit = event => { event.preventDefault(); task(async () => { user = (await api('login', {username: username.value, password: password.value})).user; await refresh(); home(); say('已登录，选择项目开始办理。'); }); };
  panel.append(form); content.append(panel);
}
function home() {
  accountView(); content.replaceChildren(); selectedId = '';
  const hero = node('section', undefined, 'hero'); hero.append(node('span', 'PROJECTS, CONNECTED', 'badge'), node('h1', '从待办开始，把一件事办到底。'));
  if (!workspace.projects.length) {
    hero.append(node('p', user.admin ? '先在管理后台导入应用包，再创建账号并分配项目角色。' : '当前账号还没有项目，请联系管理员分配。'));
    content.append(hero); return;
  }
  const projects = select('当前项目', workspace.projects.map(project => [project.id, project.name]), projectId);
  projects.onchange = () => task(async () => {
    try { await refresh({page: 1, filter: 'all', search: ''}, projects.value); home(); }
    finally { projects.value = projectId; }
  });
  hero.append(label('当前项目', projects), node('p', '我的项目角色 · ' + (roles().join('、') || '只读管理查看'), 'muted'));
  const project = workspace.projects.find(item => item.id === projectId);
  const app = workspace.applications.find(item => item.id === project.appId);
  hero.append(button('下载项目资料包', () => downloadFromServer('/api/team/project-export?projectId=' + encodeURIComponent(projectId), 'FlowLens-项目资料.zip', 'application/zip')));
  hero.append(node('p', '包含已保存表单、办理历史、附件与文件校验清单，单次最多 64 MiB。解压后打开 index.html。', 'muted'));
  content.append(hero);
  const templates = node('div', undefined, 'cards');
  for (const template of workspace.templates.filter(item => app.templateIds.includes(item.id))) {
    const card = node('article', undefined, 'card'); card.append(node('h3', template.title));
    if (app.relations.some(relation => relation.to === template.id)) card.append(node('p', '从上游已完成单据发起，自动带入资料。'));
    else {
      const create = button('发起 ' + template.title, () => command({type: 'create', projectId, templateId: template.id}), 'primary');
      create.disabled = !roles().includes(template.submitterRole || '填报人'); card.append(create);
    }
    templates.append(card);
  }
  content.append(templates);
  const records = workspace.cases.filter(record => record.projectId === projectId);
  const filters = node('div', undefined, 'toolbar');
  for (const [value, text] of [['all', '全部业务 · ' + listing.total], ['pending', '我的待办 · ' + listing.pending]]) {
    filters.append(button(text, async () => { await refresh({...listQuery, filter: value, page: 1}); home(); }, listQuery.filter === value ? 'primary' : undefined));
  }
  const search = input('按编号或填写内容搜索'); search.placeholder = '输入编号或填写内容'; search.maxLength = 200; search.value = listQuery.search;
  const searchRecords = async () => { await refresh({...listQuery, search: search.value.trim(), page: 1}); home(); };
  search.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); task(searchRecords); } };
  filters.append(search, button('搜索', searchRecords), button('清除筛选', async () => { await refresh({page: 1, filter: 'all', search: ''}); home(); }));
  content.append(filters, node('h2', '符合当前筛选 · ' + listing.matched + ' 份'));
  if (!records.length) content.append(node('p', '当前筛选下没有业务记录。', 'muted'));
  const list = node('div', undefined, 'cards');
  for (const record of records) {
    const card = node('article', undefined, 'card');
    card.append(node('span', record.status === 'complete' ? '已归档' : '待 ' + roleFor(record), 'badge'), node('h3', record.title), node('p', record.link?.label || '项目发起'), button('打开单据', () => openRecord(record.id)));
    list.append(card);
  }
  content.append(list);
  const pagination = node('div', undefined, 'toolbar');
  const previous = button('上一页', async () => { await refresh({...listQuery, page: listing.page - 1}); home(); }); previous.disabled = listing.page <= 1;
  const next = button('下一页', async () => { await refresh({...listQuery, page: listing.page + 1}); home(); }); next.disabled = listing.page >= listing.pages;
  pagination.append(previous, node('span', '第 ' + listing.page + ' / ' + listing.pages + ' 页 · 每页 ' + listing.pageSize + ' 份'), next); content.append(pagination);
  const retry = button('重试原请求', sendPending); retry.id = 'retry-request'; retry.hidden = !pending; content.append(retry);
}
async function openRecord(id) {
  if (!clean()) return;
  const result = await api('record?recordId=' + encodeURIComponent(id));
  selectedRecord = result.record; selectedId = result.record.id; projectId = result.record.projectId; recordView();
}
async function command(data) {
  if (pending) throw Error('上一项业务操作的结果尚未确认，请先点击“重试原请求”，或下载草稿并重新读取。');
  pending = {...data, operationId: crypto.randomUUID()};
  await sendPending();
}
async function sendPending() {
  if (!pending) throw Error('当前没有待确认的业务操作。');
  try {
    const result = await api('command', pending);
    pending = null; selectedId = result.record.id; selectedRecord = result.record;
    await refresh(); recordView(); say('已保存到服务器。');
  } catch (error) {
    if (!pending) {
      recordView();
      throw Error('业务已保存，但清单刷新失败。请稍后重新读取。' + error.message);
    }
    if (error.status) pending = null;
    const form = content.querySelector('.record-form'); if (form) form.inert = !!pending;
    const note = content.querySelector('#operation-note'); if (note) note.disabled = !!pending;
    const retry = content.querySelector('#retry-request'); if (retry) retry.hidden = !pending;
    if (pending) throw Error('尚未收到业务结果确认，请点击“重试原请求”。');
    throw error;
  }
}
function fieldControl(parent, field, record, role) {
  const editable = canEdit(record, field, role) && roles().includes(role);
  if (field.type === 'table') {
    renderDetailField(parent, field, record.values[field.id], editable);
    if (!editable) delete parent.querySelector('textarea[data-field]').dataset.field;
    return;
  }
  let control;
  if (field.type === 'select' || field.type === 'boolean') {
    const choices = field.type === 'boolean' ? [['true', '是'], ['false', '否']] : field.options.map(value => [value, value]);
    control = select(field.label, [['', '请选择'], ...choices], record.values[field.id] ?? '');
  } else {
    control = field.type === 'date' || field.type === 'number' ? input(field.label, field.type) : node('textarea');
    if (field.type === 'number') control.step = 'any';
    control.value = record.values[field.id] ?? '';
  }
  control.setAttribute('aria-label', field.label); control.disabled = !editable;
  if (editable) control.dataset.field = field.id;
  parent.append(label(field.label + (field.required ? ' *' : ''), control));
}
function renderBlocks(parent, blocks, record, role) {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      parent.append(node('p', block.text));
      const field = record.template.fields.find(item => item.id === block.id);
      if (field) fieldControl(parent, field, record, role);
      continue;
    }
    const table = node('table');
    for (const row of block.rows) {
      const tr = node('tr');
      for (const cell of row) {
        const td = node('td'); td.colSpan = cell.colspan; td.rowSpan = cell.rowspan;
        const field = record.template.fields.find(item => item.id === cell.id);
        renderBlocks(td, cell.blocks, record, role);
        if (!cell.blocks.length && cell.text) td.append(node('p', cell.text));
        if (field) fieldControl(td, field, record, role);
        tr.append(td);
      }
      table.append(tr);
    }
    parent.append(table);
  }
}
function recordView() {
  accountView(); content.replaceChildren();
  const record = current(); if (!record) { home(); return; }
  const role = roleFor(record); const editable = roles().includes(role) && record.status !== 'complete';
  const toolbar = node('div', undefined, 'toolbar');
  toolbar.append(button('返回项目', async () => { if (clean()) { selectedId = ''; await refresh(); home(); } }), button('下载当前草稿', draft), button('下载草稿并重新读取', async () => { draft(); pending = null; await refresh(); recordView(); say('已重新读取服务器版本，请核对已下载草稿中的内容。'); }), button('下载打印版', () => { if (clean()) download('FlowLens-业务打印.html', printableForm(record, {shared: true}), 'text/html'); }));
  content.append(toolbar, node('h1', record.title), node('p', record.project + ' · 修订 ' + record.revision + ' · ' + (record.status === 'complete' ? '已归档' : '当前办理角色 ' + role), 'muted'));
  const layout = node('div', undefined, 'record-layout'); const form = node('article', undefined, 'panel record-form');
  renderBlocks(form, record.template.blocks, record, role);
  const side = node('aside', undefined, 'panel sidebar');
  const actions = node('div', undefined, 'record-actions');
  if (editable) {
    const note = node('textarea'); note.id = 'operation-note'; note.setAttribute('aria-label', '办理意见'); note.placeholder = '退回时请说明原因';
    actions.append(label('办理意见', note));
    const execute = type => command({type, recordId: record.id, expectedRevision: record.revision, values: values(), note: note.value});
    actions.append(button('保存填写', () => execute('save')), button(record.status === 'draft' ? '提交办理' : '办理并继续', () => execute(record.status === 'draft' ? 'submit' : 'advance'), 'primary'));
    if (record.status === 'active' && record.template.workflow[record.step].kind !== 'receipt') actions.append(button('退回修改', () => execute('return')));
    const file = input('添加附件', 'file'); file.className = 'file-input';
    file.onchange = () => task(async () => {
      if (!clean()) { file.value = ''; return; }
      const selected = file.files[0]; if (!selected) return;
      if (selected.size > 10 * 1024 * 1024) throw Error('单个附件最多 10 MB');
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('附件读取失败')); reader.readAsDataURL(selected); });
      await command({type: 'attachment', recordId: record.id, expectedRevision: record.revision, attachment: {name: selected.name, data}});
    });
    actions.append(label('添加照片或签署件', file));
  } else actions.append(node('p', record.status === 'complete' ? '这份业务已完成归档。' : '等待项目中的 ' + role + ' 办理。'));
  const retry = button('重试原请求', sendPending); retry.id = 'retry-request'; retry.hidden = !pending; actions.append(retry);
  side.append(actions);
  if (record.restoration) side.append(node('p', '恢复来源 · ' + record.restoration.sourceProjectName), node('p', '本次恢复由 ' + record.restoration.restoredBy.name + ' 于 ' + record.restoration.restoredAt + ' 执行。', 'muted'));
  for (const attachment of record.attachments) side.append(button('下载附件 · ' + attachment.name, async () => {
    if (attachment.data) { const link = node('a'); link.href = attachment.data; link.download = attachment.name; link.click(); return; }
    await downloadFromServer('/api/team/attachment?recordId=' + encodeURIComponent(record.id) + '&attachmentId=' + encodeURIComponent(attachment.id), attachment.name);
  }));
  const app = workspace.applications.find(item => item.id === record.appId);
  for (const relation of app.relations.filter(item => item.from === record.template.id)) {
    const target = workspace.templates.find(item => item.id === relation.to);
    const create = button(relation.label, () => { if (clean()) return command({type: 'create', projectId, templateId: target.id, sourceId: record.id, relationId: relation.id}); });
    create.disabled = record.status !== 'complete' || !roles().includes(target.submitterRole || '填报人'); side.append(create);
  }
  if (record.link) side.append(node('p', record.link.label + ' · 来源修订 ' + record.link.sourceRevision, 'muted'));
  side.append(node('h3', '办理历史'));
  for (const event of [...record.events].reverse()) {
    const item = node('div', undefined, 'event');
    item.append(node('strong', (event.actor?.external ? '外部历史 · ' + event.actor.name : event.actor?.name || '导入前记录') + ' · ' + event.role), node('p', event.from + ' → ' + event.to), node('p', event.note), node('small', event.at)); side.append(item);
  }
  layout.append(form, side); content.append(layout);
}
function passwordView() {
  content.replaceChildren(); const panel = node('section', undefined, 'panel login'); panel.append(node('h2', '修改密码'));
  const oldPassword = input('原密码', 'password'), newPassword = input('新密码', 'password'); newPassword.minLength = 12;
  panel.append(label('原密码', oldPassword), label('新密码，至少 12 位', newPassword), button('保存密码并重新登录', async () => { await api('password', {oldPassword: oldPassword.value, newPassword: newPassword.value}); user = null; selectedId = ''; loginView(); say('密码已修改，所有会话已退出，请重新登录。'); }, 'primary'));
  content.append(panel);
}
async function deliveryView(scope = 'instance', checkId) {
  const report = await api('delivery?scope=' + encodeURIComponent(scope));
  await refresh(); selectedId = ''; content.replaceChildren(); accountView();
  const scopes = select('检查范围', [['instance', '当前部署实例'], ...workspace.projects.map(project => ['project:' + project.id, project.name])], scope);
  const selected = report.checks.find(item => item.id === checkId) ?? report.checks[0];
  const checks = select('检查项目', report.checks.map(item => [item.id, item.title + ' · ' + deliveryStatusLabels[item.effectiveStatus]]), selected.id);
  scopes.onchange = () => task(async () => { if (clean()) await deliveryView(scopes.value); else scopes.value = scope; });
  checks.onchange = () => task(async () => { if (clean()) await deliveryView(scope, checks.value); else checks.value = selected.id; });
  content.append(node('h1', '交付检查记录'), node('p', '管理员记录人工确认结果与依据。系统展示记录人、修订和历史，业务负责人仍需对实际结论负责。', 'muted'));
  const selectors = node('div', undefined, 'toolbar'); selectors.append(label('检查范围', scopes), label('检查项目', checks)); content.append(selectors);
  const panel = node('section', undefined, 'panel stack');
  panel.append(node('h2', selected.title), node('p', selected.guidance), node('span', deliveryStatusLabels[selected.effectiveStatus], 'badge'));
  if (selected.effectiveStatus === 'needs-review') panel.append(node('p', '部署恢复、地址或项目配置已变化，请重新核验后保存。原确认依据仍保留在下方。', 'status-warning'));
  const status = select('确认状态', Object.entries(deliveryStatusLabels).filter(([id]) => id !== 'needs-review'), selected.effectiveStatus === 'needs-review' ? 'pending' : selected.status);
  const reviewer = input('确认人'); reviewer.maxLength = 100; reviewer.value = selected.reviewer;
  const evidence = node('textarea'); evidence.setAttribute('aria-label', '确认依据'); evidence.maxLength = 4000; evidence.value = selected.evidence;
  const payload = () => ({scope, checkId: selected.id, expectedRevision: selected.revision, expectedContextFingerprint: report.contextFingerprint, expectedRestoreMarker: report.restoreMarker, status: status.value, reviewer: reviewer.value, evidence: evidence.value});
  for (const field of [status, reviewer, evidence]) field.oninput = () => { deliveryDraft = payload(); };
  panel.append(label('确认状态', status), label('确认人', reviewer), label('依据、结果或待解决事项', evidence));
  let submission;
  const save = button('保存检查记录', async () => {
    submission ??= {...payload(), operationId: crypto.randomUUID()};
    deliveryDraft = submission;
    try {
      await api('delivery', submission); submission = null; deliveryDraft = null;
      await deliveryView(scope, selected.id); say('交付检查已保存，记录人和依据已进入历史。');
    } catch (error) {
      if (error.status) submission = null;
      for (const field of [status, reviewer, evidence]) field.disabled = !!submission;
      save.textContent = submission ? '重试原检查请求' : '保存检查记录';
      throw error;
    }
  }, 'primary');
  panel.append(save, button('下载交付草稿并重新读取', async () => { download('FlowLens-交付草稿.json', JSON.stringify(deliveryDraft ?? payload(), null, 2)); await deliveryView(scope, selected.id); deliveryDraft = null; }));
  if (selected.actor) panel.append(node('p', '记录人 ' + selected.actor.name + ' · 修订 ' + selected.revision + ' · ' + new Date(selected.updatedAt).toLocaleString(), 'muted'));
  content.append(panel, button('下载已保存的交付报告', () => download('FlowLens-交付检查.json', JSON.stringify(report, null, 2))));
  const history = node('details', undefined, 'panel'); history.append(node('summary', '查看此范围最近 ' + report.history.length + ' 条记录'));
  for (const entry of report.history) {
    const event = node('section', undefined, 'event');
    event.append(node('strong', (report.checks.find(item => item.id === entry.checkId)?.title ?? entry.checkId) + ' · ' + deliveryStatusLabels[entry.status]), node('p', '确认人 ' + entry.reviewer + ' · 记录人 ' + entry.actor.name), node('p', entry.evidence), node('p', new Date(entry.updatedAt).toLocaleString() + ' · 修订 ' + entry.revision));
    history.append(event);
  }
  content.append(history); say('已读取交付检查记录。未填写项目保持待确认。');
}
async function operationsView() {
  const status = await api('operations');
  selectedId = ''; content.replaceChildren(); accountView();
  const size = bytes => {
    if (bytes === null) return '暂时无法读取';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toLocaleString(undefined, {maximumFractionDigits: 2}) + ' KiB';
    return (bytes / 1024 / 1024).toLocaleString(undefined, {maximumFractionDigits: 2}) + ' MiB';
  };
  const date = value => new Date(value).toLocaleString();
  content.append(node('span', 'OPERATIONS', 'badge'), node('h1', '运行状态与备份'), node('p', '数据读取于 ' + date(status.checkedAt), 'muted'));
  const grid = node('div', undefined, 'admin-grid');
  const storage = node('section', undefined, 'panel stack');
  const usage = node('meter'); usage.max = status.workspaceLimitBytes; usage.value = status.workspaceBytes; usage.setAttribute('aria-label', '工作区容量使用量');
  storage.append(node('h2', '工作区容量'), node('strong', size(status.workspaceBytes) + ' / ' + size(status.workspaceLimitBytes), 'status-value'), usage);
  storage.append(node('p', '工作区包含表式、业务内容和附件引用。附件原文件独立保存在同一数据库中，数据库及写入日志还包含账号、审计和幂等请求记录。', 'muted'));
  if (status.workspaceBytes >= status.workspaceLimitBytes * 0.8) storage.append(node('p', '工作区接近实例上限，请联系维护人员评估容量。', 'status-warning'));
  storage.append(node('p', '数据库主文件 ' + size(status.databaseBytes) + ' · 写入日志 ' + size(status.databaseWalBytes)), node('p', '所在文件系统可用 ' + size(status.diskFreeBytes)));
  const business = node('section', undefined, 'panel stack');
  business.append(node('h2', '业务与账号'), node('strong', status.records + ' 份业务 · ' + status.projects + ' 个项目', 'status-value'), node('p', '其中 ' + status.completedRecords + ' 份已归档'), node('p', '附件原始大小合计 ' + size(status.attachmentBytes)), node('p', status.users.enabled + ' 个启用账号 / 共 ' + status.users.total + ' 个账号'));
  if (status.storedAttachmentBytes !== undefined) business.append(node('p', '独立文件内容 ' + status.storedAttachmentCount + ' 份 · ' + size(status.storedAttachmentBytes)));
  const service = node('section', undefined, 'panel stack');
  service.append(node('h2', '当前进程'), node('strong', Math.floor(status.uptimeSeconds / 60) + ' 分钟', 'status-value'), node('p', '进程已运行时长'), node('p', '当前驻留内存 ' + size(status.memoryBytes)), node('p', '本页展示当前读取结果，定时任务、证书续期和主机告警由部署维护人员核对。', 'muted'));
  grid.append(storage, business, service); content.append(grid);
  const recovery = node('section', undefined, 'panel stack'); recovery.append(node('h2', '备份与恢复记录'));
  if (status.lastBackup) {
    recovery.append(node('p', '最近通过完整性校验的备份 ' + date(status.lastBackup.completedAt)), node('p', '备份大小 ' + size(status.lastBackup.bytes) + ' · 备份工作区修订 ' + status.lastBackup.workspaceRevision + ' · 当前修订 ' + status.workspaceRevision), node('code', status.lastBackup.sha256, 'status-checksum'));
  } else recovery.append(node('p', '当前实例暂无已记录的备份成功结果。请维护人员执行备份命令，并核对生成文件。', 'status-warning'));
  if (status.lastRestore) recovery.append(node('p', '最近恢复完成于 ' + date(status.lastRestore.completedAt) + '。恢复后的旧登录会话已清除。'));
  if (status.lastAttachmentMigration) {
    const migration = status.lastAttachmentMigration;
    recovery.append(node('p', '附件存储迁移完成于 ' + date(migration.completedAt)), node('p', '迁移前快照 ' + migration.backupFile, 'status-checksum'));
    if (!migration.compacted) recovery.append(node('p', '数据库空闲页尚待维护整理，迁移后的数据已保存。', 'status-warning'));
  }
  recovery.append(node('p', '该记录覆盖备份生成及完整性检查。备份文件是否仍在、定时任务是否成功以及异地副本情况，需要维护人员另行核对。', 'muted'));
  content.append(recovery, button('刷新运行状态', operationsView), button('下载运行状态报告', () => download('FlowLens-运行状态.json', JSON.stringify(status, null, 2))));
  say('已读取管理员运行状态。');
}
function projectCheckView() {
  selectedId = ''; content.replaceChildren(); accountView();
  const panel = node('section', undefined, 'panel stack project-check');
  panel.append(node('h1', '接手前，先检查资料'), node('p', '选择 FlowLens 项目资料 ZIP。检查文件完整性、附件和单据关联，并与当前实例核对编号。ZIP 最大 66 MiB，展开内容最大 64 MiB。本次检查完成后，业务资料仍需交接双方确认。'));
  const file = input('选择项目资料 ZIP', 'file'); file.accept = '.zip';
  const results = node('section', undefined, 'panel stack project-check');
  file.onchange = () => { results.replaceChildren(); say(file.files[0] ? '已选择 ' + file.files[0].name + '，请点击上传并检查。' : '请选择项目资料包。'); };
  const check = button('上传并检查资料包', async () => {
    const selected = file.files[0]; if (!selected) throw Error('请选择项目资料 ZIP');
    if (selected.size > 66 * 1024 * 1024) throw Error('资料 ZIP 最大 66 MiB');
    results.replaceChildren();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    say('正在上传并检查资料包，可以取消后重试。');
    const cancel = node('button', '取消检查'); cancel.type = 'button'; cancel.onclick = () => controller.abort(); notice.append(cancel);
    try {
      const response = await fetch('/api/team/project-check', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/zip', 'X-FlowLens-Request': '1'}, body: selected, signal: controller.signal});
      const report = await response.json();
      if (!response.ok) throw Object.assign(Error(report.error || '检查失败'), {status: response.status});
      results.append(node('h2', '文件完整性检查通过'), node('p', report.project.name), node('p', report.records + ' 份业务 · ' + report.attachments + ' 个附件 · ' + report.files + ' 个文件'), node('p', report.notice), node('p', report.nextStep));
      results.append(node('h3', '当前实例编号冲突 · ' + report.conflicts.length));
      for (const conflict of report.conflicts) results.append(node('p', ({projects: '项目', applications: '应用', templates: '表式', cases: '业务'})[conflict.kind] + ' · ' + conflict.name + '（' + conflict.id + '）' + (conflict.sameDefinition === null ? '' : conflict.sameDefinition ? ' · 定义一致' : ' · 定义不同')));
      results.append(node('h3', '需要确认的办理角色'), node('p', report.requiredRoles.join('、')));
      results.append(node('h3', '历史操作者 · ' + report.historicalActors.length));
      for (const actor of report.historicalActors) results.append(node('p', actor.name + ' · ' + actor.id));
      results.append(node('p', '历史操作者信息来自资料包，后续恢复需单独确认当前账号与项目角色。'), button('下载检查报告', () => download('FlowLens-资料检查.json', JSON.stringify(report, null, 2))), button('准备恢复到新项目', () => projectRestoreView(selected, report), 'primary'));
      say('检查完成，请核对报告中的差异和待确认事项。');
    } catch (error) {
      if (controller.signal.aborted) { say('检查已取消或等待超时，可以重新尝试。'); return; }
      throw error;
    } finally { clearTimeout(timer); }
  }, 'primary');
  panel.append(label('项目资料包', file), check); content.append(panel, results);
}

function savedProjectRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem('flowlens.restore.' + user.id));
    return saved?.options?.operationId && saved?.plan?.projectName && Array.isArray(saved.plan.assignments) ? saved : null;
  } catch { return null; }
}

async function restoreArchiveRequest(path, file, options) {
  const encoded = encodeURIComponent(JSON.stringify(options));
  if (encoded.length > 65536) throw Error('恢复参数过大，请减少本次成员安排');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch('/api/team/' + path, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/zip', 'X-FlowLens-Request': '1', 'X-FlowLens-Restore': encoded}, body: file, signal: controller.signal});
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error || '恢复请求失败'), {status: response.status});
    return result;
  } finally { clearTimeout(timer); }
}
function showRestorePlan(panel, plan) {
  panel.append(node('h2', '目标项目 · ' + plan.projectName), node('p', '新增 ' + plan.newApplications + ' 个应用、' + plan.newTemplates + ' 份表式和 ' + plan.newRecords + ' 份业务。'), node('p', '附件合计 ' + plan.attachmentBytes + ' 字节，恢复后工作区元数据 ' + plan.projectedMetadataBytes + ' 字节。'));
  for (const member of plan.assignments) panel.append(node('p', member.name + ' · ' + member.roles.join('、')));
  panel.append(node('p', '尚未分配的角色 · ' + (plan.unassignedRoles.join('、') || '全部已安排')), node('p', '原编号映射保存在恢复报告中。已填写内容及业务编号文本原样保留。历史操作者将标记为外部历史，后续办理由目标项目成员完成。'));
}
async function submitProjectRestore(file, saved) {
  // Persist the confirmed request before sending so a lost response can be retried after reload.
  const key = 'flowlens.restore.' + user.id;
  try { localStorage.setItem(key, JSON.stringify(saved)); }
  catch { throw Error('浏览器无法保存恢复重试信息，请检查站点存储设置后重试。'); }
  accountView();
  say('正在恢复。若连接中断，可从顶部继续重试同一次恢复。');
  let result;
  try { result = await restoreArchiveRequest('project-restore', file, saved.options); }
  catch (error) {
    if (!error.status) throw Error('暂未收到恢复结果，请点击顶部“继续待确认恢复”重试同一次请求。');
    throw error;
  }
  localStorage.removeItem(key);
  await refresh({page: 1, filter: 'all', search: ''}, result.projectId); home();
  say('已恢复到 ' + result.projectName + '。请核对单据、附件与成员安排。');
  content.prepend(button('下载本次恢复报告', () => download('FlowLens-项目恢复.json', JSON.stringify(result, null, 2))));
}
function restoreRetryView() {
  const key = 'flowlens.restore.' + user.id;
  const saved = savedProjectRestore();
  if (!saved) { say('当前没有待重试恢复。'); return; }
  selectedId = ''; content.replaceChildren(); accountView();
  const panel = node('section', undefined, 'panel stack project-check');
  panel.append(node('h1', '继续已确认的恢复'), node('p', '重新选择同一份 ZIP。服务器会复用已完成的结果，或在重新核验后继续原请求。'));
  showRestorePlan(panel, saved.plan);
  const file = input('重选原项目 ZIP', 'file'); file.accept = '.zip';
  panel.append(label('原资料包 · ' + saved.filename, file), button('重试已确认恢复', async () => {
    const selected = file.files[0]; if (!selected) throw Error('请选择原资料包');
    if (selected.size > 66 * 1024 * 1024) throw Error('资料 ZIP 最大 66 MiB');
    await submitProjectRestore(selected, saved);
  }, 'primary'), button('放弃本次重试并返回项目核对', async () => {
    localStorage.removeItem(key); await refresh(); home(); say('已结束本次重试，请先核对项目列表，再决定是否重新恢复。');
  }));
  content.append(panel);
}
async function projectRestoreView(file, report) {
  if (savedProjectRestore()) { restoreRetryView(); return; }
  const data = await api('admin');
  selectedId = ''; content.replaceChildren(); accountView();
  const panel = node('section', undefined, 'panel stack project-check');
  panel.append(node('h1', '恢复到一个新项目'), node('p', '确认资料来源后，设置目标项目和办理成员。系统会创建独立编号，并保留原单据关联与外部历史。'));
  const name = input('恢复后的项目名称'); name.maxLength = 200; name.value = (report.project.name + ' · 恢复副本').slice(0, 200);
  panel.append(label('新项目名称', name));
  const choices = node('div', undefined, 'cards');
  const selections = [];
  const preview = node('section', undefined, 'panel stack project-check');
  name.oninput = () => preview.replaceChildren();
  for (const member of data.users.filter(item => !item.disabled)) {
    const card = node('section', undefined, 'card stack'); card.append(node('h3', member.name + ' · ' + member.username));
    for (const role of report.requiredRoles) {
      const check = input(member.name + ' · ' + role, 'checkbox'); check.onchange = () => preview.replaceChildren();
      const row = label(role, check); row.className = 'check'; card.append(row);
      selections.push({userId: member.id, role, check});
    }
    choices.append(card);
  }
  panel.append(node('p', '勾选本项目的办理角色。未分配的角色可以在恢复后由管理员补充。'), choices, button('预览恢复方案', async () => {
    preview.replaceChildren();
    const assignments = new Map();
    for (const item of selections.filter(item => item.check.checked)) {
      if (!assignments.has(item.userId)) assignments.set(item.userId, []);
      assignments.get(item.userId).push(item.role);
    }
    const options = {operationId: crypto.randomUUID(), projectName: name.value, archiveSha256: report.archiveSha256, expectedRevision: report.targetRevision, memberships: [...assignments].map(([userId, roles]) => ({userId, roles}))};
    const plan = await restoreArchiveRequest('project-restore-preview', file, options);
    showRestorePlan(preview, plan);
    const acknowledgement = input('我已核对资料来源和恢复方案', 'checkbox');
    const confirm = button('确认恢复到 ' + plan.projectName, async () => {
      if (!acknowledgement.checked) throw Error('请先核对并确认恢复方案');
      await submitProjectRestore(file, {filename: file.name, plan, options: {...options, planFingerprint: plan.planFingerprint, confirmed: true}});
    }, 'primary');
    confirm.disabled = true; acknowledgement.onchange = () => { confirm.disabled = !acknowledgement.checked; };
    preview.append(label('我已核对资料来源和恢复方案', acknowledgement), confirm);
    say('请核对目标项目、成员安排和新增内容，再确认恢复。');
  }));
  content.append(panel, preview);
}


async function adminView() {
  const data = await api('admin'); await refresh(); content.replaceChildren(); accountView();
  content.append(node('h1', '应用、成员与项目权限'));
  const grid = node('div', undefined, 'admin-grid');
  const imports = node('section', undefined, 'panel stack'); imports.append(node('h2', '导入应用'));
  imports.append(node('p', '在设计工作台导出整个应用，将 JSON 文件导入这里。重复编号会被拒绝，请保留原应用版本。', 'muted'));
  const file = input('导入应用包', 'file'); file.accept = '.json';
  file.onchange = () => task(async () => { const selected = file.files[0]; if (!selected) return; if (selected.size > 24 * 1024 * 1024) throw Error('应用包最多 24 MB'); await api('import', JSON.parse(await selected.text())); await adminView(); say('应用已导入，请分配项目角色。'); }); imports.append(file);
  const updateFile = input('选择表式更新包', 'file'); updateFile.accept = '.json';
  imports.append(node('h3', '发布已有应用的新表式'), node('p', '使用设计工作台导出的应用包。变更模板需提高版本，新规则用于新建业务，已有业务保留原快照。包中的业务记录不会替换服务器记录。', 'muted'), updateFile, button('确认发布表式更新', async () => {
    const selected = updateFile.files[0]; if (!selected) throw Error('请选择应用更新包');
    if (selected.size > 24 * 1024 * 1024) throw Error('应用包最多 24 MB');
    const result = await api('definitions', JSON.parse(await selected.text()));
    await adminView(); say('表式已发布，保留 ' + result.preservedRecords + ' 份已有业务。请核对新增角色的授权。');
  }));
  const users = node('section', undefined, 'panel stack'); users.append(node('h2', '创建成员账号'));
  const username = input('新账号'), name = input('显示名'), password = input('初始密码', 'password'); password.minLength = 12;
  const isAdmin = input('系统管理员', 'checkbox');
  users.append(label('账号', username), label('显示名', name), label('初始密码，至少 12 位', password), label('系统管理员', isAdmin), button('创建账号', async () => { await api('users', {username: username.value, name: name.value, password: password.value, admin: isAdmin.checked}); await adminView(); say('账号已创建，请分配项目角色。'); }, 'primary'));
  const permissions = node('section', undefined, 'panel stack'); permissions.append(node('h2', '项目角色授权'));
  const member = select('授权成员', data.users.map(item => [item.id, item.name + ' · ' + item.username]));
  const project = select('授权项目', workspace.projects.map(item => [item.id, item.name]));
  const checkboxes = node('div', undefined, 'stack');
  function showRoles() {
    checkboxes.replaceChildren(); const selected = workspace.projects.find(item => item.id === project.value); if (!selected) return;
    const available = roleOptions[selected.id] ?? projectRoles(workspace, selected.id);
    const saved = data.memberships.find(item => item.userId === member.value && item.projectId === project.value)?.roles ?? [];
    for (const role of available) { const check = input(role, 'checkbox'); check.value = role; check.checked = saved.includes(role); const row = label(role, check); row.className = 'check'; checkboxes.append(row); }
  }
  member.onchange = showRoles; project.onchange = showRoles; showRoles();
  permissions.append(label('成员', member), label('项目', project), checkboxes, button('保存项目权限', async () => { await api('membership', {userId: member.value, projectId: project.value, roles: Array.from(checkboxes.querySelectorAll('input:checked')).map(item => item.value)}); await adminView(); say('项目权限已更新。取消全部角色会撤销项目访问。'); }, 'primary'));
  grid.append(imports, users, permissions); content.append(grid, node('h2', '最近审计记录'));
  const memberList = node('section', undefined, 'panel'); memberList.append(node('h2', '账号状态'));
  for (const member of data.users) {
    const row = node('div', undefined, 'toolbar');
    row.append(node('p', member.name + ' · ' + member.username + (member.disabled ? ' · 已停用' : ' · 正常')));
    if (member.id !== user.id) row.append(button(member.disabled ? '启用 ' + member.username : '停用 ' + member.username, async () => {
      await api('user-status', {userId: member.id, disabled: !member.disabled}); await adminView(); say('账号状态已更新，该账号原有会话已失效。');
    }));
    memberList.append(row);
  }
  content.append(memberList);
  const audit = node('details', undefined, 'panel'); audit.append(node('summary', '展开最近 ' + data.audit.length + ' 条记录'));
  for (const event of data.audit) audit.append(node('p', event.at + ' · ' + (data.users.find(item => item.id === event.user_id)?.name || event.user_id) + ' · ' + event.action + ' · ' + event.target));
  content.append(button('下载最近审计记录', () => download('FlowLens-审计记录.json', JSON.stringify(data.audit, null, 2))), audit);
}
try { user = (await api('me')).user; await refresh(); home(); say('服务器工作区已就绪。'); }
catch (error) { loginView(); say(error.status === 401 ? '请登录团队账号。' : error.message, error.status !== 401); }
