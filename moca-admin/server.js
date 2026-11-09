const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 8787);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://sanye519.github.io,http://127.0.0.1:8766,http://localhost:8766').split(','));
const PACKAGES = ['primary', 'junior', 'senior'];
const PACKAGE_NAMES = { primary: '小学', junior: '初中', senior: '高中' };

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is required');
  process.exit(1);
}

const now = () => new Date().toISOString();
const daysFromNow = days => new Date(Date.now() + days * 86400000).toISOString();
const token = () => crypto.randomBytes(32).toString('hex');
const clone = value => JSON.parse(JSON.stringify(value));

function seedDatabase() {
  const users = [
    { id: 35369, loginName: '微信VtwEFg', registeredAt: '2026-11-09T07:53:02.000Z', username: '', phone: '', packages: PACKAGES, vipUntil: '2027-11-09T00:00:00.000Z', lastLoginAt: '2026-11-09T07:53:02.000Z' },
    { id: 35368, loginName: '微信CaAUXZ', registeredAt: '2026-11-09T07:51:01.000Z', username: '', phone: '', packages: ['junior', 'senior'], vipUntil: '2027-11-09T00:00:00.000Z', lastLoginAt: '2026-11-09T07:51:01.000Z' },
    { id: 35367, loginName: '13452828807', registeredAt: '2026-11-09T07:41:25.000Z', username: '', phone: '13452828807', packages: PACKAGES, vipUntil: '2027-11-09T00:00:00.000Z', lastLoginAt: '2026-11-09T07:41:25.000Z' },
    { id: 35366, loginName: '微信GQiziV', registeredAt: '2026-11-09T07:35:06.000Z', username: '', phone: '', packages: PACKAGES, vipUntil: '2027-11-09T00:00:00.000Z', lastLoginAt: '2026-11-09T07:35:06.000Z' },
    { id: 35365, loginName: '微信AhuJNy', registeredAt: '2026-11-09T07:35:06.000Z', username: '', phone: '', packages: PACKAGES, vipUntil: '2027-11-09T00:00:00.000Z', lastLoginAt: '2026-11-09T07:35:06.000Z' }
  ];
  return { nextUserId: 35370, users, logs: [], adminSessions: {}, parentSessions: {} };
}

function loadDatabase() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const initial = seedDatabase();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

let db = loadDatabase();

function saveDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = DB_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(db, null, 2));
  fs.renameSync(temporary, DB_FILE);
}

function baseHeaders(req, extra = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...extra
  };
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '600';
    headers['Vary'] = 'Origin';
  }
  return headers;
}

function sendJson(req, res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, baseHeaders(req, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }));
  res.end(body);
}

function sendText(req, res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, baseHeaders(req, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra }));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 32768) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('JSON 格式不正确'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function publicUser(user) {
  const { id, loginName, registeredAt, username, phone, packages, vipUntil, lastLoginAt } = user;
  return { id, loginName, registeredAt, username, phone, packages, vipUntil, lastLoginAt };
}

function sessionValid(session) {
  return session && new Date(session.expiresAt).getTime() > Date.now();
}

function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function requireAdmin(req, res) {
  const session = db.adminSessions[bearer(req)];
  if (!sessionValid(session)) {
    sendJson(req, res, 401, { error: '登录已失效，请重新登录' });
    return false;
  }
  return true;
}

function requireParent(req, res) {
  const session = db.parentSessions[bearer(req)];
  if (!sessionValid(session)) {
    sendJson(req, res, 401, { error: '家长登录已失效，请重新登录' });
    return null;
  }
  return session;
}

function addLog(user, action, before, actor = 'admin') {
  db.logs.push({ id: crypto.randomUUID(), userId: user.id, loginName: user.loginName, action, before, after: { packages: user.packages, vipUntil: user.vipUntil }, actor, createdAt: now() });
  if (db.logs.length > 1000) db.logs = db.logs.slice(-1000);
}

function updatePackages(user, packages, vipUntil) {
  user.packages = [...new Set(packages)].filter(item => PACKAGES.includes(item));
  user.vipUntil = user.packages.length ? vipUntil : null;
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, baseHeaders(req));
    res.end();
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(req, res, 200, { ok: true, time: now() });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/parent/login') {
    const body = await readBody(req);
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (!/^1\d{10}$/.test(phone)) {
      sendJson(req, res, 400, { error: '请输入正确的 11 位手机号' });
      return;
    }
    let user = db.users.find(item => item.phone === phone);
    if (!user) {
      user = {
        id: db.nextUserId++,
        loginName: `微信${crypto.randomBytes(4).toString('base64url').slice(0, 6)}`,
        registeredAt: now(),
        username: String(body.displayName || '').trim().slice(0, 40),
        phone,
        packages: [],
        vipUntil: null,
        lastLoginAt: now()
      };
      db.users.push(user);
    }
    user.lastLoginAt = now();
    if (body.displayName !== undefined) user.username = String(body.displayName || '').trim().slice(0, 40);
    const sessionToken = token();
    db.parentSessions[sessionToken] = { userId: user.id, createdAt: now(), expiresAt: daysFromNow(30) };
    saveDatabase();
    sendJson(req, res, 200, { token: sessionToken, user: publicUser(user) });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/parent/me') {
    const session = requireParent(req, res);
    if (!session) return;
    const user = db.users.find(item => item.id === session.userId);
    if (!user) {
      sendJson(req, res, 404, { error: '用户不存在' });
      return;
    }
    sendJson(req, res, 200, { user: publicUser(user) });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/parent/logout') {
    const session = requireParent(req, res);
    if (!session) return;
    delete db.parentSessions[bearer(req)];
    saveDatabase();
    sendJson(req, res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const body = await readBody(req);
    if (body.username !== ADMIN_USERNAME || body.password !== ADMIN_PASSWORD) {
      sendJson(req, res, 401, { error: '账号或密码不正确' });
      return;
    }
    const sessionToken = token();
    db.adminSessions[sessionToken] = { username: ADMIN_USERNAME, createdAt: now(), expiresAt: daysFromNow(0.5) };
    saveDatabase();
    sendJson(req, res, 200, { token: sessionToken, username: ADMIN_USERNAME });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (req.method === 'GET' && url.pathname === '/api/admin/session') {
    sendJson(req, res, 200, { username: db.adminSessions[bearer(req)].username });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    delete db.adminSessions[bearer(req)];
    saveDatabase();
    sendJson(req, res, 200, { ok: true });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/users') {
    const query = (url.searchParams.get('query') || '').trim().toLowerCase();
    const users = db.users
      .filter(user => !query || [user.id, user.loginName, user.username, user.phone].some(value => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))
      .map(publicUser);
    sendJson(req, res, 200, { users, total: users.length });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/recharges') {
    sendJson(req, res, 200, { logs: clone(db.logs).reverse().slice(0, 200) });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/stats') {
    const active = db.users.filter(user => user.packages.length && user.vipUntil && new Date(user.vipUntil).getTime() > Date.now());
    const today = now().slice(0, 10);
    const trend = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.now() - (6 - index) * 86400000).toISOString().slice(0, 10);
      return { date, count: db.users.filter(user => user.registeredAt.startsWith(date)).length };
    });
    const counts = Object.fromEntries(PACKAGES.map(id => [id, active.filter(user => user.packages.includes(id)).length]));
    sendJson(req, res, 200, {
      totalUsers: db.users.length,
      activeVip: active.length,
      inactiveVip: db.users.length - active.length,
      todayRegistrations: db.users.filter(user => user.registeredAt.startsWith(today)).length,
      packageCounts: counts,
      trend,
      recentLogs: clone(db.logs).reverse().slice(0, 6)
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/export') {
    const rows = [['用户ID', '登录名', '注册时间', '用户名', '手机号', 'VIP到期时间', 'VIP内容']];
    db.users.forEach(user => rows.push([user.id, user.loginName, user.registeredAt, user.username, user.phone, user.vipUntil || '', user.packages.map(id => PACKAGE_NAMES[id]).join('/')]));
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    sendText(req, res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="moca-users.csv"' });
    return;
  }
  const match = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/(packages|extend|cancel)$/);
  if (req.method === 'POST' && match) {
    const user = db.users.find(item => item.id === Number(match[1]));
    if (!user) {
      sendJson(req, res, 404, { error: '用户不存在' });
      return;
    }
    const body = await readBody(req);
    const before = { packages: [...user.packages], vipUntil: user.vipUntil };
    if (match[2] === 'packages') {
      if (!Array.isArray(body.packages)) {
        sendJson(req, res, 400, { error: '套餐格式不正确' });
        return;
      }
      const packages = body.packages.filter(item => PACKAGES.includes(item));
      let vipUntil = body.vipUntil ? new Date(body.vipUntil).toISOString() : user.vipUntil;
      if (packages.length && !vipUntil) vipUntil = daysFromNow(30);
      updatePackages(user, packages, vipUntil);
      addLog(user, '调整套餐', before);
    } else if (match[2] === 'extend') {
      const days = Number(body.days);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        sendJson(req, res, 400, { error: '延期天数需为 1-3650 的整数' });
        return;
      }
      const packages = Array.isArray(body.packages) ? body.packages.filter(item => PACKAGES.includes(item)) : user.packages;
      if (!packages.length) {
        sendJson(req, res, 400, { error: '请先为用户选择套餐' });
        return;
      }
      const base = user.vipUntil && new Date(user.vipUntil).getTime() > Date.now() ? new Date(user.vipUntil).getTime() : Date.now();
      updatePackages(user, packages, new Date(base + days * 86400000).toISOString());
      addLog(user, `延长VIP ${days}天`, before);
    } else {
      updatePackages(user, [], null);
      addLog(user, '取消VIP', before);
    }
    saveDatabase();
    sendJson(req, res, 200, { user: publicUser(user) });
    return;
  }
  sendJson(req, res, 404, { error: '接口不存在' });
}

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml']
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(req, res, 405, { error: 'Method Not Allowed' });
      return;
    }
    const file = STATIC_FILES[url.pathname];
    if (!file) {
      sendText(req, res, 404, 'Not Found');
      return;
    }
    const content = fs.readFileSync(path.join(ROOT, 'public', file[0]));
    res.writeHead(200, baseHeaders(req, {
      'Content-Type': file[1],
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    }));
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error);
    sendJson(req, res, error.status || 500, { error: error.status ? error.message : '服务器暂时不可用' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Moca admin listening on http://127.0.0.1:${PORT}`);
});
