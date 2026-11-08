import {applicationDelivery} from './apps-delivery.js';
import {summarizeRecord} from './forms-model.mjs';
import {createApplication, createProject, startProjectCase, validateRelation, applicationPackage, discoveryFields, discoveryText} from './apps-model.mjs';

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const field = (name, control) => {
  const label = element('label', name);
  control.setAttribute('aria-label', name);
  label.append(control);
  return label;
};
const choice = (items, value = '') => {
  const select = element('select');
  for (const [id, label] of items) select.append(new Option(label, id));
  select.value = value;
  return select;
};

export function renderApplications(host, {workspace, appId, projectId, role, onSelect, onOpen, onRole, mutate, download, say, guard}) {
  host.replaceChildren();
  const apps = workspace.applications ?? [];
  const app = apps.find(item => item.id === appId);
  const projects = (workspace.projects ?? []).filter(item => item.appId === appId);
  const project = projects.find(item => item.id === projectId);
  const templates = app ? workspace.templates.filter(item => app.templateIds.includes(item.id)) : [];
  const records = workspace.cases.filter(item => item.appId === appId && item.projectId === projectId);
  function button(text, action, className) {
    const control = element('button', text, className);
    control.type = 'button';
    control.onclick = async () => {
      if (!guard()) return;
      try { control.disabled=true;await action(); } catch (error) { say(error.message, true);const dialog=control.closest('dialog');if(dialog){let notice=dialog.querySelector('[role=status]');if(!notice){notice=element('p');notice.setAttribute('role','status');dialog.append(notice);}notice.textContent=error.message;} } finally {control.disabled=false;}
    };
    return control;
  }
  function modal(title) {
    const dialog = element('dialog', undefined, 'forms-dialog');
    dialog.append(element('h2', title));
    const close = element('button', '关闭');
    close.onclick = () => dialog.close();
    dialog.append(close);
    dialog.onclose = () => dialog.remove();
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
  }
  const navigation = element('div', undefined, 'application-navigation');
  const appChoice = choice([['', '独立表单工作区'], ...apps.map(item => [item.id, item.name])], appId);
  appChoice.onchange = () => { if (guard()) onSelect(appChoice.value, ''); else appChoice.value = appId; };
  navigation.append(field('当前应用', appChoice), button('＋ 创建应用', () => {
    const dialog = modal('把一套表组织成应用');
    const name = element('input');
    dialog.append(field('应用名称', name));
    const selected = [];
    const list = element('div', undefined, 'application-template-picker');
    for (const template of workspace.templates) {
      const check = element('input'); check.type = 'checkbox';
      selected.push({template, check});
      list.append(field(template.title, check));
    }
    dialog.append(element('p', '先导入 Word，再选择这个应用要使用的模板。'), list, button('创建应用并配置项目', async () => {
      const created = createApplication(name.value, selected.filter(item => item.check.checked).map(item => item.template.id));
      await mutate(next => next.applications.push(created));
      dialog.close(); onSelect(created.id, '');
    }, 'primary'));
  }));
  host.append(navigation);
  if (!app) {
    host.append(element('p', '把导入的表格组成应用，集中管理项目、待办和关联单据。可先点击“体验多表应用样例”。', 'application-hint'));
    return;
  }
  const hero = element('div', undefined, 'application-hero');
  const heading = element('div');
  heading.append(element('span', 'YOUR BUSINESS WORKSPACE', 'eyebrow'), element('h2', app.name), element('p', '选择项目，查看待办，从业务入口开始办理。'));
  const controls = element('div', undefined, 'application-controls');
  controls.append(button('需求工作单', editDiscovery));
  const projectChoice = choice([['', '请选择项目'], ...projects.map(item => [item.id, item.name])], projectId);
  projectChoice.onchange = () => { if (guard()) onSelect(appId, projectChoice.value); else projectChoice.value = projectId; };
  controls.append(field('当前项目', projectChoice), button('＋ 新建项目', () => {
    const dialog = modal('项目资料');
    const name = element('input'), contractor = element('input');
    dialog.append(field('项目名称', name), field('施工单位', contractor), button('保存项目', async () => {
      const created = createProject(app.id, name.value, contractor.value);
      await mutate(next => next.projects.push(created)); dialog.close(); onSelect(app.id, created.id);
    }, 'primary'));
  }), button('配置关联与资料带入', configure), button('导出整个应用', () => download('FlowLens-应用工作包.json', JSON.stringify(applicationPackage(workspace, app.id), null, 2))), button('下载应用交付 ZIP', async () => download('FlowLens-应用交付.zip', await applicationDelivery(workspace, app.id), 'application/zip')));
  hero.append(heading, controls); host.append(hero);
  const roles = [...new Set(templates.flatMap(item => [item.submitterRole || '填报人', ...item.workflow.map(stage => stage.role)]))];
  const roleChoice = choice([['', '全部角色'], ...roles.map(item => [item, item])], role);
  roleChoice.onchange = () => { if (guard()) onRole(roleChoice.value); else roleChoice.value = role; };
  host.append(field('待办角色筛选', roleChoice));
  const entries = element('div', undefined, 'application-entries');
  for (const template of templates) {
    const card = element('article');
    const count = records.filter(item => item.template.id === template.id).length;
    card.append(element('small', template.code), element('h3', template.title), element('p', `${count} 份记录 · ${template.fields.length} 个字段`));
    if (app.relations.some(item => item.to === template.id)) card.append(element('p', '从上游已完成单据发起，自动带入关联资料'));
    else {
      const start = button('发起 ' + template.title, async () => {
        const result = startProjectCase(workspace, {appId, projectId, templateId: template.id});
        await mutate(next => next.cases.unshift(result.record)); onOpen('cases', result.record.id);
      }, 'primary');
      start.disabled = !project; card.append(start);
    }
    card.append(button('配置表式与规则', () => onOpen('templates', template.id)));
    entries.append(card);
  }
  host.append(entries);
  if (!project) { host.append(element('p', '创建或选择项目后，可以发起业务。')); return; }
  const pending = records.filter(item => item.status !== 'complete' && (!role || (item.status === 'draft' ? item.submitter : item.template.workflow[item.step].role) === role));
  const inbox = element('div', undefined, 'application-inbox');
  inbox.append(element('h3', `待办 ${pending.length}`));
  if (!pending.length) inbox.append(element('p', '当前筛选下没有待办'));
  for (const record of pending) inbox.append(button(`${record.title} · ${record.status === 'draft' ? '待填写' : record.template.workflow[record.step].label}`, () => onOpen('cases', record.id)));
  host.append(inbox);
  const journey = element('div', undefined, 'application-journey');
  journey.append(element('h3', '项目业务链'), element('p', '每张单据保留自己的编号、表式与历史。连接显示它从哪份业务发起。'));
  for (const record of [...records].reverse()) {
    const card = element('article');
    const source = records.find(item => item.id === record.relatedId);
    card.append(element('small', source ? `${source.title} → ${record.link?.label ?? '关联'}` : '项目发起'), element('h4', record.title), element('p', `${record.status === 'complete' ? '已完成' : record.status === 'draft' ? '填报中' : record.template.workflow[record.step].label} · 修订 ${record.revision}`));
    const summary = element('dl', undefined, 'forms-record-summary');
    for (const field of summarizeRecord(record)) summary.append(element('dt', field.label), element('dd', field.text));
    card.append(summary, element('p', '单据编号 ' + record.id, 'forms-record-id'), button('打开这份单据', () => onOpen('cases', record.id)));
    for (const relation of app.relations.filter(item => item.from === record.template.id)) {
      const downstream = button(relation.label, async () => {
        const result = startProjectCase(workspace, {appId, projectId, templateId: relation.to, sourceId: record.id, relationId: relation.id});
        if (!result.existing) await mutate(next => next.cases.unshift(result.record));
        onOpen('cases', result.record.id); say(result.existing ? '已打开此前发起的下游单据。' : '已带入上游资料，请核对后填写。');
      });
      downstream.disabled = record.status !== 'complete'; card.append(downstream);
    }
    journey.append(card);
  }
  host.append(journey);

  function editDiscovery() {
    const dialog = modal('需求工作单');
    dialog.append(element('p', '记录现场讨论。每份材料写明名称、版本和位置；尚不清楚的内容留空，导出时显示待确认。工作单随整个应用共享。拟确认人可填写称呼，业务确认结果将在后续规则追踪中记录。'));
    const inputs = new Map();
    for (const [key, label] of discoveryFields) {
      const input = element('textarea');
      input.rows = 3;
      input.maxLength = 8000;
      input.value = app.discovery?.[key] ?? '';
      input.placeholder = '待确认';
      inputs.set(key, input);
      dialog.append(field(label, input));
    }
    const initial = [...inputs.values()].map(input => input.value);
    const dirty = () => [...inputs.values()].some((input, index) => input.value !== initial[index]);
    const draft = () => ({version: 1, ...Object.fromEntries([...inputs].map(([key, input]) => [key, input.value]))});
    const beforeUnload = event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    const close = () => { if (!dirty() || window.confirm('工作单尚未保存，确定关闭并放弃本次修改？')) dialog.close(); };
    dialog.querySelector('button').onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => window.removeEventListener('beforeunload', beforeUnload));
    dialog.append(button('下载当前工作单', () => download('FlowLens-需求工作单.txt', discoveryText({...app, discovery: draft()}), 'text/plain;charset=utf-8')),
      button('保存需求工作单', async () => {
        const value = draft();
        await mutate(next => {
          const target = next.applications.find(item => item.id === app.id);
          if (!target) throw Error('应用已不存在，请先下载当前工作单');
          target.discovery = value;
        });
        dialog.close();
        say('需求工作单已保存，可随应用工作包导出。');
      }, 'primary'));
  }

  function configure() {
    const dialog = modal('关联关系与项目资料');
    const draft = structuredClone(app);
    dialog.append(element('p', '选择上下游模板并逐项确认带入字段。映射只用于新发起的单据，已有来源快照保留。'));
    const bindings = [];
    for (const template of templates) {
      const group = element('details'); group.append(element('summary', template.title + ' · 项目资料'));
      for (const item of template.fields.filter(item => item.owner === 'draft' && (item.type ?? 'text') === 'text')) {
        const control = choice([['', '手动填写'], ['name', '项目名称'], ['contractor', '施工单位']], app.bindings.find(binding => binding.templateId === template.id && binding.fieldId === item.id)?.key ?? '');
        group.append(field(item.label, control)); bindings.push({templateId: template.id, fieldId: item.id, control});
      }
      dialog.append(group);
    }
    const relationshipList = element('div');
    function renderRelations() {
      relationshipList.replaceChildren();
      for (const relation of draft.relations) relationshipList.append(element('p', `${templates.find(item => item.id === relation.from).title} → ${templates.find(item => item.id === relation.to).title} · ${relation.mappings.length} 项带入`), button('移除关系 ' + relation.label, () => { draft.relations = draft.relations.filter(item => item.id !== relation.id); renderRelations(); }));
    }
    renderRelations(); dialog.append(relationshipList);
    const from = choice(templates.map(item => [item.id, item.title]), templates[0]?.id);
    const to = choice(templates.map(item => [item.id, item.title]), templates[1]?.id ?? templates[0]?.id);
    const name = element('input'); name.value = '发起关联单据';
    const mapHost = element('div'); let mappings = [];
    function renderMappings() {
      mapHost.replaceChildren(); mappings = [];
      const source = templates.find(item => item.id === from.value);
      const target = templates.find(item => item.id === to.value);
      for (const targetField of target.fields.filter(item => item.owner === 'draft')) {
        const options = source.fields.filter(item => (item.type ?? 'text') === (targetField.type ?? 'text')).map(item => [item.id, item.label]);
        const control = choice([['', '不带入'], ...options]);
        mappings.push({to: targetField.id, control}); mapHost.append(field('下游 ' + targetField.label, control));
      }
    }
    from.onchange = renderMappings; to.onchange = renderMappings; renderMappings();
    dialog.append(field('上游模板', from), field('下游模板', to), field('操作名称', name), mapHost, button('添加这条关系到草案', () => {
      const relation = {id: crypto.randomUUID(), from: from.value, to: to.value, label: name.value, mappings: mappings.filter(item => item.control.value).map(item => ({from: item.control.value, to: item.to}))};
      if (draft.relations.some(item => item.from === relation.from && item.to === relation.to)) throw Error('这两个模板已有关联，请先移除旧关系再重新配置');
      draft.relations.push(validateRelation(draft, relation, workspace.templates)); renderRelations(); say('关系已加入草案，请确认保存应用配置。');
    }), button('确认保存应用配置', async () => {
      draft.bindings = bindings.filter(item => item.control.value).map(item => ({templateId: item.templateId, fieldId: item.fieldId, key: item.control.value}));
      await mutate(next => { next.applications[next.applications.findIndex(item => item.id === app.id)] = draft; });
      dialog.close(); say('应用配置已保存。');
    }, 'primary'));
  }
}
