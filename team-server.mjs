import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';
import {openTeamStore, fail} from './team-store.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const staticFiles = new Set(['team.html', 'team-ui.js', 'team-delivery.mjs', 'team.css', 'forms.css', 'forms-detail-ui.js', 'forms-schema.mjs', 'forms-model.mjs', 'forms-rules.mjs', 'forms-print.mjs']);
const cookieName = 'flowlens_session';
export function createTeamServer({database = resolve(root, '.local/team.sqlite'), origin = 'http://127.0.0.1:4186'} = {}) {
  const canonical = new URL(origin);
  if (canonical.origin !== origin || !['http:', 'https:'].includes(canonical.protocol)) throw Error('FLOWLENS_ORIGIN 必须是完整站点源地址');
  if (canonical.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(canonical.hostname)) throw Error('外部协作站点必须配置 HTTPS 源地址');
  const store = openTeamStore(database);
  const attempts = new Map();
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${canonical.protocol === 'https:' ? '; Secure' : ''}`;
  function send(res, status, value, extra = {}) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', ...extra});
    res.end(JSON.stringify(value));
  }
  async function body(req, limit = 64 * 1024) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, '请求需使用 JSON');
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > limit) fail(413, '请求内容超过此接口的大小限制');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { fail(400, 'JSON 内容无效'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (canonical.protocol === 'https:') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (req.headers.host !== canonical.host) fail(403, '访问地址与配置不符');
      if (req.headers.origin && req.headers.origin !== origin) fail(403, '不接受跨站请求');
      const path = new URL(req.url, origin).pathname;
      if (path === '/health' && req.method === 'GET') return send(res, 200, {status: 'ok', service: 'FlowLens collaboration'});
      if (!path.startsWith('/api/team/')) {
        if (req.method !== 'GET') fail(405, '方法不支持');
        const file = path === '/' ? 'team.html' : path.slice(1);
        if (!staticFiles.has(file)) fail(404, '页面不存在');
        const data = await readFile(resolve(root, file));
        res.writeHead(200, {'Content-Type': extname(file) === '.html' ? 'text/html; charset=utf-8' : extname(file) === '.css' ? 'text/css' : 'text/javascript'});
        return res.end(data);
      }
      if (!['GET', 'POST'].includes(req.method)) fail(405, '方法不支持');
      if (req.method === 'POST' && req.headers['x-flowlens-request'] !== '1') fail(403, '缺少同源请求标记');
      if (path === '/api/team/login' && req.method === 'POST') {
        const input = await body(req);
        const address = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
        const username = typeof input.username === 'string' ? input.username.toLowerCase().slice(0, 64) : '';
        const accountKey = address + '\0' + username;
        const accountAttempt = attempts.get(accountKey) ?? {count: 0, until: now + 15 * 60000};
        const addressAttempt = attempts.get(address) ?? {count: 0, until: now + 15 * 60000};
        if (accountAttempt.count >= 20 || addressAttempt.count >= 100) fail(429, '登录尝试过多，请稍后再试');
        // Reserve before hashing so concurrent requests cannot bypass either limit.
        accountAttempt.count++;
        addressAttempt.count++;
        attempts.set(accountKey, accountAttempt);
        attempts.set(address, addressAttempt);
        const result = await store.login(input.username, input.password);
        // Successful logins do not consume the shared proxy's failure allowance.
        accountAttempt.count--;
        addressAttempt.count--;
        return send(res, 200, {user: result.user}, {'Set-Cookie': cookie(result.token, 8 * 3600)});
      }
      const token = (req.headers.cookie ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      const user = store.session(token);
      if (req.method === 'GET') {
        if (path === '/api/team/me') return send(res, 200, {user});
        if (path === '/api/team/workspace') return send(res, 200, store.visibleWorkspace(user));
        if (path === '/api/team/admin') return send(res, 200, {users: store.users(user), memberships: store.memberships(user), audit: store.audit(user)});
        if (path === '/api/team/operations') return send(res, 200, {...store.operations(user), uptimeSeconds: Math.floor(process.uptime()), memoryBytes: process.memoryUsage().rss});
        if (path === '/api/team/delivery') return send(res, 200, store.deliveryReport(user, new URL(req.url, origin).searchParams.get('scope') || 'instance', origin));
        fail(404, '接口不存在');
      }
      const input = await body(req, ['/api/team/import', '/api/team/definitions'].includes(path) ? 32 * 1024 * 1024 : path === '/api/team/command' ? 15 * 1024 * 1024 : 64 * 1024);
      if (path === '/api/team/logout') { store.logout(token); return send(res, 200, {ok: true}, {'Set-Cookie': cookie('', 0)}); }
      if (path === '/api/team/password') { await store.changePassword(user, input.oldPassword, input.newPassword); return send(res, 200, {ok: true}, {'Set-Cookie': cookie('', 0)}); }
      if (path === '/api/team/command') return send(res, 200, store.command(user, input));
      if (path === '/api/team/delivery') return send(res, 200, store.updateDelivery(user, input, origin));
      if (path === '/api/team/import') return send(res, 200, store.importApplication(user, input));
      if (path === '/api/team/definitions') return send(res, 200, store.updateDefinitions(user, input));
      if (path === '/api/team/users') return send(res, 201, await store.createUser(user, input));
      if (path === '/api/team/membership') return send(res, 200, store.setMembership(user, input));
      if (path === '/api/team/user-status') return send(res, 200, store.setDisabled(user, input));
      fail(404, '接口不存在');
    } catch (error) {
      const status = error.status ?? (error.code?.startsWith('SQLITE') || error.code === 'ERR_SQLITE_ERROR' ? 500 : 400);
      send(res, status, {error: status === 500 ? '存储操作失败，请联系管理员并重试' : error.message});
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  server.on('close', () => store.close());
  return {server, store};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = process.env.FLOWLENS_ORIGIN || 'http://127.0.0.1:4186';
  const {server} = createTeamServer({origin, database: process.env.FLOWLENS_DATABASE || resolve(root, '.local/team.sqlite')});
  const port = Number(process.env.PORT || 4186);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('FlowLens collaboration ' + origin));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
