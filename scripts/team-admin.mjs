import {resolve} from 'node:path';
import {existsSync, mkdirSync, chmodSync, mkdtempSync, copyFileSync, linkSync, rmSync, statSync} from 'node:fs';
import {DatabaseSync, backup} from 'node:sqlite';
import {openTeamStore} from '../team-store.mjs';
import {upgradeWorkspace} from '../forms-store.mjs';
import {validateAttachmentSnapshot} from '../team-attachments.mjs';

const [action, target] = process.argv.slice(2);
const filename = resolve(process.env.FLOWLENS_DATABASE || '.local/team.sqlite');
if (action === 'restore') {
  if (!target || !existsSync(target)) throw Error('请提供备份文件路径');
  if (existsSync(filename)) throw Error('请使用新的数据库路径恢复，保留当前数据库并停止协作服务后切换');
  const sourcePath = resolve(target);
  // Only restore standalone snapshots, never copy a live WAL database without its log.
  const checkSource = () => {
    for (const suffix of ['-wal', '-journal']) {
      if (existsSync(sourcePath + suffix) && statSync(sourcePath + suffix).size > 0) throw Error('来源存在事务日志，请先使用 backup 命令生成独立备份，不要直接复制运行中的数据库');
    }
    const info = statSync(sourcePath);
    if (!info.isFile()) throw Error('备份来源必须是普通文件');
    return info;
  };
  const before = checkSource();
  const parent = resolve(filename, '..');
  mkdirSync(parent, {recursive: true, mode: 0o700});
  const staging = mkdtempSync(resolve(parent, '.flowlens-restore-'));
  chmodSync(staging, 0o700);
  const stagedSource = resolve(staging, 'source.sqlite'), prepared = resolve(staging, 'prepared.sqlite');
  try {
    copyFileSync(sourcePath, stagedSource);
    chmodSync(stagedSource, 0o600);
    const after = checkSource();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw Error('复制期间备份来源发生变化，请使用固定的备份文件重试');
    // Writable staging permits SQLite to create required WAL sidecars without touching the source.
    const source = new DatabaseSync(stagedSource, {readOnly: true});
    try {
      if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('备份完整性检查失败');
      const version = source.prepare('PRAGMA user_version').get().user_version;
      if (![1, 2].includes(version)) throw Error('不支持的数据库版本');
      const workspace = upgradeWorkspace(JSON.parse(source.prepare('SELECT data FROM workspace WHERE id=1').get().data), {allowAttachmentReferences: version === 2});
      if (version === 2) validateAttachmentSnapshot(source, workspace, {verifyHashes: true});
      source.prepare('SELECT id,username,password,admin,disabled FROM users').all();
      source.prepare('SELECT token,user_id,expires FROM sessions').all();
      source.prepare('SELECT user_id,project_id,roles FROM members').all();
      source.prepare('SELECT sequence,at,user_id,action,target FROM audit LIMIT 1').all();
      source.prepare('SELECT id,user_id,fingerprint,result FROM requests LIMIT 1').all();
      await backup(source, prepared);
      chmodSync(prepared, 0o600);
    } finally { source.close(); }
    const restored = new DatabaseSync(prepared);
    try {
      restored.exec('BEGIN IMMEDIATE; DELETE FROM sessions; CREATE TABLE IF NOT EXISTS maintenance (key TEXT PRIMARY KEY, data TEXT NOT NULL); DELETE FROM maintenance;');
      restored.prepare('INSERT INTO maintenance VALUES(?,?)').run('lastRestore', JSON.stringify({completedAt: new Date().toISOString()}));
      restored.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');
      if (restored.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('恢复结果完整性检查失败');
    } finally { restored.close(); }
    // Same-filesystem hard link publishes the completed file atomically and refuses an existing target.
    linkSync(prepared, filename);
  } finally {
    // This directory was created exclusively above; never remove the requested destination.
    rmSync(staging, {recursive: true, force: true});
  }
  console.log('备份已恢复，请用新数据库启动服务并重新登录');
} else {
  if (!['init', 'backup', 'reset-password'].includes(action)) throw Error('支持 init、backup、restore、reset-password 命令');
  if (action !== 'init' && !existsSync(filename)) throw Error('数据库不存在，请检查 FLOWLENS_DATABASE');
  const store = openTeamStore(filename);
  try {
    if (action === 'init') {
      await store.createUser(null, {username: process.env.FLOWLENS_ADMIN_USER || 'admin', name: '管理员', password: process.env.FLOWLENS_ADMIN_PASSWORD});
      console.log('管理员初始化完成。请清除初始化密码环境变量。');
    } else if (action === 'reset-password') {
      await store.resetPassword(process.env.FLOWLENS_ADMIN_USER || 'admin', process.env.FLOWLENS_ADMIN_PASSWORD);
      console.log('指定账号的密码已重置，原会话已失效。请清除密码环境变量。');
    } else if (action === 'backup') {
      if (!target || existsSync(target)) throw Error('请提供尚不存在的备份文件路径');
      await store.backup(resolve(target));
      chmodSync(resolve(target), 0o600);
      console.log('一致性备份已写入指定路径，请妥善保管，其中含账号哈希及业务数据');
    } else throw Error('用法 node scripts/team-admin.mjs init | reset-password | backup <路径> | restore <路径>');
  } finally { store.close(); }
}
