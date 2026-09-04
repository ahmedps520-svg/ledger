const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  initStore, readDB, writeDB, closeStore,
  takeGeneratedAdminPassword, newToken, STORE_DESCRIPTION
} = require('./lib/store');
const {
  verifyPassword, setSessionSecret, verifySession,
  parseCookies, makeSessionCookie, clearSessionCookie
} = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_COOKIE = 'ledger_admin_session';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

function sendJSON(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...(extraHeaders || {}) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) req.destroy(); // basic guard
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function uid() {
  return crypto.randomBytes(6).toString('hex');
}

function currentMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getAdminSession(req) {
  const cookies = parseCookies(req);
  const payload = verifySession(cookies[ADMIN_COOKIE]);
  return payload && payload.role === 'admin' ? payload : null;
}
/** The admin sees each friend's private link token so it can be shared. */
function adminFriend(f) {
  return { ...f };
}

/** What a friend sees on their own dues page: no token, no other friends. */
function friendView(f) {
  const { token, ...rest } = f;
  return rest;
}

/** Constant-time token comparison, so a wrong link can't be guessed by timing. */
function findFriendByToken(db, token) {
  if (typeof token !== 'string' || token.length < 16) return null;
  const given = Buffer.from(token);
  return db.friends.find((f) => {
    const known = Buffer.from(f.token || '');
    return known.length === given.length && crypto.timingSafeEqual(known, given);
  }) || null;
}

/* ================= static file serving ================= */
function serveStatic(req, res, urlPath) {
  let filePath = decodeURIComponent(urlPath.split('?')[0]);
  if (filePath === '/') filePath = '/admin/index.html';
  if (filePath === '/admin' || filePath === '/admin/') filePath = '/admin/index.html';
  // A friend's private link. The page reads the token back out of the URL.
  if (/^\/f\/[a-f0-9]+\/?$/.test(filePath)) filePath = '/portal/dues.html';
  if (filePath === '/portal' || filePath === '/portal/') filePath = '/portal/help.html';

  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));
  // startsWith(PUBLIC_DIR) alone would also accept a sibling like "/public-evil"
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404</h1><p>Not found. <a href="/admin/">Admin dashboard</a> · <a href="/portal/">Friend portal</a></p>');
    }
    const ext = path.extname(resolved);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* ================= API ================= */
async function handleApi(req, res, pathname) {
  const method = req.method;

  /* ---- admin auth ---- */
  if (pathname === '/api/admin/login' && method === 'POST') {
    const { email, password } = await readBody(req);
    const db = readDB();
    if (typeof email === 'string' && typeof password === 'string' &&
        email.trim().toLowerCase() === db.admin.email.toLowerCase() &&
        verifyPassword(password, db.admin.passwordHash)) {
      const cookie = makeSessionCookie(ADMIN_COOKIE, { role: 'admin', email: db.admin.email });
      return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    }
    return sendJSON(res, 401, { ok: false, error: 'Incorrect email or password.' });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(ADMIN_COOKIE) });
  }

  if (pathname === '/api/admin/me' && method === 'GET') {
    const admin = getAdminSession(req);
    return sendJSON(res, 200, { loggedIn: !!admin, email: admin ? admin.email : null });
  }

  /* ---- everything else under /api/admin/* requires an admin session ---- */
  if (pathname.startsWith('/api/admin/')) {
    const admin = getAdminSession(req);
    if (!admin) return sendJSON(res, 401, { ok: false, error: 'Not signed in.' });
    const db = readDB();

    if (pathname === '/api/admin/friends' && method === 'GET') {
      return sendJSON(res, 200, { friends: db.friends.map(adminFriend) });
    }

    if (pathname === '/api/admin/friends' && method === 'POST') {
      const { name, note, email } = await readBody(req);
      if (!name || !name.trim()) return sendJSON(res, 400, { ok: false, error: 'Name is required.' });
      if (email && db.friends.some(f => f.email && f.email.toLowerCase() === email.trim().toLowerCase())) {
        return sendJSON(res, 400, { ok: false, error: 'That email is already linked to another friend.' });
      }
      const friend = {
        id: uid(), name: name.trim(), note: (note || '').trim(),
        email: email ? email.trim().toLowerCase() : '',
        token: newToken(), subscriptions: []
      };
      db.friends.push(friend);
      await writeDB(db);
      return sendJSON(res, 201, { friend: adminFriend(friend) });
    }

    const friendMatch = pathname.match(/^\/api\/admin\/friends\/([a-f0-9]+)$/);
    if (friendMatch && (method === 'PUT' || method === 'DELETE')) {
      const friend = db.friends.find(f => f.id === friendMatch[1]);
      if (!friend) return sendJSON(res, 404, { ok: false, error: 'Friend not found.' });
      if (method === 'DELETE') {
        db.friends = db.friends.filter(f => f.id !== friend.id);
        await writeDB(db);
        return sendJSON(res, 200, { ok: true });
      }
      const { name, note, email } = await readBody(req);
      const emailStr = email === undefined ? undefined : String(email || '').trim();
      if (emailStr &&
          db.friends.some(f => f.id !== friend.id && f.email && f.email.toLowerCase() === emailStr.toLowerCase())) {
        return sendJSON(res, 400, { ok: false, error: 'That email is already linked to another friend.' });
      }
      if (name !== undefined) friend.name = String(name || '').trim() || friend.name;
      if (note !== undefined) friend.note = String(note || '').trim();
      if (emailStr !== undefined) friend.email = emailStr.toLowerCase();
      await writeDB(db);
      return sendJSON(res, 200, { friend: adminFriend(friend) });
    }

    const subCreateMatch = pathname.match(/^\/api\/admin\/friends\/([a-f0-9]+)\/subscriptions$/);
    if (subCreateMatch && method === 'POST') {
      const friend = db.friends.find(f => f.id === subCreateMatch[1]);
      if (!friend) return sendJSON(res, 404, { ok: false, error: 'Friend not found.' });
      const { service, customLabel, price, dueDay } = await readBody(req);
      const sub = {
        id: uid(), service: service || 'Custom',
        customLabel: service === 'Custom' ? (customLabel || '').trim() : '',
        price: parseFloat(price) || 0,
        dueDay: dueDay ? parseInt(dueDay, 10) : null,
        payments: {}
      };
      friend.subscriptions.push(sub);
      await writeDB(db);
      return sendJSON(res, 201, { friend: adminFriend(friend) });
    }

    const subMatch = pathname.match(/^\/api\/admin\/friends\/([a-f0-9]+)\/subscriptions\/([a-f0-9]+)$/);
    if (subMatch && (method === 'PUT' || method === 'DELETE')) {
      const friend = db.friends.find(f => f.id === subMatch[1]);
      if (!friend) return sendJSON(res, 404, { ok: false, error: 'Friend not found.' });
      const sub = friend.subscriptions.find(s => s.id === subMatch[2]);
      if (!sub) return sendJSON(res, 404, { ok: false, error: 'Subscription not found.' });
      if (method === 'DELETE') {
        friend.subscriptions = friend.subscriptions.filter(s => s.id !== sub.id);
        await writeDB(db);
        return sendJSON(res, 200, { ok: true });
      }
      const { service, customLabel, price, dueDay } = await readBody(req);
      if (service !== undefined) sub.service = service;
      if (customLabel !== undefined) sub.customLabel = sub.service === 'Custom' ? customLabel.trim() : '';
      if (price !== undefined) sub.price = parseFloat(price) || 0;
      if (dueDay !== undefined) sub.dueDay = dueDay ? parseInt(dueDay, 10) : null;
      await writeDB(db);
      return sendJSON(res, 200, { friend: adminFriend(friend) });
    }

    const toggleMatch = pathname.match(/^\/api\/admin\/friends\/([a-f0-9]+)\/subscriptions\/([a-f0-9]+)\/toggle$/);
    if (toggleMatch && method === 'POST') {
      const friend = db.friends.find(f => f.id === toggleMatch[1]);
      if (!friend) return sendJSON(res, 404, { ok: false, error: 'Friend not found.' });
      const sub = friend.subscriptions.find(s => s.id === toggleMatch[2]);
      if (!sub) return sendJSON(res, 404, { ok: false, error: 'Subscription not found.' });
      const mk = currentMonthKey();
      sub.payments = sub.payments || {};
      const wasPaid = !!(sub.payments[mk] && sub.payments[mk].paid);
      sub.payments[mk] = { paid: !wasPaid, at: new Date().toISOString() };
      await writeDB(db);
      return sendJSON(res, 200, { friend: adminFriend(friend) });
    }

    const relinkMatch = pathname.match(/^\/api\/admin\/friends\/([a-f0-9]+)\/relink$/);
    if (relinkMatch && method === 'POST') {
      const friend = db.friends.find(f => f.id === relinkMatch[1]);
      if (!friend) return sendJSON(res, 404, { ok: false, error: 'Friend not found.' });
      friend.token = newToken(); // the old link stops working immediately
      await writeDB(db);
      return sendJSON(res, 200, { friend: adminFriend(friend) });
    }

    if (pathname === '/api/admin/export' && method === 'GET') {
      return sendJSON(res, 200, { friends: db.friends.map(adminFriend), exportedAt: new Date().toISOString() });
    }

    if (pathname === '/api/admin/import' && method === 'POST') {
      const { friends } = await readBody(req);
      if (!Array.isArray(friends)) return sendJSON(res, 400, { ok: false, error: 'Invalid backup file.' });
      // Keep whichever link already works: the one in the backup, else the
      // one this friend currently has, else a fresh one.
      const byId = new Map(db.friends.map(f => [f.id, f]));
      db.friends = friends.map(f => ({
        id: f.id || uid(),
        name: f.name || 'Unnamed',
        note: f.note || '',
        email: (f.email || '').toLowerCase(),
        subscriptions: Array.isArray(f.subscriptions) ? f.subscriptions : [],
        token: f.token || (byId.get(f.id) || {}).token || newToken()
      }));
      await writeDB(db);
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { ok: false, error: 'Unknown admin route.' });
  }

  /* ---- friend dues, opened by private link ---- */
  const duesMatch = pathname.match(/^\/api\/portal\/dues\/([a-f0-9]+)$/);
  if (duesMatch && method === 'GET') {
    const db = readDB();
    const friend = findFriendByToken(db, duesMatch[1]);
    if (!friend) return sendJSON(res, 404, { ok: false, error: 'This link is not valid. Ask for a new one.' });
    return sendJSON(res, 200, { friend: friendView(friend) });
  }

  return sendJSON(res, 404, { ok: false, error: 'Unknown route.' });
}

/* ================= server ================= */
const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else {
      serveStatic(req, res, req.url);
    }
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { ok: false, error: 'Server error.' });
  }
});

async function start() {
  // The ledger must be loaded before the first request, because the session
  // signing key is stored in it.
  const bootDB = await initStore();
  setSessionSecret(process.env.SESSION_SECRET || bootDB.sessionSecret);

  server.listen(PORT, () => {
    console.log(`\nThe Ledger is running on port ${PORT}`);
    console.log(`  Admin dashboard:  http://localhost:${PORT}/admin/`);
    console.log(`  Storage:          ${STORE_DESCRIPTION}`);

    const generated = takeGeneratedAdminPassword();
    if (generated) {
      console.log(`\n  ${'='.repeat(52)}`);
      console.log('  FIRST RUN — your admin account has been created:');
      console.log(`    email:    ${bootDB.admin.email}`);
      console.log(`    password: ${generated}`);
      console.log('  This is shown once. Save it now.');
      console.log('  (Set ADMIN_EMAIL / ADMIN_PASSWORD before the first run,');
      console.log('   or run `npm run set-password` to change it later.)');
      console.log(`  ${'='.repeat(52)}\n`);
    }
  });
}

/* Render stops a free instance with SIGTERM when it goes to sleep, so any
   queued write has to reach the database before the process exits. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    closeStore().finally(() => process.exit(0));
  });
}

start().catch((err) => {
  console.error('Could not start The Ledger:', err.message);
  process.exit(1);
});
