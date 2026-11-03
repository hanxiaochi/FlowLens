import {DatabaseSync, backup} from 'node:sqlite';
import {randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync, statSync, statfsSync, createReadStream, chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {emptyWorkspace, upgradeWorkspace} from './forms-store.mjs';
import {startProjectCase} from './apps-model.mjs';
import {applyOperation, attachFile} from './forms-model.mjs';

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
  if (db.prepare('PRAGMA user_version').get().user_version > 1) { db.close(); throw Error('数据库版本高于当前程序，请使用匹配版本'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members (user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL, roles TEXT NOT NULL, PRIMARY KEY(user_id, project_id));
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS maintenance (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    PRAGMA user_version=1;`);
  db.prepare('INSERT OR IGNORE INTO workspace VALUES (1,0,?)').run(JSON.stringify(emptyWorkspace()));
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
    const next = upgradeWorkspace(value);
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
      users: db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(disabled=0),0) AS enabled FROM users').get(),
      lastBackup: maintenance.lastBackup ?? null,
      lastRestore: maintenance.lastRestore ?? null
    };
  }
  async function verifiedBackup(destination) {
    await backup(db, destination);
    chmodSync(destination, 0o600);
    const snapshot = new DatabaseSync(destination, {readOnly: true});
    let workspaceRevision;
    try {
      if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('备份完整性检查失败');
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
  function visibleWorkspace(user) {
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
    return {workspace: value, memberships};
  }
  function importApplication(user, input) {
    admin(user);
    const incoming = upgradeWorkspace(input);
    if (!incoming.applications.length || incoming.cases.some(item => !item.appId)) fail(400, '请导入整个应用包，业务需属于应用和项目');
    for (const record of incoming.cases) {
      delete record.createdBy;
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
      const app = value.applications.find(item => item.id === project.appId);
      const templates = [...value.templates.filter(item => app.templateIds.includes(item.id)), ...value.cases.filter(item => item.projectId === project.id).map(item => item.template)];
      const available = new Set(templates.flatMap(item => [item.submitterRole || '填报人', ...item.workflow.map(stage => stage.role)]));
      if (!Array.isArray(input.roles) || input.roles.length > 30 || input.roles.some(role => !available.has(role))) fail(400, '角色必须来自该项目的表式');
      db.prepare('INSERT INTO members VALUES(?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET roles=excluded.roles').run(input.userId, input.projectId, JSON.stringify([...new Set(input.roles)]));
      if (!input.roles.length) db.prepare('DELETE FROM members WHERE user_id=? AND project_id=?').run(input.userId, input.projectId);
      audit(user, 'membership.update', input.userId + '/' + input.projectId + '/' + input.roles.join(','));
      return {saved: true};
    });
  }
  function updateDefinitions(user, input) {
    admin(user);
    const incoming = upgradeWorkspace(input);
    if (incoming.applications.length !== 1) fail(400, '每次发布一个应用的表式更新');
    return transaction(() => {
      const current = workspace();
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
      writeWorkspace(current);
      audit(user, 'application.definitions', app.id);
      return {updated: true, preservedRecords: current.cases.filter(item => item.appId === app.id).length};
    });
  }
  function command(user, input) {
    active(user);
    if (typeof input.operationId !== 'string' || !/^[\w-]{8,100}$/.test(input.operationId)) fail(400, '需要有效操作编号');
    const fingerprint = digest(JSON.stringify(input));
    return transaction(() => {
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
        return JSON.parse(prior.result);
      }
      if (record?.events.some(event => event.operationId === input.operationId)) fail(409, '此操作编号属于导入的历史记录，请使用新操作编号');
      const role = record ? (record.status === 'draft' ? record.submitter : record.template.workflow[record.step]?.role) : template.submitterRole || '填报人';
      authorize(user, projectId, role);
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
          const size = Buffer.from(attachment.data.split(',')[1], 'base64').length;
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
    createUser, login, session, visibleWorkspace, importApplication, updateDefinitions, setMembership, command, changePassword, resetPassword, operations,
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
