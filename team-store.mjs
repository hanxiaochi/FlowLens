import {definitionDetails} from './team-definition-diff.mjs';
import {parseCsv, prepareCsvImport} from './team-csv-import.mjs';
import {summarizeWorkspace} from './team-read-model.mjs';
import {prepareProjectRestore} from './team-project-restore.mjs';
import {checkProjectArchive, inspectProjectArchive} from './team-project-check.mjs';
import {buildProjectArchive} from './team-project-export.mjs';
import {buildProjectLedger} from './team-ledger-export.mjs';
import {reviewProject} from './team-project-review.mjs';
import {DatabaseSync, backup} from 'node:sqlite';
import {randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync, statSync, statfsSync, createReadStream, chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {emptyWorkspace, upgradeWorkspace} from './forms-store.mjs';
import {startProjectCase, projectRoles} from './apps-model.mjs';
import {applyOperation, attachFile, summarizeRecord} from './forms-model.mjs';
import {deliveryChecks} from './team-delivery.mjs';
import {decodeAttachment, storeRecordAttachments, hydrateRecordAttachments, validateAttachmentSnapshot, migrateAttachments} from './team-attachments.mjs';

const scrypt = promisify(derive);
export const digest = value => createHash('sha256').update(value).digest('hex');
export function fail(status, message) { throw Object.assign(Error(message), {status}); }
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) fail(400, '密码需为 12–256 个字符');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
async function passwordMatches(password, hash) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, encoded] = hash.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(encoded, 'hex'));
}
const publicUser = row => ({id: row.id, username: row.username, name: row.name, admin: !!row.admin, disabled: !!row.disabled});

export function openTeamStore(filename) {
  mkdirSync(dirname(filename), {recursive: true, mode: 0o700});
  const db = new DatabaseSync(filename);
  if (db.prepare('PRAGMA user_version').get().user_version > 2) { db.close(); throw Error('数据库版本高于当前程序，请使用匹配版本'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members (user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL, roles TEXT NOT NULL, PRIMARY KEY(user_id, project_id));
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS maintenance (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS delivery_checks (scope TEXT NOT NULL, check_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(scope,check_id));
    CREATE TABLE IF NOT EXISTS delivery_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, check_id TEXT NOT NULL, data TEXT NOT NULL);
    `);
  db.prepare('INSERT OR IGNORE INTO workspace VALUES (1,0,?)').run(JSON.stringify(emptyWorkspace()));
  try { migrateAttachments(db, filename); }
  catch (error) { db.close(); throw error; }
  db.prepare('INSERT OR IGNORE INTO maintenance(key,data) VALUES(?,?)').run('instance', JSON.stringify({id: randomUUID()}));
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function audit(user, action, target) {
    db.prepare('INSERT INTO audit(at,user_id,action,target) VALUES(?,?,?,?)').run(new Date().toISOString(), user.id, action, target);
  }
  function workspace() {
    const row = db.prepare('SELECT * FROM workspace WHERE id=1').get();
    return {...JSON.parse(row.data), storageRevision: row.revision};
  }
  function writeWorkspace(value) {
    for (const record of value.cases) storeRecordAttachments(db, record);
    // Each writer owns a freshly parsed workspace inside its transaction.
    const next = upgradeWorkspace(value, {allowAttachmentReferences: true, copy: false});
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) fail(413, '当前实例工作区已超过 32 MB 容量，请联系管理员归档并规划独立实例');
    db.prepare('UPDATE workspace SET data=?,revision=revision+1 WHERE id=1').run(serialized);
  }
  function active(user) {
    const row = db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(user.id);
    if (!row) fail(401, '账号已停用，请联系管理员');
    return row;
  }
  function admin(user) { if (!active(user).admin) fail(403, '需要管理员权限'); }
  function inlineRecords(records) {
    const bytes = records.reduce((total, record) => total + record.attachments.reduce((sum, file) => sum + file.size, 0), 0);
    if (bytes >= 24 * 1024 * 1024) fail(409, '附件已超过旧客户端的内嵌容量，请保存草稿并刷新到新版客户端');
    for (const record of records) hydrateRecordAttachments(db, record);
  }
  function deliveryContext(scope, origin) {
    if (scope === 'instance') return {kind: 'instance', name: '当前部署实例', fingerprint: digest(origin)};
    if (typeof scope !== 'string' || !scope.startsWith('project:')) fail(400, '交付检查范围无效');
    const current = workspace();
    const project = current.projects.find(item => 'project:' + item.id === scope);
    if (!project) fail(404, '项目不存在');
    const app = current.applications.find(item => item.id === project.appId);
    const templates = current.templates.filter(item => app.templateIds.includes(item.id)).sort((a, b) => a.id.localeCompare(b.id));
    const members = db.prepare('SELECT members.user_id,roles,users.disabled FROM members JOIN users ON members.user_id=users.id WHERE project_id=? ORDER BY members.user_id').all(project.id);
    return {kind: 'project', name: project.name, fingerprint: digest(JSON.stringify({project, app, templates, members}))};
  }
  function restoreMarker() { return db.prepare("SELECT data FROM maintenance WHERE key='lastRestore'").get()?.data ?? null; }
  function serviceContext(user) {
    active(user);
    return {instanceId: JSON.parse(db.prepare("SELECT data FROM maintenance WHERE key='instance'").get().data).id};
  }
  function deliveryReport(user, scope = 'instance', origin = '') {
    admin(user);
    const context = deliveryContext(scope, origin);
    const saved = db.prepare('SELECT check_id,data FROM delivery_checks WHERE scope=?').all(scope);
    const marker = restoreMarker();
    return {
      scope, scopeName: context.name, contextFingerprint: context.fingerprint, restoreMarker: marker, generatedAt: new Date().toISOString(),
      checks: deliveryChecks[context.kind].map(definition => {
        const data = saved.find(item => item.check_id === definition.id)?.data;
        const record = data ? JSON.parse(data) : {revision: 0, status: 'pending', reviewer: '', evidence: '', actor: null, updatedAt: null};
        const changed = record.revision > 0 && (record.contextFingerprint !== context.fingerprint || record.restoreMarker !== marker);
        return {...definition, ...record, effectiveStatus: changed && record.status === 'passed' ? 'needs-review' : record.status};
      }),
      history: db.prepare('SELECT data FROM delivery_history WHERE scope=? ORDER BY sequence DESC LIMIT 200').all(scope).map(row => JSON.parse(row.data))
    };
  }
  function updateDelivery(user, input, origin = '') {
    const actor = active(user); admin(user);
    if (!input || typeof input.operationId !== 'string' || !/^[\w-]{8,100}$/.test(input.operationId)) fail(400, '需要有效操作编号');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail(400, '需要有效修订号');
    if (!['pending', 'passed', 'blocked'].includes(input.status)) fail(400, '检查状态无效');
    if (typeof input.reviewer !== 'string' || input.reviewer.length > 100 || typeof input.evidence !== 'string' || input.evidence.length > 4000) fail(400, '确认人最多 100 字，依据最多 4000 字');
    if (input.status !== 'pending' && (!input.reviewer.trim() || !input.evidence.trim())) fail(400, '请填写确认人和依据');
    const fingerprint = digest('delivery:' + JSON.stringify(input));
    return transaction(() => {
      const context = deliveryContext(input.scope, origin);
      if (!deliveryChecks[context.kind].some(item => item.id === input.checkId)) fail(400, '检查项无效');
      const prior = db.prepare('SELECT * FROM requests WHERE id=?').get(input.operationId);
      if (prior) {
        if (prior.user_id !== user.id || prior.fingerprint !== fingerprint) fail(409, '操作编号已用于不同请求');
        return JSON.parse(prior.result);
      }
      if (input.expectedContextFingerprint !== context.fingerprint || input.expectedRestoreMarker !== restoreMarker()) fail(409, '部署或项目配置已变化，请下载草稿并重新读取后核验');
      const old = db.prepare('SELECT revision FROM delivery_checks WHERE scope=? AND check_id=?').get(input.scope, input.checkId);
      if ((old?.revision ?? 0) !== input.expectedRevision) fail(409, '检查记录已被其他人更新，请下载草稿并重新读取');
      const record = {checkId: input.checkId, revision: input.expectedRevision + 1, status: input.status, reviewer: input.reviewer.trim(), evidence: input.evidence.trim(), actor: {id: actor.id, name: actor.name}, updatedAt: new Date().toISOString(), contextFingerprint: context.fingerprint, restoreMarker: restoreMarker()};
      const serialized = JSON.stringify(record);
      db.prepare('INSERT INTO delivery_checks VALUES(?,?,?,?) ON CONFLICT(scope,check_id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(input.scope, input.checkId, record.revision, serialized);
      db.prepare('INSERT INTO delivery_history(scope,check_id,data) VALUES(?,?,?)').run(input.scope, input.checkId, serialized);
      audit(user, 'delivery.update', input.scope + '/' + input.checkId);
      const result = {record};
      db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(input.operationId, user.id, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  function operations(user) {
    admin(user);
    const current = workspace();
    let diskFreeBytes = null;
    try { const disk = statfsSync(dirname(filename)); diskFreeBytes = disk.bavail * disk.bsize; } catch {}
    const maintenance = Object.fromEntries(db.prepare('SELECT key,data FROM maintenance').all().map(row => [row.key, JSON.parse(row.data)]));
    return {
      checkedAt: new Date().toISOString(),
      workspaceBytes: db.prepare('SELECT length(CAST(data AS BLOB)) AS bytes FROM workspace WHERE id=1').get().bytes,
      workspaceLimitBytes: 32 * 1024 * 1024,
      workspaceRevision: current.storageRevision,
      databaseBytes: statSync(filename).size,
      databaseWalBytes: statSync(filename + '-wal', {throwIfNoEntry: false})?.size ?? 0,
      diskFreeBytes,
      projects: current.projects.length,
      records: current.cases.length,
      completedRecords: current.cases.filter(record => record.status === 'complete').length,
      attachmentBytes: current.cases.reduce((total, record) => total + record.attachments.reduce((sum, file) => sum + file.size, 0), 0),
      storedAttachmentBytes: db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM attachment_blobs').get().bytes,
      storedAttachmentCount: db.prepare('SELECT COUNT(*) AS count FROM attachment_blobs').get().count,
      users: db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(disabled=0),0) AS enabled FROM users').get(),
      lastBackup: maintenance.lastBackup ?? null,
      lastRestore: maintenance.lastRestore ?? null,
      lastAttachmentMigration: maintenance.lastAttachmentMigration ?? null
    };
  }
  async function verifiedBackup(destination) {
    await backup(db, destination);
    chmodSync(destination, 0o600);
    const snapshot = new DatabaseSync(destination, {readOnly: true});
    let workspaceRevision;
    try {
      if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('备份完整性检查失败');
      validateAttachmentSnapshot(snapshot, JSON.parse(snapshot.prepare('SELECT data FROM workspace WHERE id=1').get().data), {verifyHashes: true});
      workspaceRevision = snapshot.prepare('SELECT revision FROM workspace WHERE id=1').get().revision;
    } finally { snapshot.close(); }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(destination)) hash.update(chunk);
    const result = {completedAt: new Date().toISOString(), bytes: statSync(destination).size, sha256: hash.digest('hex'), workspaceRevision};
    db.prepare('INSERT INTO maintenance(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run('lastBackup', JSON.stringify(result));
    return result;
  }
  function roles(user, projectId) {
    const row = db.prepare('SELECT roles FROM members WHERE user_id=? AND project_id=?').get(user.id, projectId);
    return row ? JSON.parse(row.roles) : [];
  }
  function authorize(user, projectId, role) {
    active(user);
    if (!roles(user, projectId).includes(role)) fail(403, '当前账号未获授权办理该项目的这个角色');
  }
  async function createUser(actor, input) {
    if (actor) admin(actor);
    else if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count) fail(409, '管理员已初始化');
    if (typeof input.username !== 'string' || !/^[a-zA-Z0-9._-]{3,64}$/.test(input.username) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) fail(400, '账号需为 3–64 位字母数字，显示名不能为空');
    const hash = await passwordHash(input.password);
    return transaction(() => {
      if (actor) admin(actor);
      if (!actor && db.prepare('SELECT COUNT(*) AS count FROM users').get().count) fail(409, '管理员已初始化');
      if (db.prepare('SELECT id FROM users WHERE username=?').get(input.username.toLowerCase())) fail(409, '账号已存在');
      const user = {id: randomUUID(), username: input.username.toLowerCase(), name: input.name.trim(), admin: actor ? input.admin === true : true};
      db.prepare('INSERT INTO users(id,username,name,password,admin) VALUES(?,?,?,?,?)').run(user.id, user.username, user.name, hash, Number(user.admin));
      audit(actor ?? user, 'user.create', user.id);
      return user;
    });
  }
  async function login(username, password) {
    const row = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username=?').get(username.toLowerCase()) : undefined;
    // Unknown users still pay the password derivation cost.
    const hash = row?.password ?? '00000000000000000000000000000000:' + '00'.repeat(64);
    const valid = await passwordMatches(password, hash);
    if (!valid || !row || row.disabled) fail(401, '账号或密码不正确');
    const token = randomBytes(32).toString('hex');
    transaction(() => {
      if (active(row).password !== row.password) fail(401, '密码已更新，请重新登录');
      db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), row.id, Date.now() + 8 * 3600 * 1000);
      audit(row, 'session.login', row.id);
    });
    return {token, user: publicUser(row)};
  }
  function session(token) {
    if (!token) fail(401, '请先登录');
    const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.disabled=0').get(digest(token), Date.now());
    if (!row) fail(401, '登录已过期，请重新登录');
    return publicUser(row);
  }
  function visibleWorkspace(user, {inlineAttachments = true, summary} = {}) {
    active(user);
    const value = workspace();
    const memberships = db.prepare('SELECT project_id,roles FROM members WHERE user_id=?').all(user.id).map(row => ({projectId: row.project_id, roles: JSON.parse(row.roles)}));
    if (!user.admin) {
      const projectIds = new Set(memberships.map(item => item.projectId));
      value.projects = value.projects.filter(item => projectIds.has(item.id));
      const appIds = new Set(value.projects.map(item => item.appId));
      value.applications = value.applications.filter(item => appIds.has(item.id));
      const templateIds = new Set(value.applications.flatMap(item => item.templateIds));
      value.templates = value.templates.filter(item => templateIds.has(item.id));
      value.cases = value.cases.filter(item => projectIds.has(item.projectId));
    }
    if (summary) return summarizeWorkspace(value, memberships, summary);
    if (inlineAttachments) inlineRecords(value.cases);
    return {workspace: value, memberships};
  }
  function getRecord(user, recordId) {
    const actor = active(user);
    const record = workspace().cases.find(item => item.id === recordId);
    if (!record || (!actor.admin && !roles(user, record.projectId).length)) fail(404, '业务不存在或不可访问');
    return {record};
  }
  function attachment(user, recordId, attachmentId) {
    active(user);
    const record = workspace().cases.find(item => item.id === recordId);
    if (!record || (!user.admin && !roles(user, record.projectId).length)) fail(404, '附件不存在或不可访问');
    const file = record.attachments.find(item => item.id === attachmentId);
    if (!file) fail(404, '附件不存在或不可访问');
    const row = db.prepare('SELECT data,size FROM attachment_blobs WHERE id=?').get(file.blobId);
    if (!row || row.size !== file.size || digest(row.data) !== file.blobId) fail(500, '附件内容校验失败');
    return {name: file.name, data: Buffer.from(row.data), size: row.size};
  }
  function projectLedger(user, projectId) {
    db.exec('BEGIN');
    try {
      const actor = active(user);
      if (!actor.admin && !roles(user, projectId).length) fail(404, '项目不存在或不可访问');
      const current = workspace();
      if (!current.projects.some(project => project.id === projectId)) fail(404, '项目不存在或不可访问');
      const result = buildProjectLedger(current, projectId);
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function projectReview(user, {projectId, page = '1', download = '0', severity = 'all', assignee = 'all', search = ''} = {}) {
    const requestedPage = Number(page);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !['0', '1', 'html'].includes(download) || !['all', 'pending', 'review', 'unchecked'].includes(severity) || !['all', 'mine'].includes(assignee) || typeof search !== 'string' || search.length > 200) fail(400, '核对清单分页或筛选参数无效');
    db.exec('BEGIN');
    try {
      const actor = active(user);
      if (!actor.admin && !roles(user, projectId).length) fail(404, '项目不存在或不可访问');
      let inspectedBytes = 0;
      const checked = new Map();
      const report = reviewProject(workspace(), projectId, file => {
        if (typeof file.blobId !== 'string' || !/^[a-f0-9]{64}$/.test(file.blobId)) return 'invalid';
        if (!checked.has(file.blobId)) {
          const metadata = db.prepare('SELECT size, length(data) AS actualSize FROM attachment_blobs WHERE id=?').get(file.blobId);
          let state = 'invalid';
          if (metadata && metadata.size === metadata.actualSize) {
            if (inspectedBytes + metadata.size > 64 * 1024 * 1024) state = 'unchecked';
            else {
              inspectedBytes += metadata.size;
              const row = db.prepare('SELECT data FROM attachment_blobs WHERE id=?').get(file.blobId);
              state = digest(row.data) === file.blobId ? 'verified' : 'invalid';
            }
          }
          checked.set(file.blobId, {state, size: metadata?.size});
        }
        const result = checked.get(file.blobId);
        return result.size === file.size ? result.state : 'invalid';
      });
      report.attachmentVerification = {inspectedBytes, limitBytes: 64 * 1024 * 1024};
      const actorRoles = roles(actor, projectId), needle = search.trim().toLowerCase();
      const matches = report.results.filter(record =>
        (severity === 'all' || record.issues.some(issue => issue.severity === severity)) &&
        (assignee === 'all' || record.status !== 'complete' && actorRoles.includes(record.role)) &&
        (!needle || [record.recordId, record.title, ...record.summary.map(field => field.text)].some(value => String(value).toLowerCase().includes(needle))));
      const pages = Math.max(1, Math.ceil(matches.length / 50));
      const currentPage = Math.min(requestedPage, pages);
      const result = download !== '0' ? report : {...report, results: matches.slice((currentPage - 1) * 50, currentPage * 50), page: currentPage, pages, pageSize: 50, matchedRecords: matches.length, filters: {severity, assignee, search}};
      if (download !== '0' && Buffer.byteLength(JSON.stringify(result)) > 16 * 1024 * 1024) fail(413, '核对清单超过 16 MiB，请分页查看并处理后重试');
      db.exec('COMMIT'); return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function projectArchive(user, projectId) {
    db.exec('BEGIN');
    try {
      const currentUser = active(user);
      if (!currentUser.admin && !roles(user, projectId).length) fail(404, '项目不存在或不可访问');
      const current = workspace();
      if (!current.projects.some(item => item.id === projectId)) fail(404, '项目不存在或不可访问');
      const result = buildProjectArchive(current, projectId, (record, file) => {
        const row = db.prepare('SELECT data,size FROM attachment_blobs WHERE id=?').get(file.blobId);
        if (!row || row.size !== file.size || digest(row.data) !== file.blobId) fail(500, '附件内容校验失败');
        return Buffer.from(row.data);
      });
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function restorePlan(user, bytes, options) {
    admin(user);
    const current = workspace();
    if (options.expectedRevision !== current.storageRevision) fail(409, '当前实例已变化，请重新检查并预览恢复');
    const inspection = inspectProjectArchive(bytes, current);
    const prepared = prepareProjectRestore(inspection, options, user);
    const assignments = options.memberships.map(membership => {
      const member = db.prepare('SELECT id,name,disabled FROM users WHERE id=?').get(membership.userId);
      if (!member || member.disabled) fail(409, '目标成员不存在或已停用，请重新安排');
      return {userId: member.id, name: member.name, roles: membership.roles};
    });
    for (const key of ['projects', 'applications', 'templates', 'cases']) {
      if (prepared.workspace[key].some(item => current[key].some(existing => existing.id === item.id))) fail(409, '此恢复方案的编号已存在，请重新生成操作编号');
      current[key].push(...prepared.workspace[key]);
    }
    upgradeWorkspace(current, {allowAttachmentReferences: true});
    const metadataBytes = Buffer.byteLength(JSON.stringify(current));
    if (metadataBytes > 32 * 1024 * 1024) fail(413, '恢复后工作区元数据超过 32 MiB，请选择独立实例');
    const fingerprint = digest(JSON.stringify({archiveSha256: inspection.report.archiveSha256, operationId: options.operationId, projectName: options.projectName.trim(), expectedRevision: options.expectedRevision, assignments}));
    const assignedRoles = new Set(assignments.flatMap(item => item.roles));
    const plan = {planFingerprint: fingerprint, archiveSha256: inspection.report.archiveSha256, targetRevision: current.storageRevision, projectId: prepared.project.id, projectName: prepared.project.name, newApplications: 1, newTemplates: prepared.workspace.templates.length, newRecords: prepared.workspace.cases.length, attachmentBytes: prepared.workspace.cases.reduce((sum, record) => sum + record.attachments.reduce((total, file) => total + file.size, 0), 0), projectedMetadataBytes: metadataBytes, assignments, unassignedRoles: inspection.report.requiredRoles.filter(role => !assignedRoles.has(role)), mappings: prepared.mappings};
    return {inspection, prepared, current, plan};
  }
  function previewProjectRestore(user, bytes, options) {
    return transaction(() => restorePlan(user, bytes, options).plan);
  }
  function restoreProject(user, bytes, options) {
    admin(user);
    if (options.confirmed !== true || typeof options.planFingerprint !== 'string') fail(400, '请先预览并明确确认恢复方案');
    if (typeof options.operationId !== 'string' || !/^[\w-]{8,100}$/.test(options.operationId)) fail(400, '恢复操作编号无效');
    const fingerprint = digest(JSON.stringify({type: 'project.restore', archive: digest(bytes), options}));
    return transaction(() => {
      admin(user);
      const prior = db.prepare('SELECT * FROM requests WHERE id=?').get(options.operationId);
      if (prior) {
        if (prior.user_id !== user.id || prior.fingerprint !== fingerprint) fail(409, '操作编号已用于不同请求');
        return JSON.parse(prior.result);
      }
      const {inspection, current, plan} = restorePlan(user, bytes, options);
      if (plan.planFingerprint !== options.planFingerprint) fail(409, '恢复方案或成员信息已变化，请重新预览');
      for (const record of inspection.workspace.cases) for (const file of record.attachments) {
        const data = inspection.files.get(file.exportPath);
        const existing = db.prepare('SELECT size,data FROM attachment_blobs WHERE id=?').get(file.blobId);
        if (existing && (existing.size !== file.size || digest(existing.data) !== file.blobId)) fail(500, '现有附件内容校验失败');
        db.prepare('INSERT OR IGNORE INTO attachment_blobs(id,size,data) VALUES(?,?,?)').run(file.blobId, file.size, data);
      }
      writeWorkspace(current);
      for (const member of plan.assignments) db.prepare('INSERT INTO members(user_id,project_id,roles) VALUES(?,?,?)').run(member.userId, plan.projectId, JSON.stringify(member.roles));
      audit(user, 'project.restore', plan.projectId);
      const result = {restored: true, ...plan};
      db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(options.operationId, user.id, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  function importApplication(user, input) {
    admin(user);
    const incoming = upgradeWorkspace(input);
    if (!incoming.applications.length || incoming.cases.some(item => !item.appId)) fail(400, '请导入整个应用包，业务需属于应用和项目');
    for (const record of incoming.cases) {
      delete record.createdBy;
      if (record.restoration) { record.sourceRestoration = record.restoration; delete record.restoration; }
      for (const event of record.events) delete event.actor;
    }
    return transaction(() => {
      const current = workspace();
      for (const key of ['templates', 'applications', 'projects', 'cases']) {
        if (incoming[key].some(item => current[key].some(old => old.id === item.id))) fail(409, '应用包包含已有编号，请使用新应用或恢复到独立实例');
        current[key].push(...incoming[key]);
      }
      writeWorkspace(current);
      audit(user, 'application.import', incoming.applications.map(item => item.id).join(','));
      return {imported: incoming.applications.length};
    });
  }
  function setMembership(user, input) {
    admin(user);
    return transaction(() => {
      const value = workspace();
      const project = value.projects.find(item => item.id === input.projectId);
      if (!project || !db.prepare('SELECT id FROM users WHERE id=?').get(input.userId)) fail(404, '项目或账号不存在');
      const available = new Set(projectRoles(value, project.id));
      if (!Array.isArray(input.roles) || input.roles.length > 30 || input.roles.some(role => !available.has(role))) fail(400, '角色必须来自该项目的表式');
      db.prepare('INSERT INTO members VALUES(?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET roles=excluded.roles').run(input.userId, input.projectId, JSON.stringify([...new Set(input.roles)]));
      if (!input.roles.length) db.prepare('DELETE FROM members WHERE user_id=? AND project_id=?').run(input.userId, input.projectId);
      audit(user, 'membership.update', input.userId + '/' + input.projectId + '/' + input.roles.join(','));
      return {saved: true};
    });
  }
  function applyDefinitions(current, incoming) {
    if (incoming.applications.length !== 1) fail(400, '每次发布一个应用的表式更新');
    const app = incoming.applications[0];
    const index = current.applications.findIndex(item => item.id === app.id);
    if (index < 0) fail(404, '请先导入这个应用');
    if (current.applications[index].templateIds.some(id => !app.templateIds.includes(id))) fail(400, '表式更新需保留应用已有模板');
    for (const template of incoming.templates) {
      const position = current.templates.findIndex(item => item.id === template.id);
      if (position < 0) current.templates.push(template);
      else {
        const old = current.templates[position];
        if (JSON.stringify(old) === JSON.stringify(template)) continue;
        if (template.version <= old.version) fail(409, '变更的模板需提高版本号，请在设计工作台确认后重新导出');
        current.templates[position] = template;
      }
    }
    for (const project of incoming.projects) {
      const old = current.projects.find(item => item.id === project.id);
      if (old && JSON.stringify(old) !== JSON.stringify(project)) fail(409, '已有项目资料发生变化，请核对项目编号');
      if (!old) current.projects.push(project);
    }
    current.applications[index] = app;
    return {updated: true, preservedRecords: current.cases.filter(item => item.appId === app.id).length};
  }
  function definitionFingerprint(current) {
    return digest(JSON.stringify({applications: current.applications, templates: current.templates, projects: current.projects}));
  }
  function definitionPlan(user, current, incoming) {
    const baseline = definitionFingerprint(current);
    const changes = [];
    for (const collection of ['applications', 'templates', 'projects']) {
      for (const next of incoming[collection]) {
        const previous = current[collection].find(item => item.id === next.id);
        if (JSON.stringify(previous) === JSON.stringify(next)) continue;
        const sections = Object.keys({...previous, ...next}).filter(key => JSON.stringify(previous?.[key]) !== JSON.stringify(next[key]));
        const change = {collection, id: next.id, title: next.title ?? next.name, kind: previous ? 'changed' : 'added', beforeVersion: previous?.version, afterVersion: next.version, sections, details: definitionDetails(previous, next, current.templates, [...incoming.templates, ...current.templates.filter(template => !incoming.templates.some(item => item.id === template.id))])};
        if (collection === 'templates' && sections.includes('blocks')) {
          change.layoutBefore = previous ? {title: previous.title, version: previous.version, fields: previous.fields, blocks: previous.blocks} : null;
        }
        changes.push(change);
      }
    }
    const result = applyDefinitions(current, incoming);
    upgradeWorkspace(current, {allowAttachmentReferences: true, copy: false});
    if (Buffer.byteLength(JSON.stringify(current)) > 32 * 1024 * 1024) fail(413, '当前实例工作区已超过 32 MB 容量，请联系管理员归档并规划独立实例');
    const context = serviceContext(user);
    const changedTemplates = new Set(changes.filter(change => change.collection === 'templates').map(change => change.id));
    const affectedApplications = current.applications.filter(app => app.id === incoming.applications[0].id || app.templateIds.some(id => changedTemplates.has(id))).map(app => ({id: app.id, name: app.name}));
    return {
      ...context, userId: user.id, applicationId: incoming.applications[0].id,
      planFingerprint: digest(JSON.stringify({baseline, incoming, ...context, userId: user.id})),
      changed: baseline !== definitionFingerprint(current), preservedRecords: result.preservedRecords, affectedApplications, changes
    };
  }
  function previewDefinitions(user, input) {
    admin(user);
    const incoming = upgradeWorkspace(input);
    return transaction(() => { admin(user); return definitionPlan(user, workspace(), incoming); });
  }
  function publishDefinitions(user, input, options) {
    admin(user);
    if (!options || typeof options.operationId !== 'string' || !/^[\w-]{8,100}$/.test(options.operationId) || !/^[a-f0-9]{64}$/.test(options.planFingerprint ?? '')) fail(400, '请先预览表式更新，并保留原发布操作编号');
    const fingerprint = digest(JSON.stringify({type: 'definitions.publish', input, options}));
    return transaction(() => {
      admin(user);
      if (options.expectedUserId !== user.id) fail(409, '当前登录账号已变化，请重新预览表式更新');
      if (options.expectedInstanceId !== serviceContext(user).instanceId) fail(409, '服务数据环境已变化，请核对当前表式后重新预览');
      const prior = db.prepare('SELECT * FROM requests WHERE id=?').get(options.operationId);
      if (prior) {
        if (prior.user_id !== user.id || prior.fingerprint !== fingerprint) fail(409, '操作编号已用于不同请求');
        return JSON.parse(prior.result);
      }
      const current = workspace();
      const plan = definitionPlan(user, current, upgradeWorkspace(input));
      if (plan.planFingerprint !== options.planFingerprint) fail(409, '表式发布基线或更新包已变化，请重新预览');
      if (plan.changed) { writeWorkspace(current); audit(user, 'application.definitions', plan.applicationId); }
      const result = {updated: plan.changed, preservedRecords: plan.preservedRecords, applicationId: plan.applicationId, operationId: options.operationId};
      db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(options.operationId, user.id, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  function csvContext(user, current, input) {
    active(user);
    const project = current.projects.find(item => item.id === input.projectId);
    const template = current.templates.find(item => item.id === input.templateId);
    if (!project || !template) fail(404, '项目或表式不存在');
    authorize(user, project.id, template.submitterRole || '填报人');
    const application = current.applications.find(item => item.id === project.appId);
    startProjectCase(current, {appId: project.appId, projectId: project.id, templateId: template.id});
    return {project, template, application};
  }
  function csvPlan(user, current, input) {
    const {project, template, application} = csvContext(user, current, input);
    const table = parseCsv(input.csv);
    if (current.cases.length + table.rows.length > 3000) fail(413, '导入后超过单实例 3000 份业务上限，请减少本批数据或使用独立实例');
    const currentBytes = Buffer.byteLength(JSON.stringify(current));
    if (currentBytes + Buffer.byteLength(JSON.stringify(template)) * table.rows.length > 32 * 1024 * 1024) fail(413, '本批表式快照超过工作区容量，请减少行数');
    const context = {...serviceContext(user), userId: user.id};
    if (input.mapping === undefined) return {
      ...context, projectId: project.id, templateId: template.id, headers: table.headers,
      fields: template.fields.filter(field => field.owner === 'draft'), rowCount: table.rows.length,
      sample: table.rows.slice(0, 10), ready: false
    };
    const prepared = prepareCsvImport(current, input);
    const projectedBytes = Buffer.byteLength(JSON.stringify({...current, cases: [...current.cases, ...prepared.records]}));
    if (projectedBytes > 32 * 1024 * 1024) fail(413, '导入后超过工作区 32 MiB 容量，请减少行数');
    return {
      ...context, projectId: project.id, templateId: template.id, templateVersion: template.version,
      headers: prepared.headers, fields: prepared.fields, rows: prepared.rows, ready: prepared.ready,
      rowCount: table.rows.length, records: prepared.records,
      planFingerprint: digest(JSON.stringify({input, project, template, application, ...context}))
    };
  }
  function previewCsvImport(user, input) {
    return transaction(() => {
      const {records, ...plan} = csvPlan(user, workspace(), input);
      return plan;
    });
  }
  function importCsv(user, input, options) {
    active(user);
    if (!options || typeof options.operationId !== 'string' || !/^[\w-]{8,100}$/.test(options.operationId) || !/^[a-f0-9]{64}$/.test(options.planFingerprint ?? '')) fail(400, '请先预览台账并保留原导入操作编号');
    const fingerprint = digest(JSON.stringify({type: 'csv.import', input, options}));
    return transaction(() => {
      if (options.expectedUserId !== user.id || options.expectedInstanceId !== serviceContext(user).instanceId) fail(409, '账号或服务环境已变化，请重新核对导入');
      const current = workspace();
      csvContext(user, current, input);
      const prior = db.prepare('SELECT * FROM requests WHERE id=?').get(options.operationId);
      if (prior) {
        if (prior.user_id !== user.id || prior.fingerprint !== fingerprint) fail(409, '操作编号已用于不同请求');
        return JSON.parse(prior.result);
      }
      const plan = csvPlan(user, current, input);
      if (plan.planFingerprint !== options.planFingerprint) fail(409, '表式、项目或导入内容已变化，请重新预览');
      if (!plan.ready) fail(400, '台账仍有错误，请修正后重新预览');
      for (const record of plan.records) {
        record.createdBy = {id: user.id, name: user.name};
        for (const event of record.events) event.actor = {id: user.id, name: user.name};
      }
      current.cases.push(...plan.records);
      writeWorkspace(current);
      audit(user, 'cases.csv-import', input.projectId);
      const result = {imported: plan.records.length, projectId: input.projectId, templateId: input.templateId, operationId: options.operationId, recordIds: plan.records.map(record => record.id), createdAt: new Date().toISOString(), actor: {id: user.id, name: user.name}};
      db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(options.operationId, user.id, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  function csvHistory(user, {projectId, operationId = '', page = '1'} = {}) {
    return transaction(() => {
      const actor = active(user), current = workspace();
      if (!current.projects.some(project => project.id === projectId) || (!actor.admin && !roles(user, projectId).length)) fail(404, '项目不存在或不可访问');
      const requestedPage = Number(page);
      if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || typeof operationId !== 'string' || operationId.length > 100) fail(400, '批次分页参数无效');
      // Old receipts have no timestamp. Rowid preserves insertion order without inventing dates.
      const predicate = "json_extract(result,'$.projectId')=? AND json_type(result,'$.imported')='integer' AND json_type(result,'$.recordIds')='array'";
      const pageSize = 50;
      if (operationId) {
        const row = db.prepare('SELECT result FROM requests WHERE id=? AND ' + predicate).get(operationId, projectId);
        if (!row) fail(404, '批次不存在或不可访问');
        const receipt = JSON.parse(row.result);
        const pages = Math.max(1, Math.ceil(receipt.recordIds.length / pageSize)), selectedPage = Math.min(requestedPage, pages);
        const byId = new Map(current.cases.filter(record => record.projectId === projectId).map(record => [record.id, record]));
        const records = receipt.recordIds.slice((selectedPage - 1) * pageSize, selectedPage * pageSize).map(id => {
          const record = byId.get(id);
          return record ? {id, title: record.title, summary: summarizeRecord(record), status: record.status, stage: record.status === 'draft' ? '待填写' : record.status === 'complete' ? '已完成' : record.template.workflow[record.step]?.label || '办理中'} : {id, unavailable: true};
        });
        return {receipt, records, page: selectedPage, pages, total: receipt.recordIds.length};
      }
      const total = db.prepare('SELECT count(*) AS total FROM requests WHERE ' + predicate).get(projectId).total;
      const pages = Math.max(1, Math.ceil(total / pageSize)), selectedPage = Math.min(requestedPage, pages);
      const batches = db.prepare('SELECT result,user_id FROM requests WHERE ' + predicate + ' ORDER BY rowid DESC LIMIT ? OFFSET ?').all(projectId, pageSize, (selectedPage - 1) * pageSize).map(row => {
        const result = JSON.parse(row.result);
        const account = db.prepare('SELECT name FROM users WHERE id=?').get(row.user_id);
        return {operationId: result.operationId, templateId: result.templateId, imported: result.imported, createdAt: result.createdAt ?? null, actor: result.actor ?? {id: row.user_id, name: account?.name ?? '历史账号'}, actorNameHistorical: !!result.actor};
      });
      return {projectId, batches, total, page: selectedPage, pages};
    });
  }
  function updateDefinitions(user, input) {
    admin(user);
    const incoming = upgradeWorkspace(input);
    return transaction(() => {
      admin(user);
      const current = workspace();
      const result = applyDefinitions(current, incoming);
      writeWorkspace(current);
      audit(user, 'application.definitions', incoming.applications[0].id);
      return result;
    });
  }
  function command(user, input, {inlineAttachments = true} = {}) {
    active(user);
    if (typeof input.operationId !== 'string' || !/^[\w-]{8,100}$/.test(input.operationId)) fail(400, '需要有效操作编号');
    const fingerprint = digest(JSON.stringify(input));
    return transaction(() => {
      if (input.expectedUserId !== undefined && input.expectedUserId !== user.id) fail(409, '当前登录账号已变化，请重新登录后处理原请求');
      if (input.expectedInstanceId !== undefined && input.expectedInstanceId !== serviceContext(user).instanceId) fail(409, '服务数据环境已变化，请核对当前业务后处理原请求');
      const current = workspace();
      const record = input.type === 'create' ? null : current.cases.find(item => item.id === input.recordId);
      const projectId = record?.projectId ?? input.projectId;
      if (!current.projects.some(item => item.id === projectId)) fail(404, '项目不存在或不可访问');
      const template = input.type === 'create' ? current.templates.find(item => item.id === input.templateId) : record?.template;
      if (!template) fail(404, '业务不存在或不可访问');
      const prior = db.prepare('SELECT * FROM requests WHERE id=?').get(input.operationId);
      if (prior) {
        if (prior.user_id !== user.id || prior.fingerprint !== fingerprint) fail(409, '操作编号已用于不同请求');
        if (!roles(user, projectId).length) fail(403, '当前账号已无项目权限');
        const result = JSON.parse(prior.result);
        if (inlineAttachments) inlineRecords([result.record]);
        return result;
      }
      if (record?.events.some(event => event.operationId === input.operationId)) fail(409, '此操作编号属于导入的历史记录，请使用新操作编号');
      const role = record ? (record.status === 'draft' ? record.submitter : record.template.workflow[record.step]?.role) : template.submitterRole || '填报人';
      authorize(user, projectId, role);
      if (input.type === 'create' && input.expectedTemplateVersion !== undefined && input.expectedTemplateVersion !== template.version) fail(409, '表式版本已变化，请核对当前表式后处理原请求');
      let next;
      if (input.type === 'create') {
        const project = current.projects.find(item => item.id === projectId);
        const result = startProjectCase(current, {appId: project.appId, projectId, templateId: template.id, sourceId: input.sourceId, relationId: input.relationId, role});
        next = result.record;
        if (!result.existing) {
          next.createdBy = {id: user.id, name: user.name};
          for (const event of next.events) event.actor = {id: user.id, name: user.name};
          current.cases.push(next);
        }
      } else {
        if (input.expectedRevision !== record.revision) fail(409, '记录已由其他人更新，请保存草稿并重新读取');
        if (input.type === 'attachment') {
          const attachment = input.attachment;
          if (!attachment || typeof attachment.data !== 'string' || !/^data:[\w.+/-]*;base64,[A-Za-z0-9+/=]*$/.test(attachment.data)) fail(400, '附件格式无效');
          const size = decodeAttachment(attachment.data).bytes.length;
          if (size > 10 * 1024 * 1024 || record.attachments.reduce((sum, item) => sum + item.size, 0) + size > 30 * 1024 * 1024) fail(413, '单个附件最多 10 MB，每份业务附件合计最多 30 MB');
          next = attachFile(record, {name: attachment.name, size, data: attachment.data}, role);
        } else next = applyOperation(record, {type: input.type, role, values: input.values ?? {}, note: input.note ?? '', expectedRevision: input.expectedRevision, operationId: input.operationId});
        next.events.at(-1).actor = {id: user.id, name: user.name};
        current.cases[current.cases.findIndex(item => item.id === record.id)] = next;
      }
      writeWorkspace(current);
      audit(user, 'case.' + input.type, next.id);
      const result = {record: next};
      db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(input.operationId, user.id, fingerprint, JSON.stringify(result));
      if (inlineAttachments) inlineRecords([result.record]);
      return result;
    });
  }
  async function changePassword(user, oldPassword, newPassword) {
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!await passwordMatches(oldPassword, row.password)) fail(403, '原密码不正确');
    const hash = await passwordHash(newPassword);
    transaction(() => {
      active(user);
      if (db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password !== row.password) fail(409, '密码已经变化，请重新登录');
      db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(user, 'user.password', user.id);
    });
  }
  async function resetPassword(username, password) {
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!row) fail(404, '账号不存在');
    const hash = await passwordHash(password);
    transaction(() => {
      db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, row.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
      audit({id: 'server-operator'}, 'user.password-reset', row.id);
    });
  }
  return {
    createUser, login, session, serviceContext, visibleWorkspace, getRecord, importApplication, updateDefinitions, previewDefinitions, publishDefinitions, previewCsvImport, importCsv, csvHistory, setMembership, command, changePassword, resetPassword, operations, deliveryReport, updateDelivery, attachment, projectArchive, projectLedger, projectReview, previewProjectRestore, restoreProject,
    checkProjectArchive: (user, bytes) => { admin(user); return checkProjectArchive(bytes, workspace()); },
    requireAdmin: user => admin(user),
    logout: token => db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token)),
    users: user => { admin(user); return db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser); },
    memberships: user => { admin(user); return db.prepare('SELECT user_id AS userId,project_id AS projectId,roles FROM members').all().map(row => ({...row, roles: JSON.parse(row.roles)})); },
    setDisabled: (user, input) => {
      admin(user);
      if (typeof input.disabled !== 'boolean' || input.userId === user.id) fail(400, '不能停用当前登录账号');
      return transaction(() => {
        if (!db.prepare('SELECT id FROM users WHERE id=?').get(input.userId)) fail(404, '账号不存在');
        db.prepare('UPDATE users SET disabled=? WHERE id=?').run(Number(input.disabled), input.userId);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(input.userId);
        audit(user, input.disabled ? 'user.disable' : 'user.enable', input.userId);
        return {saved: true};
      });
    },
    audit: user => { admin(user); return db.prepare('SELECT * FROM audit ORDER BY sequence DESC LIMIT 500').all(); },
    backup: verifiedBackup,
    close: () => db.close()
  };
}
