import {resolve} from 'node:path';
import {existsSync, mkdirSync, chmodSync} from 'node:fs';
import {DatabaseSync, backup} from 'node:sqlite';
import {openTeamStore} from '../team-store.mjs';
import {upgradeWorkspace} from '../forms-store.mjs';

const [action, target] = process.argv.slice(2);
const filename = resolve(process.env.FLOWLENS_DATABASE || '.local/team.sqlite');
if (action === 'restore') {
  if (!target || !existsSync(target)) throw Error('请提供备份文件路径');
  if (existsSync(filename)) throw Error('请使用新的数据库路径恢复，保留当前数据库并停止协作服务后切换');
  const source = new DatabaseSync(resolve(target), {readOnly: true});
  try {
    if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('备份完整性检查失败');
    if (source.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('不支持的数据库版本');
    upgradeWorkspace(JSON.parse(source.prepare('SELECT data FROM workspace WHERE id=1').get().data));
    source.prepare('SELECT id,username,password,admin,disabled FROM users').all();
    source.prepare('SELECT token,user_id,expires FROM sessions').all();
    source.prepare('SELECT user_id,project_id,roles FROM members').all();
    source.prepare('SELECT sequence,at,user_id,action,target FROM audit LIMIT 1').all();
    source.prepare('SELECT id,user_id,fingerprint,result FROM requests LIMIT 1').all();
    mkdirSync(resolve(filename, '..'), {recursive: true, mode: 0o700});
    await backup(source, filename);
    chmodSync(filename, 0o600);
  } finally { source.close(); }
  // Existing browser sessions must authenticate again after a restore.
  const restored = new DatabaseSync(filename);
  restored.exec('DELETE FROM sessions');
  restored.close();
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
