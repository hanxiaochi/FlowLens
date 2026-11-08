import {runApplicationScenario, applicationScenarioText} from './apps-scenarios.mjs';
import {scenarioSampleValues} from './forms-acceptance.mjs';
import {renderDetailField} from './forms-detail-ui.js';
import {applicationDelivery} from './apps-delivery.js';
import {summarizeRecord} from './forms-model.mjs';
import {saveRequirement, confirmRequirement, requirementDefinition, requirementStatus, requirementStatusLabels, requirementTarget, requirementsText, requirementDefinitionText, recordRequirementObservation, observationFields, observationStatus, observationStatusLabels, observationText, runRequirementScenario, scenarioRunStatus, scenarioStatusLabels, scenarioRunText} from './apps-requirements.mjs';
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
  controls.append(button('需求依据与确认', reviewRequirements));
  controls.append(button('运行跨表样例', applicationScenario));
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

  function applicationScenario() {
    const dialog = modal('跨表样例场景');
    dialog.append(element('p', '使用当前应用定义，在独立的虚构项目中发起和办理每条关联路径，核对资料带入、上游完成要求、跨项目引用和重复发起。结果可下载，关闭窗口前请保存。服务端账号、数据库权限与真实业务解释仍需实际验收。'),
      button('运行跨表检查', () => {
        const report = runApplicationScenario(workspace, app.id);
        const result = modal(report.passed ? '跨表场景通过' : '跨表场景有失败项');
        result.append(element('p', `${report.results.filter(item => item.passed).length} / ${report.results.length} 项通过 · ${report.records.length} 张虚构单据`),
          button('下载跨表场景 JSON', () => download('FlowLens-跨表场景.json', JSON.stringify(report, null, 2))),
          button('下载跨表场景文本', () => download('FlowLens-跨表场景.txt', applicationScenarioText(report), 'text/plain;charset=utf-8')),
          element('pre', applicationScenarioText(report)));
        dialog.close();
      }, 'primary'));
  }

  function protectDraft(dialog, inputs) {
    const initial = inputs.map(input => input.value);
    const dirty = () => inputs.some((input, index) => input.value !== initial[index]);
    const beforeUnload = event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    const close = () => { if (!dirty() || window.confirm('内容尚未保存，确定关闭并放弃本次修改？')) dialog.close(); };
    dialog.querySelector('button').onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => window.removeEventListener('beforeunload', beforeUnload));
  }

  function reviewRequirements() {
    const list = modal('需求依据与确认');
    list.append(element('p', '将材料原文与表式、字段或办理动作关联。确认人及依据由记录者填写，团队发布操作沿用账号审计。表式版本、业务定义、关联映射或需求文字改变后，已有确认显示需重新确认。记录随应用共享。'));
    list.append(button('添加需求依据', () => editRequirement()), button('下载依据与历史', () => download('FlowLens-需求依据.txt', requirementsText(app, templates), 'text/plain;charset=utf-8')));
    for (const entry of app.requirements ?? []) {
      const status = requirementStatus(app, templates, entry);
      const target = requirementTarget(app, templates, entry.target);
      const card = element('section', undefined, 'requirement-entry');
      card.append(element('h3', entry.statement), element('p', requirementStatusLabels[status] + ' · ' + (entry.origin === 'ai' ? 'AI 建议' : '人工录入')),
        element('p', target ? `${target.template.title} / ${target.item.label ?? target.item.title}` : '原关联对象已移除，请重新选择'), element('pre', entry.source));
      card.append(button('编辑依据', () => editRequirement(entry)));
      if (target) card.append(button('查看表式与规则', () => { list.close(); onOpen('templates', target.template.id); }), button('记录业务确认', () => recordReview(entry)));
      if (target) card.append(button('运行样例场景', () => scenarioPreview(entry)), button('用自己的数据试规则', () => customScenario(entry)), button('记录现场观察', () => recordObservation(entry)));
      for (const review of [...entry.reviews].reverse()) {
        const history = element('details');
        history.append(element('summary', `${new Date(review.at).toLocaleString('zh-CN', {hour12: false})} · ${review.reviewer}`), element('p', review.evidence), definitionView(review.definition));
        card.append(history);
      }
      for (const run of [...(entry.runs ?? [])].reverse()) {
        const history = element('details');
        history.append(element('summary', `${new Date(run.at).toLocaleString('zh-CN', {hour12: false})} · ${scenarioStatusLabels[scenarioRunStatus(app, templates, entry, run)]}`),
          element('p', `${run.report.results.filter(result => result.passed).length} / ${run.report.results.length} 项通过。${run.report.scope}。`),
          element('pre', scenarioRunText(run)), button('下载这次场景记录', () => download('FlowLens-场景运行.json', JSON.stringify(run, null, 2))));
        card.append(history);
      }
      for (const observation of [...(entry.observations ?? [])].reverse()) {
        const history = element('details');
        history.append(element('summary', `${new Date(observation.at).toLocaleString('zh-CN', {hour12: false})} · ${observationStatusLabels[observationStatus(app, templates, entry, observation)]}`),
          element('pre', observationText(observation)), definitionView(observation.definition),
          button('下载这次现场观察', () => download('FlowLens-现场观察.json', JSON.stringify(observation, null, 2))));
        card.append(history);
      }
      list.append(card);
    }
    if (!app.requirements?.length) list.append(element('p', '还没有需求依据。先选一个字段或办理动作，写下客户的原话和材料出处。'));

    function recordObservation(entry) {
      const dialog = modal('记录现场观察');
      const expectedDefinition = requirementDefinition(app, templates, entry.id);
      dialog.append(element('p', entry.statement), element('p', '记录实际使用的环境、操作和结果。观察人及结论由记录者填写，记录随应用共享。保存后保留历史，补充或纠正请追加记录。'));
      const inputs = new Map();
      for (const [key, label, limit] of observationFields) {
        const input = element('textarea'); input.rows = key === 'steps' || key === 'actual' ? 4 : 2; input.maxLength = limit;
        inputs.set(key, input); dialog.append(field(label, input));
      }
      const outcome = choice([['blocked', '待验证'], ['passed', '符合预期'], ['failed', '发现问题']], 'blocked');
      const values = () => ({...Object.fromEntries([...inputs].map(([key, input]) => [key, input.value])), outcome: outcome.value, expectedDefinition});
      dialog.append(field('观察结论', outcome), element('p', '发现问题或待验证时，请填写待解决事项与跟进人。'),
        button('下载现场观察草稿', () => download('FlowLens-现场观察草稿.json', JSON.stringify({requirementId: entry.id, ...values()}, null, 2))),
        button('保存现场观察', async () => {
          await mutate(next => {
            const index = next.applications.findIndex(item => item.id === app.id);
            if (index < 0) throw Error('应用已不存在，请下载草稿');
            next.applications[index] = recordRequirementObservation(next.applications[index], next.templates, entry.id, values());
          });
          dialog.close(); list.close(); say('现场观察已保存，可在需求依据中查看。');
        }, 'primary'));
      protectDraft(dialog, [...inputs.values(), outcome]);
    }

    function customScenario(entry) {
      const dialog = modal('用自己的数据试规则');
      const template = requirementTarget(app, templates, entry.target).template;
      const expectedDefinition = requirementDefinition(app, templates, entry.id);
      const defaults = scenarioSampleValues(template);
      const inputs = new Map();
      dialog.append(element('p', '修改各阶段的样例输入后运行本地规则检查。继续办理检查预期进入下一阶段；输入为空、格式不符或命中退回条件会保留失败项，可展开查看实际结果。错误角色、缺少必填及条件退回检查会另行构造输入。'));
      for (const owner of ['draft', ...template.workflow.map(stage => stage.id)]) {
        dialog.append(element('h3', owner === 'draft' ? '填报' : template.workflow.find(stage => stage.id === owner).label));
        for (const item of template.fields.filter(field => field.owner === owner)) {
          if (item.type === 'table') {
            const host = element('section'); host.append(element('h4', item.label));
            renderDetailField(host, item, defaults[item.id], true);
            inputs.set(item.id, host.querySelector('textarea[data-field]')); dialog.append(host);
            continue;
          }
          let input;
          if (item.type === 'select' || item.type === 'boolean') {
            const options = item.type === 'boolean' ? [['true', '是'], ['false', '否']] : item.options.map(value => [value, value]);
            input = choice([['', '未填写'], ...options], defaults[item.id]);
          } else {
            input = element('textarea'); input.rows = 2; input.maxLength = 20000; input.value = defaults[item.id];
          }
          inputs.set(item.id, input); dialog.append(field(item.label + (item.required ? '（必填）' : ''), input));
        }
      }
      const values = () => Object.fromEntries([...inputs].map(([id, input]) => [id, input.value]));
      dialog.append(button('下载场景输入草稿', () => download('FlowLens-场景输入草稿.json', JSON.stringify({requirementId: entry.id, expectedDefinition, values: values()}, null, 2))),
        button('运行并保存自定义场景', async () => {
          await mutate(next => {
            const index = next.applications.findIndex(item => item.id === app.id);
            if (index < 0) throw Error('应用已不存在，请下载草稿');
            next.applications[index] = runRequirementScenario(next.applications[index], next.templates, entry.id, {expectedDefinition, values: values()});
          });
          dialog.close(); list.close(); say('自定义场景已保存，请展开运行记录核对实际结果。');
        }, 'primary'));
      protectDraft(dialog, [...inputs.values()]);
    }

    function scenarioPreview(entry) {
      const dialog = modal('运行关联表式的样例场景');
      dialog.append(element('p', '使用自动样例值，在独立内存记录中执行缺少必填、错误角色、退回重提、条件退回、继续办理及重复请求。结果随当前需求定义保存，显示每步输入、状态、修订和字段变化。实际业务解释及生产环境权限仍需现场验收。'),
        button('运行并保存场景记录', async () => {
          await mutate(next => {
            const index = next.applications.findIndex(item => item.id === app.id);
            if (index < 0) throw Error('应用已不存在，请重新读取');
            next.applications[index] = runRequirementScenario(next.applications[index], next.templates, entry.id);
          });
          dialog.close(); list.close(); say('场景运行结果已保存，请打开需求依据查看逐项结果。');
        }, 'primary'));
    }

    function editRequirement(entry) {
      const dialog = modal(entry ? '编辑需求依据' : '添加需求依据');
      const options = templates.flatMap(template => [
        [JSON.stringify({templateId: template.id, kind: 'template', id: template.id}), template.title + ' · 整份表式'],
        ...template.fields.map(item => [JSON.stringify({templateId: template.id, kind: 'field', id: item.id}), template.title + ' · 字段 · ' + item.label]),
        ...template.workflow.map(item => [JSON.stringify({templateId: template.id, kind: 'stage', id: item.id}), template.title + ' · 办理 · ' + item.label])
      ]);
      const selected = entry ? JSON.stringify({templateId: entry.target.templateId, kind: entry.target.kind, id: entry.target.id}) : '';
      const target = choice([['', '请选择关联对象'], ...options], selected);
      const statement = element('textarea'); statement.rows = 3; statement.maxLength = 4000; statement.value = entry?.statement ?? '';
      const source = element('textarea'); source.rows = 5; source.maxLength = 8000; source.value = entry?.source ?? '';
      const origin = choice([['manual', '人工录入'], ['ai', 'AI 建议']], entry?.origin ?? 'manual');
      const input = () => ({id: entry?.id, statement: statement.value, source: source.value, origin: origin.value, target: target.value ? JSON.parse(target.value) : null});
      dialog.append(field('关联表式、字段或办理动作', target), field('需求或规则描述', statement), field('材料原文、版本与出处', source), field('记录来源', origin),
        button('下载当前依据草稿', () => download('FlowLens-需求依据草稿.json', JSON.stringify(input(), null, 2))),
        button('保存需求依据', async () => {
          await mutate(next => {
            const index = next.applications.findIndex(item => item.id === app.id);
            if (index < 0) throw Error('应用已不存在，请下载草稿');
            next.applications[index] = saveRequirement(next.applications[index], next.templates, input());
          });
          dialog.close(); list.close(); say('需求依据已保存。');
        }, 'primary'));
      protectDraft(dialog, [target, statement, source, origin]);
    }

    function recordReview(entry) {
      const dialog = modal('记录业务确认');
      const expectedDefinition = requirementDefinition(app, templates, entry.id);
      const reviewer = element('input'); reviewer.maxLength = 200;
      const evidence = element('textarea'); evidence.rows = 4; evidence.maxLength = 4000;
      const snapshot = element('details'); snapshot.append(element('summary', '本次对应的定义'), definitionView(expectedDefinition));
      dialog.append(element('p', entry.statement), element('p', entry.source), field('确认人称呼', reviewer), field('确认依据与结论', evidence), snapshot,
        button('下载当前确认草稿', () => download('FlowLens-确认草稿.json', JSON.stringify({requirementId: entry.id, reviewer: reviewer.value, evidence: evidence.value, expectedDefinition}, null, 2))),
        button('保存本次确认记录', async () => {
          await mutate(next => {
            const index = next.applications.findIndex(item => item.id === app.id);
            if (index < 0) throw Error('应用已不存在，请下载草稿');
            next.applications[index] = confirmRequirement(next.applications[index], next.templates, entry.id, {reviewer: reviewer.value, evidence: evidence.value, expectedDefinition});
          });
          dialog.close(); list.close(); say('确认记录已保存，后续修改将重新核对定义。');
        }, 'primary'));
      protectDraft(dialog, [reviewer, evidence]);
    }
  }

  function definitionView(serialized) {
    const view = element('div');
    const raw = element('details');
    raw.append(element('summary', '完整定义 · 研发核对'), element('pre', serialized));
    view.append(element('pre', requirementDefinitionText(serialized)), raw);
    return view;
  }

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
    const draft = () => ({version: 1, ...Object.fromEntries([...inputs].map(([key, input]) => [key, input.value]))});
    protectDraft(dialog, [...inputs.values()]);
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
