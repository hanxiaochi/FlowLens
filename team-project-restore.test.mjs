import {runApplicationScenario, saveApplicationScenario, applicationScenarioStatus} from './apps-scenarios.mjs';
import {saveRequirement} from './apps-requirements.mjs';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {printableForm} from './forms-print.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openTeamStore} from './team-store.mjs';
import {applicationDemo} from './apps-demo.mjs';
import {createCase} from './forms-model.mjs';

const password = 'restore-test-password';
async function setup({legacySubmitter = false, discovery = false} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'flowlens-restore-'));
  const store = openTeamStore(join(directory, 'target.sqlite'));
  const admin = await store.createUser(null, {username: 'admin', name: 'Target admin', password});
  const member = await store.createUser(admin, {username: 'member', name: 'Target member', password});
  const source = openTeamStore(join(directory, 'source.sqlite'));
  const sourceAdmin = await source.createUser(null, {username: 'source', name: 'Source admin', password});
  const app = applicationDemo();
  app.templates[0].summaryFields = ['issue', 'instruction-no'];
  const first = app.cases[0];
  first.status = 'complete'; first.step = first.template.workflow.length;
  first.events[0].actor = {id: member.id, name: 'Source person with matching ID'};
  first.attachments.push({id: 'evidence', name: 'proof.bin', size: 4, data: 'data:application/octet-stream;base64,AP8BgQ=='});
  let previous = first;
  for (const relation of app.applications[0].relations) {
    const template = app.templates.find(item => item.id === relation.to);
    const record = createCase(template, {project: app.projects[0].name, role: template.submitterRole, relatedId: previous.id});
    record.appId = app.applications[0].id; record.projectId = app.projects[0].id;
    record.link = {sourceId: previous.id, sourceRevision: previous.revision, relationId: relation.id, label: relation.label, mappings: relation.mappings};
    record.provenance = []; record.status = 'complete'; record.step = template.workflow.length;
    app.cases.push(record); previous = record;
  }
  const draft = createCase(app.templates[0], {project: app.projects[0].name, role: legacySubmitter ? '历史填报人' : app.templates[0].submitterRole});
  draft.appId = app.applications[0].id; draft.projectId = app.projects[0].id; app.cases.push(draft);
  if (discovery) {
    const template = app.templates[0];
    app.applications[0] = saveRequirement(app.applications[0], app.templates, {statement: '指令后发起整改', source: '虚构恢复验收', origin: 'manual', target: {kind: 'template', templateId: template.id, id: template.id}});
    const requirementId = app.applications[0].requirements[0].id;
    const report = runApplicationScenario(app, app.applications[0].id, [requirementId]);
    app.applications[0] = saveApplicationScenario(app.applications[0], app.templates, report);
  }
  source.importApplication(sourceAdmin, app);
  // Imported source history normally loses actors. Simulate a saved source event for provenance checks.
  const db = new DatabaseSync(join(directory, 'source.sqlite'));
  const row = db.prepare('SELECT data FROM workspace WHERE id=1').get(); const value = JSON.parse(row.data);
  value.cases[0].events[0].actor = {id: member.id, name: 'Source person with matching ID'};
  db.prepare('UPDATE workspace SET data=? WHERE id=1').run(JSON.stringify(value)); db.close();
  const archive = source.projectArchive(sourceAdmin, app.projects[0].id); source.close();
  const checked = store.checkProjectArchive(admin, archive);
  const options = {operationId: crypto.randomUUID(), projectName: '恢复后的青禾项目', archiveSha256: checked.archiveSha256, expectedRevision: checked.targetRevision, memberships: [{userId: member.id, roles: legacySubmitter ? ['专业监理', '历史填报人'] : ['专业监理']}]};
  return {directory, store, admin, member, archive, options, app};
}

test('restoration preserves linked records, marks external actors and continues with current project permissions', async () => {
  const context = await setup(); const {directory, store, admin, member, archive, app} = context;
  try {
    store.importApplication(admin, applicationDemo());
    const before = store.visibleWorkspace(admin, {inlineAttachments: false});
    const options = {...context.options, expectedRevision: before.workspace.storageRevision};
    const plan = store.previewProjectRestore(admin, archive, options);
    assert.equal(plan.newRecords, 4); assert.equal(plan.assignments[0].userId, member.id);
    assert.ok(plan.unassignedRoles.includes('总监'));
    assert.deepEqual(store.visibleWorkspace(admin, {inlineAttachments: false}), before);
    const confirmed = {...options, planFingerprint: plan.planFingerprint, confirmed: true};
    const result = store.restoreProject(admin, archive, confirmed);
    assert.deepEqual(store.restoreProject(admin, archive, confirmed), result);
    const after = store.visibleWorkspace(admin, {inlineAttachments: false}).workspace;
    assert.equal(after.projects.length, 2); assert.equal(after.cases.length, 5);
    assert.deepEqual(after.cases.find(record => record.id === before.workspace.cases[0].id), before.workspace.cases[0]);
    const restored = after.cases.filter(record => record.projectId === result.projectId);
    assert.equal(restored[0].events[0].actor.external, true);
    assert.equal(restored[0].restoration.restoredBy.id, admin.id);
    assert.equal(restored[1].relatedId, restored[0].id);
    assert.equal(restored[1].link.sourceId, restored[0].id);
    assert.equal(restored[2].relatedId, restored[1].id);
    assert.equal(restored[0].provenance[0].sourceId, result.projectId);
    assert.deepEqual(store.attachment(member, restored[0].id, restored[0].attachments[0].id).data, Buffer.from([0, 255, 1, 129]));
    assert.equal(store.visibleWorkspace(member, {inlineAttachments: false}).workspace.projects.length, 1);
    const draft = restored[3];
    assert.equal(restored[0].template.summaryFields, undefined);
    assert.deepEqual(draft.template.summaryFields, ['issue', 'instruction-no']);
    const changed = store.command(member, {type: 'save', recordId: draft.id, expectedRevision: draft.revision, operationId: crypto.randomUUID(), values: {issue: '目标成员继续办理'}}, {inlineAttachments: false});
    assert.equal(changed.record.events.at(-1).actor.id, member.id);
    assert.equal(changed.record.events.at(-1).actor.external, undefined);
    const summary = store.visibleWorkspace(member, {summary: {projectId: result.projectId}}).workspace.cases.find(record => record.id === draft.id).summary;
    assert.deepEqual(summary, [{label: '问题及要求', text: '目标成员继续办理'}]);
    assert.throws(() => store.restoreProject(member, archive, confirmed), /管理员/);
    assert.throws(() => store.restoreProject(admin, archive, {...confirmed, projectName: 'Different'}), /不同请求/);
    assert.ok(result.mappings.cases[app.cases[0].id]);
    await store.backup(join(directory, 'restored-project.sqlite'));
    assert.match(printableForm(restored[0], {shared: true}), /外部历史/);
    const restoredDatabase = join(directory, 'backup-restored.sqlite');
    const restoredCli = spawnSync(process.execPath, [fileURLToPath(new URL('./scripts/team-admin.mjs', import.meta.url)), 'restore', join(directory, 'restored-project.sqlite')], {env: {...process.env, FLOWLENS_DATABASE: restoredDatabase}, encoding: 'utf8', windowsHide: true});
    assert.equal(restoredCli.status, 0, restoredCli.stderr);
    const reopened = openTeamStore(restoredDatabase);
    try {
      const logged = await reopened.login('admin', password);
      assert.equal(reopened.visibleWorkspace(logged.user, {inlineAttachments: false}).workspace.cases.filter(record => record.projectId === result.projectId).length, 4);
      assert.deepEqual(reopened.attachment(logged.user, restored[0].id, restored[0].attachments[0].id).data, Buffer.from([0, 255, 1, 129]));
      assert.deepEqual(reopened.restoreProject(logged.user, archive, confirmed), result);
    } finally { reopened.close(); }

  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('restoration guards changed workspace, changed members, missing confirmation and changed archive', async () => {
  const {directory, store, admin, member, archive, options} = await setup();
  try {
    const plan = store.previewProjectRestore(admin, archive, options);
    assert.throws(() => store.restoreProject(admin, archive, options), /确认/);
    const confirmed = {...options, confirmed: true, planFingerprint: plan.planFingerprint};
    store.setDisabled(admin, {userId: member.id, disabled: true});
    assert.throws(() => store.restoreProject(admin, archive, confirmed), /停用/);
    store.setDisabled(admin, {userId: member.id, disabled: false});
    assert.throws(() => store.restoreProject(admin, archive, {...confirmed, archiveSha256: 'a'.repeat(64)}), /资料包已变化/);
    store.importApplication(admin, applicationDemo());
    assert.throws(() => store.restoreProject(admin, archive, confirmed), /实例已变化/);
    assert.equal(store.visibleWorkspace(admin).workspace.projects.length, 1);
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});

test('late restoration failure rolls back new blobs, membership, workspace, audit and receipt before retry', async () => {
  const {directory, store, admin, archive, options} = await setup();
  try {
    const plan = store.previewProjectRestore(admin, archive, options);
    const confirmed = {...options, confirmed: true, planFingerprint: plan.planFingerprint};
    const before = store.visibleWorkspace(admin, {inlineAttachments: false});
    const db = new DatabaseSync(join(directory, 'target.sqlite'));
    const auditBefore = db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
    db.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT,'restore fixture failure'); END;");
    assert.throws(() => store.restoreProject(admin, archive, confirmed), /restore fixture/);
    assert.deepEqual(store.visibleWorkspace(admin, {inlineAttachments: false}), before);
    for (const table of ['attachment_blobs', 'members', 'requests']) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, auditBefore);
    db.exec('DROP TRIGGER fail_restore');
    assert.equal(store.restoreProject(admin, archive, confirmed).restored, true);
    db.close();
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});


test('restoration and membership editing retain historical submitters that differ from template defaults', async () => {
  const {directory, store, admin, member, archive, options} = await setup({legacySubmitter: true});
  try {
    assert.ok(store.checkProjectArchive(admin, archive).requiredRoles.includes('历史填报人'));
    const plan = store.previewProjectRestore(admin, archive, options);
    const result = store.restoreProject(admin, archive, {...options, confirmed: true, planFingerprint: plan.planFingerprint});
    store.setMembership(admin, {userId: member.id, projectId: result.projectId, roles: ['历史填报人']});
    const draft = store.visibleWorkspace(member, {inlineAttachments: false}).workspace.cases.find(record => record.status === 'draft');
    const saved = store.command(member, {type: 'save', recordId: draft.id, expectedRevision: draft.revision, operationId: crypto.randomUUID(), values: {issue: '旧角色继续办理'}}, {inlineAttachments: false});
    assert.equal(saved.record.events.at(-1).role, '历史填报人');
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});


test('project archive restores cross-form history with source snapshots and requires a new run in the copy', async () => {
  const {directory, store, admin, archive, options, app} = await setup({discovery: true});
  try {
    const plan = store.previewProjectRestore(admin, archive, options);
    const result = store.restoreProject(admin, archive, {...options, planFingerprint: plan.planFingerprint, confirmed: true});
    const workspace = store.visibleWorkspace(admin, {inlineAttachments: false}).workspace;
    const project = workspace.projects.find(item => item.id === result.projectId);
    const restored = workspace.applications.find(item => item.id === project.appId);
    assert.ok(restored);
    const original = app.applications[0];
    assert.deepEqual(restored.scenarioRuns, original.scenarioRuns);
    assert.notEqual(restored.id, original.id);
    assert.equal(restored.requirements[0].target.templateId, restored.templateIds[0]);
    assert.equal(applicationScenarioStatus(restored, workspace.templates, restored.scenarioRuns[0]), 'changed');
    assert.equal(restored.scenarioRuns[0].report.application.id, original.id);
    const saved = saveApplicationScenario(restored, workspace.templates, runApplicationScenario(workspace, restored.id, [restored.requirements[0].id]));
    assert.equal(applicationScenarioStatus(saved, workspace.templates, saved.scenarioRuns[1]), 'passed');
    const backupPath = join(directory, 'history-backup.sqlite');
    await store.backup(backupPath);
    const backup = openTeamStore(backupPath);
    try {
      const login = await backup.login('admin', password);
      assert.deepEqual(backup.visibleWorkspace(login.user).workspace.applications[0].scenarioRuns, original.scenarioRuns);
    } finally { backup.close(); }
  } finally { store.close(); await rm(directory, {recursive: true, force: true}); }
});
