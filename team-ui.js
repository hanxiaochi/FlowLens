import {projectRoles} from './apps-model.mjs';
import {canEdit} from './forms-model.mjs';
import {FIELD_TYPES} from './forms-schema.mjs';
import {renderDetailField} from './forms-detail-ui.js';
import {printableForm} from './forms-print.mjs';
import {deliveryStatusLabels, projectRoleCoverage} from './team-delivery.mjs';
import {teamJsonRequest} from './team-http.mjs';
import {createRecoveryStore} from './team-recovery.mjs';
import {createDraftStore, draftForRecord} from './team-drafts.mjs';

const content = document.querySelector('#content');
const account = document.querySelector('#account');
const notice = document.querySelector('#notice');
let user, workspace, memberships = [], selectedId = '', projectId = '', busy = false, pending = null;
let serviceContext = null;
const recovery = createRecoveryStore();
const drafts = createDraftStore();
let editorSession = null, pendingDraft = null;
let deliveryDraft = null;
let selectedRecord = null, listing = null, roleOptions = {};
let batchReturn = null;
let reviewReturn = null;
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
function acceptSession(result) {
  if (typeof result.context?.instanceId !== 'string' || !result.context.instanceId) throw Error('服务端缺少恢复上下文，请联系管理员更新服务后重新登录。');
  user = result.user; serviceContext = result.context;
}
async function api(path, data) {
  const timeoutMs = ['import', 'definitions', 'definitions-preview', 'definitions-publish', 'csv-preview', 'csv-import'].includes(path) || data?.type === 'attachment' ? 120000 : 30000;
  return teamJsonRequest('/api/team/' + path, {method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-FlowLens-Request': '1', 'X-FlowLens-Client': '3'}, body: data === undefined ? undefined : JSON.stringify(data)}, timeoutMs);
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
window.addEventListener('beforeunload', event => { if (!pending && dirty()) { event.preventDefault(); event.returnValue = ''; } });
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
  controls.append(button('我的项目', async () => { if (!clean()) return; selectedId = ''; await refresh(); home(); }), button('修改密码', () => { if (clean()) passwordView(); }), button('退出登录', async () => { if (!clean()) return; await api('logout', {}); user = null; workspace = null; selectedId = ''; loginView(); say('已退出登录。'); }));
  controls.append(button('下载草稿并重新登录', () => { draft(); user = null; selectedId = ''; pending = null; deliveryDraft = null; loginView(); }));
  controls.append(button('恢复待确认操作', async () => { if (clean()) await recoveryView(); }));
  controls.append(button('本机填写草稿', async () => { if (clean()) await draftsView(); }));
  if (user.admin) controls.append(button('资料包检查', () => { if (clean()) projectCheckView(); }), button('管理后台', async () => { if (clean()) await adminView(); }), button('运行状态', async () => { if (clean()) await operationsView(); }));
  if (user.admin) controls.append(button('交付检查', async () => { if (clean()) await deliveryView(); }));
  if (user.admin && savedProjectRestore()) controls.append(button('继续待确认恢复', () => { if (clean()) restoreRetryView(); }));
  account.append(controls);
}
function loginView() {
  reviewReturn = null;
  batchReturn = null;
  serviceContext = null;
  selectedRecord = null; listing = null; roleOptions = {}; projectId = ''; listQuery = {page: 1, filter: 'all', search: ''};
  account.replaceChildren(); content.replaceChildren();
  const panel = node('div', undefined, 'panel login');
  panel.append(node('span', 'SHARED WORKSPACE', 'badge'), node('h1', '一起把业务办完'), node('p', '使用管理员分配的账号登录。你的项目和办理权限由服务器确认。', 'muted'));
  const username = input('账号'); username.autocomplete = 'username'; username.required = true;
  const password = input('密码', 'password'); password.autocomplete = 'current-password'; password.required = true;
  const form = node('form'); const submit = node('button', '登录', 'primary'); submit.type = 'submit';
  form.append(label('账号', username), label('密码', password), submit);
  form.onsubmit = event => { event.preventDefault(); task(async () => { acceptSession(await api('login', {username: username.value, password: password.value})); say('已登录，选择项目开始办理。'); await enterWorkspace(); }); };
  panel.append(form); content.append(panel);
}
function home() {
  reviewReturn = null;
  batchReturn = null;
  accountView(); content.replaceChildren(); selectedId = '';
  const hero = node('section', undefined, 'hero'); hero.append(node('span', 'PROJECTS, CONNECTED', 'badge'), node('h1', '从待办开始，把一件事办到底。'));
  const retry = button('重试原请求', sendPending); retry.id = 'retry-request'; retry.hidden = !pending; hero.append(retry);
  if (!workspace.projects.length) {
    hero.append(node('p', user.admin ? '先在管理后台导入应用包，再创建账号并分配项目角色。' : '当前账号还没有项目，请联系管理员分配。'));
    if (user.admin) hero.append(button('开始配置应用与成员', adminView, 'primary'));
    content.append(hero); return;
  }
  const projects = select('当前项目', workspace.projects.map(project => [project.id, project.name]), projectId);
  projects.onchange = () => task(async () => {
    try { await refresh({page: 1, filter: 'all', search: ''}, projects.value); home(); }
    finally { projects.value = projectId; }
  });
  hero.append(label('当前项目', projects), node('p', '我的项目角色 · ' + (roles().join('、') || '只读管理查看'), 'muted'));
  hero.append(button('导入批次历史', () => csvHistoryView(projectId)));
  hero.append(button('交付前资料核对', () => projectReviewView(projectId)));
  const project = workspace.projects.find(item => item.id === projectId);
  const app = workspace.applications.find(item => item.id === project.appId);
  hero.append(button('下载项目资料包', () => downloadFromServer('/api/team/project-export?projectId=' + encodeURIComponent(projectId), 'FlowLens-项目资料.zip', 'application/zip')));
  hero.append(button('下载 Excel 台账', () => downloadFromServer('/api/team/project-ledger?projectId=' + encodeURIComponent(projectId), 'FlowLens-项目台账.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')));
  hero.append(node('p', '台账包含全部已保存单据，按历史表式分表，明细单独列出。编号按文本保存；不含附件文件及未保存填写。', 'muted'));
  hero.append(node('p', '项目资料包包含已保存表单、办理历史、附件与文件校验清单，单次最多 64 MiB。解压后打开 index.html。', 'muted'));
  content.append(hero);
  const templates = node('div', undefined, 'cards');
  for (const template of workspace.templates.filter(item => app.templateIds.includes(item.id))) {
    const card = node('article', undefined, 'card'); card.append(node('h3', template.title));
    if (app.relations.some(relation => relation.to === template.id)) card.append(node('p', '从上游已完成单据发起，自动带入资料。'));
    else {
      const create = button('发起 ' + template.title, () => command({type: 'create', projectId, templateId: template.id}), 'primary');
      create.disabled = !roles().includes(template.submitterRole || '填报人'); card.append(create);
      const importCsv = button('从 CSV 导入 ' + template.title, () => csvImportView(template.id));
      importCsv.disabled = create.disabled; card.append(importCsv);
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
    card.append(node('span', record.status === 'complete' ? '已归档' : '待 ' + roleFor(record), 'badge'), node('h3', record.title));
    const summary = node('dl', undefined, 'record-summary');
    for (const field of record.summary ?? []) summary.append(node('dt', field.label), node('dd', field.text));
    card.append(summary, node('p', '单据编号 ' + record.id, 'record-identifier'), node('p', record.link?.label || '项目发起'), button('打开单据', () => openRecord(record.id)));
    list.append(card);
  }
  content.append(list);
  const pagination = node('div', undefined, 'toolbar');
  const previous = button('上一页', async () => { await refresh({...listQuery, page: listing.page - 1}); home(); }); previous.disabled = listing.page <= 1;
  const next = button('下一页', async () => { await refresh({...listQuery, page: listing.page + 1}); home(); }); next.disabled = listing.page >= listing.pages;
  pagination.append(previous, node('span', '第 ' + listing.page + ' / ' + listing.pages + ' 页 · 每页 ' + listing.pageSize + ' 份'), next); content.append(pagination);
}
async function openRecord(id) {
  if (!clean()) return;
  const result = await api('record?recordId=' + encodeURIComponent(id));
  selectedRecord = result.record; selectedId = result.record.id; projectId = result.record.projectId; recordView(); say('已读取服务器单据。');
}
async function command(data) {
  if (pending) throw Error('上一项业务操作的结果尚未确认，请先点击“重试原请求”，或下载草稿并重新读取。');
  const request = {...data, operationId: crypto.randomUUID(), expectedInstanceId: serviceContext.instanceId, expectedUserId: user.id};
  let operationTitle = current()?.title ?? '业务操作';
  if (data.type === 'create') {
    const template = workspace.templates.find(template => template.id === data.templateId);
    if (!template) throw Error('当前表式不可用，请重新读取项目。');
    request.expectedTemplateVersion = template.version;
    operationTitle = template.title;
  }
  const projectName = workspace.projects.find(project => project.id === projectId)?.name;
  const description = projectName ? projectName + ' · ' + operationTitle : operationTitle;
  const draftReference = await draftForRecord(editorSession, data.recordId);
  const entry = await recovery.stage(user.id, serviceContext.instanceId, request, description, draftReference);
  pending = entry.request;
  pendingDraft = entry.draft ?? null;
  await sendPending();
}
function updatePendingControls() {
  const form = content.querySelector('.record-form'); if (form) form.inert = !!pending;
  const note = content.querySelector('#operation-note'); if (note) note.disabled = !!pending;
  const retry = content.querySelector('#retry-request'); if (retry) retry.hidden = !pending;
  const status = content.querySelector('#local-draft-status');
  if (status && pending) {
    status.dataset.pending = 'true';
    status.textContent = '原请求已保存在本机，请按上方提示确认结果或完成清理。';
  } else if (status?.dataset.pending) {
    delete status.dataset.pending;
    status.textContent = '请核对填写内容，修改后可再次保存或提交。';
  }
}
async function sendPending() {
  if (!pending) throw Error('当前没有待确认的业务操作。');
  if (pending.type === 'publish-definitions') return sendDefinitionPending();
  if (pending.type === 'import-csv') return sendCsvPending();
  updatePendingControls();
  let result;
  try {
    result = await api('command', pending);
  } catch (error) {
    if (error.status === 400) {
      try { await recovery.remove(pending.expectedUserId, pending.operationId); pending = null; pendingDraft = null; }
      catch { updatePendingControls(); throw Error('服务器已拒绝该请求，但本机记录清理失败，请从恢复入口处理。'); }
    }
    updatePendingControls();
    if (pending && (!error.status || error.status >= 500)) throw Error('尚未收到业务结果确认。原请求已保存在本机，可重试或刷新后从恢复入口继续。');
    throw error;
  }
  selectedId = result.record.id; selectedRecord = result.record; projectId = result.record.projectId;
  try {
    if (pendingDraft) await drafts.remove(pending.expectedUserId, pendingDraft.draftId, pendingDraft.version);
    await recovery.remove(pending.expectedUserId, pending.operationId);
  }
  catch { recordView(); throw Error('业务已保存，但本机恢复记录清理失败。请重试原请求确认并清理。'); }
  pending = null; pendingDraft = null;
  try { await refresh(); recordView(); say('已保存到服务器。'); }
  catch (error) { recordView(); throw Error('业务已保存，但清单刷新失败。请稍后重新读取。' + error.message); }
}
async function enterWorkspace() {
  await refresh(); home();
  try {
    if ((await recovery.list(user.id)).length) { await recoveryView(); return; }
  }
  catch (error) { say('本机恢复记录无法读取，提交前需解决存储问题。' + error.message, true); return; }
  try {
    const count = (await drafts.list(user.id)).length;
    if (count) say('发现 ' + count + ' 份本机填写草稿，可从“本机填写草稿”核对恢复。');
  } catch (error) { say('本机填写草稿无法读取，请使用下载草稿保留填写内容。' + error.message, true); }
}
async function csvImportView(templateId, previousSource = null) {
  if (!clean()) return;
  const targetProject = previousSource?.projectId ?? projectId;
  selectedId = ''; selectedRecord = null; accountView(); content.replaceChildren();
  content.append(node('h1', '把台账导入为业务草稿'), node('p', '选择 UTF-8 CSV，第一行为列名，每批最多 500 行、200 列、2 MiB。先核对字段映射和数据，再确认创建。每次新确认会创建一批新草稿，请核对是否已经导入过。'));
  const file = input('选择 CSV 台账', 'file'); file.accept = '.csv,text/csv';
  const mappingPanel = node('section', undefined, 'panel stack');
  async function showMapping(source) {
    mappingPanel.replaceChildren();
    let discovery;
    try { discovery = await api('csv-preview', {...source, mapping: undefined}); }
    catch (error) {
      mappingPanel.append(node('p', '台账内容仍保留在当前页面，可重试读取或下载保存。'), button('重试读取台账', () => showMapping(source)), button('下载保留的 CSV', () => download('FlowLens-原台账.csv', source.csv, 'text/csv;charset=utf-8')));
      throw error;
    }
    mappingPanel.append(node('h2', '将台账列对应到填写字段'), node('p', discovery.rowCount + ' 行业务。编号按文字保留；日期使用 YYYY-MM-DD，是或否使用 true / false，明细字段使用 JSON 数组。'));
    const controls = discovery.headers.map((header, index) => {
      const matches = discovery.fields.filter(field => field.label === header);
      let initial = matches.length === 1 ? matches[0].id : '';
      if (source.mapping) initial = discovery.fields.some(field => field.id === source.mapping[index]) ? source.mapping[index] : '';
      const control = select('台账列 ' + header, [['', '忽略此列'], ...discovery.fields.map(field => [field.id, field.label + ' · ' + FIELD_TYPES[field.type || 'text']])], initial);
      mappingPanel.append(label(header, control)); return control;
    });
    const sample = node('details'); sample.append(node('summary', '查看前 10 行原始内容'));
    for (const row of discovery.sample) sample.append(node('p', '第 ' + row.line + ' 行 · ' + row.values.map(value => value.slice(0, 150)).join(' | ')));
    mappingPanel.append(sample, button('预览导入结果', () => csvPreviewView({...source, mapping: controls.map(control => control.value)}), 'primary'));
    say('CSV 已保留，请核对每列对应的填写字段。重新选择文件会替换当前内容。');
  }
  file.onchange = () => task(async () => {
    mappingPanel.replaceChildren();
    const selected = file.files[0]; if (!selected) return;
    if (selected.size > 2 * 1024 * 1024) throw Error('CSV 最大 2 MiB，请拆分后导入');
    let csv;
    try { csv = new TextDecoder('utf-8', {fatal: true}).decode(await selected.arrayBuffer()); }
    catch { throw Error('无法按 UTF-8 读取，请从表格软件另存为 CSV UTF-8。'); }
    await showMapping({csv, projectId: targetProject, templateId});
  });
  content.append(file, mappingPanel, button('返回项目', async () => { await refresh(); home(); }));
  if (previousSource) await showMapping(previousSource);
}

async function csvPreviewView(source) {
  acceptSession(await api('me'));
  const plan = await api('csv-preview', source);
  if (plan.userId !== user.id || plan.instanceId !== serviceContext.instanceId) throw Error('账号或服务环境已变化，请重新预览。');
  content.replaceChildren(node('h1', '核对台账导入'), node('p', '准备导入 ' + plan.rowCount + ' 行。确认后生成业务草稿，缺少必填项可在草稿中补齐后提交，格式错误需先修正。'));
  const invalid = plan.rows.filter(row => row.errors.length).length;
  const duplicates = plan.rows.filter(row => row.duplicateOf !== null).length;
  content.append(node('p', '格式错误 ' + invalid + ' 行 · 与前面填写值相同 ' + duplicates + ' 行。相同行仍会分别创建草稿，请确认是否需要保留。'));
  const filter = select('预览行筛选', [['all', '全部行'], ['errors', '格式错误行'], ['duplicates', '重复填写行']]);
  const rowsPanel = node('section');
  const pager = node('div', undefined, 'toolbar');
  let page = 0;
  function renderRows() {
    const rows = plan.rows.filter(row => filter.value === 'all' || filter.value === 'errors' && row.errors.length || filter.value === 'duplicates' && row.duplicateOf !== null);
    const pages = Math.max(1, Math.ceil(rows.length / 50));
    page = Math.min(page, pages - 1); rowsPanel.replaceChildren(); pager.replaceChildren();
    for (const row of rows.slice(page * 50, (page + 1) * 50)) {
      const card = node('article', undefined, 'panel csv-preview-row'); card.append(node('h2', 'CSV 第 ' + row.line + ' 行'));
      for (const [id, value] of Object.entries(row.values)) card.append(node('p', plan.fields.find(field => field.id === id).label + ' · ' + value.slice(0, 2000)));
      for (const error of row.errors) card.append(node('p', error, 'status-warning'));
      for (const warning of row.warnings) card.append(node('p', warning.field + ' 将覆盖项目带入值 · ' + warning.before + ' → ' + warning.after, 'status-warning'));
      if (row.duplicateOf !== null) card.append(node('p', '与第 ' + row.duplicateOf + ' 行的已映射填写值相同，请核对。', 'status-warning'));
      if (row.missingRequired.length) card.append(node('p', '提交前需补齐 · ' + row.missingRequired.join('、')));
      rowsPanel.append(card);
    }
    if (!rows.length) rowsPanel.append(node('p', '当前筛选下没有数据行。'));
    const previous = button('上一页预览', () => { page--; renderRows(); }); previous.disabled = page === 0;
    const next = button('下一页预览', () => { page++; renderRows(); }); next.disabled = page + 1 === pages;
    pager.append(previous, node('span', '第 ' + (page + 1) + ' / ' + pages + ' 页 · 当前筛选 ' + rows.length + ' 行'), next);
  }
  filter.onchange = () => { page = 0; renderRows(); };
  content.append(label('查看数据行', filter), rowsPanel, pager, node('p', '每页 50 行，每个值最多展示 2000 字符，可下载完整预览核对原值。'));
  renderRows();
  const confirm = button('确认创建这批草稿', async () => {
    if (pending) throw Error('请先处理待确认操作。');
    const request = {type: 'import-csv', projectId: source.projectId, templateId: source.templateId, source, planFingerprint: plan.planFingerprint, operationId: crypto.randomUUID(), expectedUserId: plan.userId, expectedInstanceId: plan.instanceId};
    let entry;
    try { entry = await recovery.stage(plan.userId, plan.instanceId, request, '导入台账 · ' + plan.rowCount + ' 行'); }
    catch (error) { const reason = error.name === 'QuotaExceededError' ? '本机恢复存储空间不足。' : error.message; throw Error(reason + ' 导入请求尚未发送，请下载原 CSV 保留数据。'); }
    pending = entry.request; pendingDraft = null; confirm.disabled = true; await sendPending();
  }, 'primary');
  confirm.disabled = !plan.ready;
  content.append(confirm, button('下载完整导入预览', () => download('FlowLens-导入预览.json', JSON.stringify(plan, null, 2))), button('下载原 CSV', () => download('FlowLens-原台账.csv', source.csv, 'text/csv;charset=utf-8')), button('重新映射字段', () => csvImportView(source.templateId, source)));
  say(plan.ready ? '请核对字段值与项目资料覆盖提示后确认。' : '请修正台账或调整字段映射，再重新预览。', !plan.ready);
}
async function projectReviewView(targetProject, page = 1) {
  const query = new URLSearchParams({projectId: targetProject, page: String(page)});
  const result = await api('project-review?' + query);
  selectedId = ''; selectedRecord = null; batchReturn = null; reviewReturn = null;
  content.replaceChildren(node('h1', '交付前资料核对'));
  content.append(node('p', result.project.name + ' · 工作区修订 ' + result.workspaceRevision + ' · ' + new Date(result.generatedAt).toLocaleString()),
    node('p', result.scope, 'muted'),
    node('p', '共核对 ' + result.totals.records + ' 份单据，' + result.totals.affectedRecords + ' 份有待处理项。待补齐 ' + result.totals.pending + ' 项，需核对 ' + result.totals.review + ' 项，未完成校验 ' + result.totals.unchecked + ' 项。'),
    node('p', '附件引用共 ' + result.totals.attachments + ' 个。本轮最多校验 64 MiB 内容；超出部分明确列为未完成校验。', 'muted'),
    button('返回项目', async () => { await refresh({page: 1}, targetProject); home(); }),
    button('重新核对', () => projectReviewView(targetProject, result.page)),
    button('下载最新核对清单', () => downloadFromServer('/api/team/project-review?' + new URLSearchParams({projectId: targetProject, download: 'html'}), 'FlowLens-资料核对.html', 'text/html;charset=utf-8')),
    node('p', '下载后用浏览器打开，可直接阅读、打印或保存为 PDF。清单记录下载时的最新资料。', 'muted'));
  if (!result.results.length) content.append(node('p', '本轮结构检查未发现待处理项。业务正确性、适用表式和交付签字仍需负责人确认。'));
  const labels = {pending: '待补齐', review: '需核对', unchecked: '未完成校验'};
  for (const record of result.results) {
    const card = node('article', undefined, 'panel');
    card.append(node('h2', record.title), node('p', record.recordId, 'record-identifier'), node('p', record.stage + (record.role ? ' · ' + record.role : '') + ' · 表式版本 ' + record.templateVersion));
    const summary = node('dl', undefined, 'record-summary');
    for (const field of record.summary) summary.append(node('dt', field.label), node('dd', field.text));
    card.append(summary);
    const issues = node('ul');
    for (const issue of record.issues) issues.append(node('li', labels[issue.severity] + ' · ' + issue.label + '：' + issue.message));
    card.append(issues, button('打开单据', async () => { reviewReturn = {projectId: targetProject, page: result.page}; await openRecord(record.recordId); }));
    content.append(card);
  }
  const previous = button('上一页', () => projectReviewView(targetProject, result.page - 1)); previous.disabled = result.page <= 1;
  const next = button('下一页', () => projectReviewView(targetProject, result.page + 1)); next.disabled = result.page >= result.pages;
  const navigation = node('div', undefined, 'toolbar'); navigation.append(previous, node('span', result.page + ' / ' + result.pages), next); content.append(navigation);
  content.scrollIntoView({block: 'start'}); say('已核对服务器保存的资料，检查没有改写业务。');
}
async function csvHistoryView(targetProject, operationId = '', page = 1) {
  reviewReturn = null;
  const query = new URLSearchParams({projectId: targetProject, operationId, page: String(page)});
  const result = await api('csv-history?' + query);
  selectedId = ''; selectedRecord = null; batchReturn = null;
  content.replaceChildren(node('h1', operationId ? '核对本批单据' : '导入批次历史'));
  content.append(button('返回项目', async () => { await refresh({page: 1}, targetProject); home(); }));
  if (operationId) {
    content.append(node('p', '操作编号 ' + operationId), node('p', '本批共 ' + result.total + ' 份。以下为服务器当前状态。'), button('下载本批回执', async () => { const latest = await api('csv-history?' + query); download('FlowLens-导入结果.json', JSON.stringify(latest.receipt, null, 2)); }), button('返回批次清单', () => csvHistoryView(targetProject)));
    const cards = node('div', undefined, 'cards');
    for (const record of result.records) {
      const card = node('article', undefined, 'panel');
      card.append(node('h2', record.title || '当前项目中已无法找到此单据'), node('p', record.id, 'record-identifier'));
      const summary = node('dl', undefined, 'record-summary');
      for (const field of record.summary ?? []) summary.append(node('dt', field.label), node('dd', field.text));
      card.append(summary);
      if (!record.unavailable) card.append(node('p', record.stage), button('打开单据', async () => { batchReturn = {projectId: targetProject, operationId, page: result.page}; await openRecord(record.id); }));
      cards.append(card);
    }
    content.append(cards);
  } else {
    content.append(node('p', '按导入先后排列，共 ' + result.total + ' 批。旧版未保存导入时间，账号名称可能为当前名称。'));
    for (const batch of result.batches) {
      const card = node('article', undefined, 'panel');
      card.append(node('h2', '导入 ' + batch.imported + ' 份 · ' + (workspace.templates.find(item => item.id === batch.templateId)?.title || batch.templateId)), node('p', batch.actor.name + (batch.actorNameHistorical ? ' · 导入时姓名' : ' · 当前账号姓名')), node('p', batch.createdAt ? new Date(batch.createdAt).toLocaleString() : '旧版未记录导入时间'), node('p', batch.operationId, 'record-identifier'), button('核对本批单据', () => csvHistoryView(targetProject, batch.operationId)));
      content.append(card);
    }
  }
  const navigation = node('div', undefined, 'toolbar');
  const previous = button('上一页', () => csvHistoryView(targetProject, operationId, result.page - 1)); previous.disabled = result.page <= 1;
  const next = button('下一页', () => csvHistoryView(targetProject, operationId, result.page + 1)); next.disabled = result.page >= result.pages;
  navigation.append(previous, node('span', result.page + ' / ' + result.pages), next); content.append(navigation);
  content.scrollIntoView({block: 'start'});
  say(operationId ? '已读取本批单据的当前状态。' : '已读取项目导入批次。');
}
function csvResultView(result) {
  content.replaceChildren(node('h1', '台账草稿已创建'), node('p', '已创建 ' + result.imported + ' 份业务草稿，请逐份核对后提交。'), node('p', '操作编号 ' + result.operationId));
  content.append(button('下载本批单据编号', () => download('FlowLens-导入结果.json', JSON.stringify(result, null, 2))));
  if (!pending) content.append(button('核对本批单据', () => csvHistoryView(result.projectId, result.operationId)));
  if (pending) content.append(button('重试原请求', sendPending));
  else content.append(button('查看导入项目', async () => { projectId = result.projectId; await refresh({projectId, page: 1, filter: 'all', search: ''}); home(); }));
}
async function sendCsvPending() {
  let result;
  try {
    const {source, operationId, planFingerprint, expectedUserId, expectedInstanceId} = pending;
    result = await api('csv-import', {source, options: {operationId, planFingerprint, expectedUserId, expectedInstanceId}});
  } catch (error) {
    try { await recoveryView(); }
    catch { content.replaceChildren(node('h1', '台账导入结果待确认'), node('p', '原请求已保存在本机，恢复连接后可继续确认。'), button('重试原请求', sendPending), button('下载原导入请求', () => download('FlowLens-待确认导入.json', JSON.stringify(pending, null, 2)))); }
    if (!error.status || error.status >= 500) throw Error('尚未收到导入结果确认，原请求已保存在本机，请恢复连接后继续确认。');
    throw error;
  }
  try { await recovery.remove(pending.expectedUserId, pending.operationId); }
  catch { csvResultView(result); throw Error('导入已确认，但本机记录清理失败。请重试原请求完成清理。'); }
  pending = null; pendingDraft = null; csvResultView(result); say('这批业务草稿已保存到服务器。');
}
async function definitionPreviewView(incoming, previousEntry = null) {
  if (previousEntry) {
    if (pending && pending.operationId !== previousEntry.operationId) throw Error('请先处理当前待确认操作。');
  } else if (!clean()) return;
  acceptSession(await api('me'));
  if (previousEntry && (previousEntry.userId !== user.id || previousEntry.instanceId !== serviceContext.instanceId)) throw Error('原请求的账号或服务环境已变化，请下载更新包并人工核对。');
  const plan = await api('definitions-preview', incoming);
  if (plan.userId !== user.id || plan.instanceId !== serviceContext.instanceId) throw Error('账号或服务环境已变化，请重新预览。');
  selectedId = ''; selectedRecord = null; accountView(); content.replaceChildren();
  content.append(node('h1', '核对表式发布'), node('p', '该应用已有 ' + plan.preservedRecords + ' 份业务沿用原表式快照。新建业务使用发布后的定义。'));
  content.append(node('p', '涉及应用 · ' + plan.affectedApplications.map(app => app.name).join('、')));
  content.append(node('p', plan.changed ? '以下为更新包与服务器当前定义的差异。' : '当前定义与更新包一致，可以确认当前状态。'));
  if (previousEntry) content.append(node('p', '这份预览按当前服务器状态重新计算。原请求仍保留，操作编号 ' + previousEntry.operationId + '。请先确认原请求的处理结果。', 'status-warning'));
  const collectionNames = {applications: '应用', templates: '表式', projects: '项目'};
  let remaining = 200;
  for (const change of plan.changes.slice(0, 50)) {
    const card = node('section', undefined, 'panel');
    card.append(node('h2', collectionNames[change.collection] + ' · ' + change.title), node('p', change.kind === 'added' ? '新增' : '更新'));
    if (change.afterVersion !== undefined) card.append(node('p', '版本 ' + (change.beforeVersion ?? '无') + ' → ' + change.afterVersion));
    for (const detail of change.details.slice(0, remaining)) {
      const row = node('div', undefined, 'definition-change');
      const before = node('div'), after = node('div');
      before.append(node('p', '当前定义', 'muted'), node('pre', detail.before.slice(0, 2000)));
      after.append(node('p', '更新后', 'muted'), node('pre', detail.after.slice(0, 2000)));
      row.append(node('h3', detail.path), before, after); card.append(row);
    }
    remaining = Math.max(0, remaining - change.details.length);
    if (Object.hasOwn(change, 'layoutBefore')) {
      const comparison = node('details'); comparison.append(node('summary', '展开原表布局对照'));
      let rendered = false;
      comparison.ontoggle = () => {
        if (!comparison.open || rendered) return;
        rendered = true;
        const layouts = node('div', undefined, 'definition-layout');
        for (const [title, template] of [['当前表式', change.layoutBefore], ['更新后表式', incoming.templates.find(item => item.id === change.id)]]) {
          const panel = node('section', undefined, 'record-form'); panel.append(node('h3', title));
          if (template) renderBlocks(panel, template.blocks, {template, values: {}, status: 'complete'}, '', true);
          else panel.append(node('p', '此前没有此表式。'));
          layouts.append(panel);
        }
        comparison.append(node('p', '空白表式预览保留段落、嵌套表格和合并单元格，可滚动查看完整布局。', 'muted'), layouts);
      };
      card.append(comparison);
    }
    content.append(card);
  }
  content.append(node('p', '页面最多显示 50 项定义、200 处属性差异，每个值最多 2000 字符。完整预览和更新包可以下载保存。', 'muted'));
  const actions = node('div', undefined, 'toolbar');
  const publish = button(plan.changed ? '确认发布这些变更' : '确认当前状态', async () => {
    if (pending) throw Error('请先处理待确认操作。');
    if (user.id !== plan.userId || serviceContext.instanceId !== plan.instanceId) throw Error('账号或服务环境已变化，请重新预览。');
    const request = {type: 'publish-definitions', applicationId: plan.applicationId, workspace: incoming, planFingerprint: plan.planFingerprint, operationId: crypto.randomUUID(), expectedUserId: plan.userId, expectedInstanceId: plan.instanceId};
    let entry;
    try { entry = await recovery.stage(plan.userId, plan.instanceId, request, '发布表式 · ' + incoming.applications[0].name); }
    catch (error) {
      const reason = error.name === 'QuotaExceededError' ? '本机恢复存储空间不足。' : error.message;
      throw Error(reason + ' 发布请求尚未发送，可使用“下载更新包”保留文件。');
    }
    pending = entry.request; pendingDraft = null; publish.disabled = true;
    await sendPending();
  }, 'primary');
  publish.disabled = !!previousEntry;
  actions.append(publish, button('下载完整预览', () => download('FlowLens-表式发布预览.json', JSON.stringify(plan, null, 2))), button('下载更新包', () => download('FlowLens-待发布应用.json', JSON.stringify(incoming, null, 2))), button('返回管理后台', async () => { if (clean()) await adminView(); }));
  if (previousEntry) {
    const checked = input('已核对原发布结果', 'checkbox');
    const replace = button('移除旧恢复记录并重新预览', async () => {
      await recovery.remove(previousEntry.userId, previousEntry.operationId);
      if (pending?.operationId === previousEntry.operationId) { pending = null; pendingDraft = null; }
      await definitionPreviewView(incoming);
    }); replace.disabled = true; checked.onchange = () => { replace.disabled = !checked.checked; };
    content.append(label('我已核对原请求处理结果，决定移除旧恢复记录后重新预览', checked), replace);
    actions.append(button('继续确认原请求', async () => { pending = previousEntry.request; pendingDraft = null; await sendPending(); }), button('返回恢复列表', recoveryView));
  }
  content.append(actions); say(previousEntry ? '新预览已生成，原请求保留在恢复列表。' : '预览已完成，请核对变更后发布。');
}
function definitionResultView(result) {
  selectedId = ''; selectedRecord = null; accountView();
  content.replaceChildren(node('h1', '表式发布结果'), node('p', result.updated ? '服务器已发布这份表式更新。' : '服务器已确认当前定义与更新包一致。'), node('p', '发布时保留该应用 ' + result.preservedRecords + ' 份已有业务。'), node('p', '操作编号 ' + result.operationId));
  content.append(node('p', '新增办理角色可在管理后台分配项目权限。', 'muted'));
  if (pending) content.append(button('重试原请求', sendPending));
  else content.append(button('返回管理后台', adminView));
}
async function sendDefinitionPending() {
  let result;
  try {
    const {workspace, operationId, planFingerprint, expectedUserId, expectedInstanceId} = pending;
    result = await api('definitions-publish', {workspace, options: {operationId, planFingerprint, expectedUserId, expectedInstanceId}});
  } catch (error) {
    try { await recoveryView(); }
    catch {
      selectedId = ''; selectedRecord = null; accountView();
      content.replaceChildren(node('h1', '发布结果待确认'), node('p', '原更新包和操作编号已保存在本机。网络恢复或重新登录后，可继续确认。'), button('重试原请求', sendPending), button('下载原发布请求', () => download('FlowLens-待确认发布.json', JSON.stringify(pending, null, 2))));
    }
    if (!error.status || error.status >= 500) throw Error('尚未收到发布结果确认，原更新包和操作编号已保存在本机，请继续确认原请求。');
    throw error;
  }
  try { await recovery.remove(pending.expectedUserId, pending.operationId); }
  catch { definitionResultView(result); throw Error('表式结果已确认，但本机记录清理失败。请重试原请求完成清理。'); }
  pending = null; pendingDraft = null; definitionResultView(result);
  say(result.updated ? '表式更新已发布。' : '当前定义已确认。');
}
async function recoveryView() {
  acceptSession(await api('me'));
  selectedId = ''; selectedRecord = null;
  await refresh();
  const entries = await recovery.list(user.id);
  accountView(); content.replaceChildren();
  content.append(node('h1', '恢复待确认操作'), node('p', '这里保留了当前浏览器中这个账号尚未完成确认的原请求。先核对服务器上的业务，再决定继续确认或移除本机记录。'));
  content.append(button('保留记录并查看项目', async () => {
    acceptSession(await api('me')); pending = null; selectedId = ''; selectedRecord = null;
    await refresh(); home(); say('原请求保留在本机恢复列表，可从“恢复待确认操作”返回。');
  }));
  if (!entries.length) content.append(node('p', '当前没有待确认操作。'));
  const actionNames = {create: '新建单据', save: '保存填写', submit: '提交办理', advance: '办理并继续', return: '退回修改', attachment: '添加附件', 'publish-definitions': '发布表式更新', 'import-csv': '导入台账草稿'};
  for (const entry of entries) {
    const card = node('article', undefined, 'panel');
    card.append(node('h2', entry.description), node('p', new Date(entry.createdAt).toLocaleString() + ' · ' + (actionNames[entry.request.type] ?? entry.request.type)), node('p', '操作编号 ' + entry.operationId));
    const matches = entry.instanceId === serviceContext.instanceId && entry.userId === user.id;
    if (!matches) card.append(node('p', '服务数据环境已变化，请下载原请求并核对当前业务后处理这条本机记录。', 'status-warning'));
    const preview = node('details'); preview.append(node('summary', '查看提交内容摘要'));
    preview.append(node('pre', JSON.stringify({...entry.request, attachment: entry.request.attachment ? {name: entry.request.attachment.name} : undefined}, null, 2).slice(0, 4000)), node('p', '摘要最多显示 4000 字符，完整原请求可下载。'));
    const resume = button('继续确认原请求', async () => {
      if (pending && pending.operationId !== entry.operationId) throw Error('请先处理当前待确认操作。');
      pending = entry.request; pendingDraft = entry.draft ?? null; await sendPending();
    }, 'primary'); resume.disabled = !matches || (entry.request.type === 'publish-definitions' && !user.admin);
    if (entry.request.type === 'import-csv') card.append(button('下载原 CSV', () => download('FlowLens-原台账.csv', entry.request.source.csv, 'text/csv;charset=utf-8')), node('p', '基线冲突时，请先核对服务器业务，再移除这条本机记录并重新上传原 CSV 预览。'));
    const reviewed = input('已核对服务器状态', 'checkbox');
    const remove = button('移除这条本机记录', async () => {
      await recovery.remove(entry.userId, entry.operationId);
      if (pending?.operationId === entry.operationId) pending = null;
      await recoveryView(); say('本机恢复记录已移除。');
    }); remove.disabled = true; reviewed.onchange = () => { remove.disabled = !reviewed.checked; };
    const actions = node('div', undefined, 'toolbar');
    actions.append(resume, button('下载完整原请求', () => download('FlowLens-待确认操作-' + entry.operationId + '.json', JSON.stringify(entry, null, 2))));
    if (entry.request.type === 'publish-definitions' && matches && user.admin) actions.append(button('重新预览原更新包', () => definitionPreviewView(entry.request.workspace, entry)));
    const reviewLabel = label('我已核对服务器状态，确认可以移除本机记录', reviewed); reviewLabel.className = 'check';
    card.append(preview, actions, reviewLabel, remove);
    content.append(card);
  }
  say(entries.length ? '请选择需要继续确认的原请求。' : '本机待确认记录已处理完毕。');
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
function renderBlocks(parent, blocks, record, role, layoutPreview = false) {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const paragraph = node('p', block.text);
      if (layoutPreview && ['center', 'right'].includes(block.align)) paragraph.style.textAlign = block.align;
      parent.append(paragraph);
      const field = record.template.fields.find(item => item.id === block.id);
      if (field) fieldControl(parent, field, record, role);
      continue;
    }
    const table = node('table');
    if (layoutPreview && block.grid.length) {
      const widths = block.grid.map(value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1);
      const largest = widths.reduce((maximum, width) => Math.max(maximum, width), 1);
      const scaled = widths.map(width => width / largest);
      const total = scaled.reduce((sum, width) => sum + width, 0);
      const columns = node('colgroup');
      for (const width of scaled) { const column = node('col'); column.style.width = width / total * 100 + '%'; columns.append(column); }
      table.append(columns); table.style.tableLayout = 'fixed'; table.style.minWidth = widths.length * 110 + 'px';
    }
    for (const row of block.rows) {
      const tr = node('tr');
      for (const cell of row) {
        const td = node('td'); td.colSpan = cell.colspan; td.rowSpan = cell.rowspan;
        const field = record.template.fields.find(item => item.id === cell.id);
        renderBlocks(td, cell.blocks, record, role, layoutPreview);
        if (!cell.blocks.length && cell.text) td.append(node('p', cell.text));
        if (field) fieldControl(td, field, record, role);
        tr.append(td);
      }
      table.append(tr);
    }
    parent.append(table);
  }
}
function recordView(restoredDraft = null) {
  accountView(); content.replaceChildren();
  const record = current(); if (!record) { home(); return; }
  const role = roleFor(record); const editable = roles().includes(role) && record.status !== 'complete';
  const toolbar = node('div', undefined, 'toolbar');
  if (batchReturn) toolbar.append(button('返回导入批次', async () => { if (clean()) await csvHistoryView(batchReturn.projectId, batchReturn.operationId, batchReturn.page); }));
  if (reviewReturn) toolbar.append(button('返回资料核对', async () => { if (clean()) await projectReviewView(reviewReturn.projectId, reviewReturn.page); }));
  toolbar.append(button('返回项目', async () => { if (clean()) { selectedId = ''; await refresh(); home(); } }), button('下载当前草稿', draft), button('下载草稿并重新读取', async () => { draft(); pending = null; await refresh(); recordView(); say('已重新读取服务器版本，请核对已下载草稿中的内容。'); }), button('下载打印版', () => { if (clean()) download('FlowLens-业务打印.html', printableForm(record, {shared: true}), 'text/html'); }));
  content.append(toolbar, node('h1', record.title), node('p', record.project + ' · 修订 ' + record.revision + ' · ' + (record.status === 'complete' ? '已归档' : '当前办理角色 ' + role), 'muted'));
  const layout = node('div', undefined, 'record-layout'); const form = node('article', undefined, 'panel record-form');
  const restoredValues = Object.fromEntries(record.template.fields.filter(field => canEdit(record, field, role) && roles().includes(role) && typeof restoredDraft?.values[field.id] === 'string').map(field => [field.id, restoredDraft.values[field.id]]));
  renderBlocks(form, record.template.blocks, {...record, values: {...record.values, ...restoredValues}}, role);
  const side = node('aside', undefined, 'panel sidebar');
  const actions = node('div', undefined, 'record-actions');
  if (editable) {
    const note = node('textarea'); note.id = 'operation-note'; note.setAttribute('aria-label', '办理意见'); note.placeholder = '退回时请说明原因';
    note.value = restoredDraft?.note ?? '';
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
  editorSession = {
    draftId: crypto.randomUUID(), userId: user.id, instanceId: serviceContext.instanceId,
    recordId: record.id, recordRevision: record.revision,
    version: 0, saved: null, saving: Promise.resolve()
  };
  const draftStatus = node('p', '填写内容会保存在当前浏览器。提交前离开仍会提醒；清除网站数据会删除本机草稿。', 'draft-info');
  draftStatus.id = 'local-draft-status'; draftStatus.setAttribute('role', 'status'); side.prepend(draftStatus);
  const session = editorSession;
  const remember = () => {
    if (pending || !editable || session !== editorSession) return;
    const version = ++session.version;
    const snapshot = {
      userId: session.userId, draftId: session.draftId, instanceId: session.instanceId,
      recordId: record.id, recordRevision: record.revision, version,
      values: values(), note: content.querySelector('#operation-note')?.value ?? '',
      description: record.project + ' · ' + record.title, fields: record.template.fields,
      labels: Object.fromEntries(record.template.fields.map(field => [field.id, field.label]))
    };
    draftStatus.textContent = '正在保存本机草稿…';
    session.saving = drafts.save(snapshot).then(saved => {
      if (!session.saved || saved.version > session.saved.version) session.saved = {draftId: saved.draftId, version: saved.version};
      if (version === session.version) { draftStatus.classList.remove('status-warning'); draftStatus.textContent = '本机草稿已保存 · ' + new Date(saved.updatedAt).toLocaleTimeString() + '。业务尚未提交服务器。'; }
    }).catch(error => {
      if (version === session.version) { draftStatus.textContent = '本机草稿保存失败。' + error.message + ' 请使用“下载当前草稿”。'; draftStatus.classList.add('status-warning'); }
    });
  };
  layout.addEventListener('input', event => { if (event.target.type !== 'file') remember(); });
  layout.addEventListener('change', event => { if (event.target.type !== 'file') remember(); });
  updatePendingControls();
  if (restoredDraft) remember();
}

function draftValue(field, value) {
  const result = node('dd');
  if (field?.type === 'table' && value) {
    try {
      const rows = JSON.parse(value);
      if (!Array.isArray(rows)) throw Error('Invalid table');
      rows.forEach((row, index) => {
        result.append(node('p', '第 ' + (index + 1) + ' 行'));
        for (const column of field.columns) result.append(node('p', column.label + ' · ' + (row[column.id] ?? '')));
      });
      if (!rows.length) result.append(node('p', '尚未填写明细'));
      return result;
    } catch { /* Older drafts can still be downloaded with their original content. */ }
  }
  result.textContent = field?.type === 'boolean' && ['true', 'false'].includes(value) ? (value === 'true' ? '是' : '否') : value;
  return result;
}

async function draftsView() {
  acceptSession(await api('me'));
  selectedId = ''; selectedRecord = null; editorSession = null;
  const entries = await drafts.list(user.id);
  accountView(); content.replaceChildren();
  content.append(node('h1', '本机填写草稿'), node('p', '这里保留当前账号在这个浏览器中填写过的草稿。每个编辑页面单独保存。先查看服务器单据，再决定是否带回填写区。'));
  if (!entries.length) content.append(node('p', '当前没有本机填写草稿。'));
  for (const entry of entries) {
    const card = node('article', undefined, 'panel');
    card.append(node('h2', entry.description), node('p', new Date(entry.updatedAt).toLocaleString() + ' · 原单据修订 ' + entry.recordRevision));
    const preview = node('details'); preview.append(node('summary', '查看填写内容'));
    const fields = node('dl', undefined, 'record-summary');
    for (const [key, value] of Object.entries(entry.values)) fields.append(node('dt', entry.labels?.[key] ?? key), draftValue(entry.fields?.find(field => field.id === key), value));
    fields.append(node('dt', '办理意见'), node('dd', entry.note)); preview.append(fields); card.append(preview);
    const review = button('核对服务器单据', async () => {
      acceptSession(await api('me'));
      if (entry.userId !== user.id || entry.instanceId !== serviceContext.instanceId) throw Error('账号或服务环境已变化，请下载草稿并人工核对。');
      const result = await api('record?recordId=' + encodeURIComponent(entry.recordId));
      selectedRecord = result.record; selectedId = result.record.id; projectId = result.record.projectId;
      await refresh(); recordView();
      const compare = node('section', undefined, 'panel');
      compare.append(node('h2', '核对后带回填写区'), node('p', '草稿来自修订 ' + entry.recordRevision + '，服务器当前修订 ' + current().revision + '。原草稿会保留，新编辑另存一份。'));
      const differences = node('dl', undefined, 'record-summary');
      for (const [key, value] of Object.entries(entry.values)) {
        if (value === (current().values[key] ?? '')) continue;
        const field = current().template.fields.find(field => field.id === key);
        differences.append(node('dt', (entry.labels?.[key] ?? key) + ' · 服务器'), draftValue(field, current().values[key] ?? ''), node('dt', (entry.labels?.[key] ?? key) + ' · 草稿'), draftValue(entry.fields?.find(field => field.id === key) ?? field, value));
      }
      differences.append(node('dt', '草稿办理意见'), node('dd', entry.note));
      const apply = button('将草稿带回填写区', () => {
        if (!clean()) return;
        recordView(entry); say('草稿已带回可编辑字段，请核对后保存或提交。原草稿仍在本机列表。');
      });
      apply.disabled = current().revision !== entry.recordRevision || current().status === 'complete' || !roles().includes(roleFor(current()));
      compare.append(differences, apply, button('下载这份草稿', () => download('FlowLens-本机草稿-' + entry.draftId + '.json', JSON.stringify(entry, null, 2))));
      if (apply.disabled) compare.append(node('p', '单据版本或办理权限已变化，请参考草稿人工核对填写。', 'status-warning'));
      content.prepend(compare);
      say('已读取服务器单据，请核对草稿差异。');
    });
    review.disabled = entry.instanceId !== serviceContext.instanceId;
    const reviewed = input('已核对本机草稿', 'checkbox');
    const remove = button('移除此草稿', async () => {
      if (!await drafts.remove(entry.userId, entry.draftId, entry.version)) throw Error('这份草稿有新的编辑，请重新读取列表后核对。');
      await draftsView();
    }); remove.disabled = true; reviewed.onchange = () => { remove.disabled = !reviewed.checked; };
    card.append(review, button('下载草稿', () => download('FlowLens-本机草稿-' + entry.draftId + '.json', JSON.stringify(entry, null, 2))), label('我已核对，可以移除此草稿', reviewed), remove);
    if (review.disabled) card.append(node('p', '草稿来自其他服务环境，可下载后人工核对。', 'status-warning'));
    content.append(card);
  }
  say('本机草稿仅在当前浏览器保留，下载后可另行备份。');
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


async function adminView(selection = {}) {
  const data = await api('admin'); await refresh(); content.replaceChildren(); accountView();
  content.append(node('h1', '应用、成员与项目权限'));
  const grid = node('div', undefined, 'admin-grid');
  const imports = node('section', undefined, 'panel stack'); imports.append(node('h2', '导入应用'));
  imports.append(node('p', '在设计工作台整理表式和流程、创建项目，再导出整个应用的 JSON 文件。导入后创建成员账号，并按实际职责分配项目角色。重复编号会被拒绝，请保留原应用版本。', 'muted'));
  const file = input('导入应用包', 'file'); file.accept = '.json';
  file.onchange = () => task(async () => { const selected = file.files[0]; if (!selected) return; if (selected.size > 24 * 1024 * 1024) throw Error('应用包最多 24 MB'); await api('import', JSON.parse(await selected.text())); await adminView(); say('应用已导入，请查看项目办理角色检查并补齐配置。'); }); imports.append(file);
  const updateFile = input('选择表式更新包', 'file'); updateFile.accept = '.json';
  imports.append(node('h3', '发布已有应用的新表式'), node('p', '选择设计工作台导出的应用包，先核对差异，再确认发布。新规则用于新建业务，已有业务沿用创建时的表式快照。', 'muted'), updateFile, button('预览表式更新', async () => {
    const selected = updateFile.files[0]; if (!selected) throw Error('请选择应用更新包');
    if (selected.size > 24 * 1024 * 1024) throw Error('应用包最多 24 MB');
    await definitionPreviewView(JSON.parse(await selected.text()));
  }));
  const users = node('section', undefined, 'panel stack'); users.append(node('h2', '创建成员账号'));
  const username = input('新账号'), name = input('显示名'), password = input('初始密码', 'password'); password.minLength = 12;
  const isAdmin = input('系统管理员', 'checkbox');
  users.append(label('账号', username), label('显示名', name), label('初始密码，至少 12 位', password), label('系统管理员', isAdmin), button('创建账号', async () => { await api('users', {username: username.value, name: name.value, password: password.value, admin: isAdmin.checked}); await adminView(); say('账号已创建，请分配项目角色。'); }, 'primary'));
  const permissions = node('section', undefined, 'panel stack'); permissions.append(node('h2', '项目角色授权'));
  const member = select('授权成员', data.users.map(item => [item.id, item.name + ' · ' + item.username + (item.disabled ? ' · 已停用' : '')]), selection.userId);
  const project = select('授权项目', workspace.projects.map(item => [item.id, item.name]), selection.projectId);
  const checkboxes = node('div', undefined, 'stack');
  function showRoles() {
    checkboxes.replaceChildren(); const selected = workspace.projects.find(item => item.id === project.value); if (!selected) return;
    const available = roleOptions[selected.id] ?? projectRoles(workspace, selected.id);
    const saved = data.memberships.find(item => item.userId === member.value && item.projectId === project.value)?.roles ?? [];
    for (const role of available) { const check = input(role, 'checkbox'); check.value = role; check.checked = saved.includes(role); const row = label(role, check); row.className = 'check'; checkboxes.append(row); }
  }
  member.onchange = showRoles; project.onchange = showRoles; showRoles();
  const savePermissions = button('保存项目权限', async () => { await api('membership', {userId: member.value, projectId: project.value, roles: Array.from(checkboxes.querySelectorAll('input:checked')).map(item => item.value)}); await adminView({userId: member.value, projectId: project.value}); say('项目权限已更新。取消全部角色会撤销项目访问。'); }, 'primary');
  savePermissions.disabled = !workspace.projects.length;
  project.disabled = !workspace.projects.length;
  permissions.append(label('成员', member), label('项目', project), checkboxes, savePermissions);
  if (!workspace.projects.length) permissions.append(node('p', '添加项目后即可分配办理角色。', 'muted'));
  const coverage = node('section', undefined, 'panel stack'); coverage.append(node('h2', '项目办理角色检查'));
  coverage.append(node('p', '核对每个角色是否有启用成员承办，包含旧单据仍使用的角色。实际职责请在交付检查中确认。', 'muted'));
  if (!workspace.projects.length) coverage.append(node('p', '先导入包含项目的应用包，再配置办理成员。'));
  for (const app of workspace.applications.filter(app => !workspace.projects.some(project => project.appId === app.id))) {
    coverage.append(node('p', app.name + ' 尚未创建项目。在设计工作台为此应用创建项目后，重新导出应用包，使用“预览表式更新”补入项目。'));
  }
  for (const item of projectRoleCoverage(workspace.projects, roleOptions, data.users, data.memberships)) {
    const section = node('section', undefined, 'stack'); section.append(node('h3', item.name));
    let status = '所有办理角色都有启用成员。';
    if (item.missingRoles.length) status = '待分配 · ' + item.missingRoles.join('、');
    if (!item.roles.length) status = '尚无办理角色，请检查应用表式配置。';
    section.append(node('p', status));
    for (const role of item.roles) section.append(node('p', role.role + ' · ' + (role.members.map(member => member.name).join('、') || '暂无启用成员')));
    const configure = node('button', '配置此项目角色'); configure.type = 'button';
    configure.onclick = () => { project.value = item.projectId; showRoles(); project.focus(); permissions.scrollIntoView({block: 'center'}); };
    section.append(configure);
    coverage.append(section);
  }
  content.append(coverage);
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
async function connectWorkspace() {
  try { acceptSession(await api('me')); say('服务器工作区已就绪。'); await enterWorkspace(); }
  catch (error) {
    loginView();
    if (error.status === 401) say('请登录团队账号。');
    else {
      say('暂时无法读取团队服务，网络恢复后可重试连接。' + error.message, true);
      content.prepend(button('重试连接', connectWorkspace));
    }
  }
}
await connectWorkspace();
