const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readDB, writeDB } = require('./lib/store');
const {
  hashPassword, verifyPassword,
  verifySession, parseCookies,
  makeSessionCookie, clearSessionCookie
} = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_COOKIE = 'ledger_admin_session';
const FRIEND_COOKIE = 'ledger_friend_session';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
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
function getFriendSession(req) {
  const cookies = parseCookies(req);
  const payload = verifySession(cookies[FRIEND_COOKIE]);
  return payload && payload.role === 'friend' ? payload : null;
}

function publicFriend(f) {
  // never send the password hash to the client
  const { passwordHash, ...rest } = f;
  return { ...rest, registered: !!passwordHash };
}

/* ================= static file serving ================= */
function serveStatic(req, res, urlPath) {
  let filePath = decodeURIComponent(urlPath.split('?')[0]);
  if (filePath === '/') filePath = '/admin/index.html';
  if (filePath === '/admin' || filePath === '/admin/') filePath = '/admin/index.html';
  if (filePath === '/portal' || filePath === '/portal/') filePath = '/portal/login.html';

  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!resolved.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
    if (email && password && email.trim().toLowerCase() === db.admin.email.toLowerCase() &&
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
      return sendJSON(res, 200, { friends: db.friends.map(publicFriend) });
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
        passwordHash: null, subscriptions: []
      };
      db.friends.push(friend);
      writeDB(db);
      return sendJSON(res, 201, { friend: publicFriend(friend) });
    }

    const friendMatch = pathname.match(/^\/api\/admin\/friends\/([a-f0-9]+)$/);
    if (friendMatch && (method === 'PUT' || method === 'DELETE')) {
      const friend = db.friends.find(f => f.id === friendMatch[1]);
      if (!friend) return sendJSON(res, 404, { ok: false, error: 'Friend not found.' });
      if (method === 'DELETE') {
        db.friends = db.friends.filter(f => f.id !== friend.id);
        writeDB(db);
        return sendJSON(res, 200, { ok: true });
      }
      const { name, note, email } = await readBody(req);
      if (email !== undefined && email.trim() &&
          db.friends.some(f => f.id !== friend.id && f.email && f.email.toLowerCase() === email.trim().toLowerCase())) {
        return sendJSON(res, 400, { ok: false, error: 'That email is already linked to another friend.' });
      }
      if (name !== undefined) friend.name = name.trim() || friend.name;
      if (note !== undefined) friend.note = note.trim();
      if (email !== undefined) {
        const newEmail = email.trim().toLowerCase();
        if (newEmail !== friend.email) friend.passwordHash = null; // email changed -> re-registration required
        friend.email = newEmail;
      }
      writeDB(db);
      return sendJSON(res, 200, { friend: publicFriend(friend) });
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
      writeDB(db);
      return sendJSON(res, 201, { friend: publicFriend(friend) });
    }

    const subMatch = pathname.match(/^\/api\/admin\/friends\/([a-f0-9]+)\/subscriptions\/([a-f0-9]+)$/);
    if (subMatch && (method === 'PUT' || method === 'DELETE')) {
      const friend = db.friends.find(f => f.id === subMatch[1]);
      if (!friend) return sendJSON(res, 404, { ok: false, error: 'Friend not found.' });
      const sub = friend.subscriptions.find(s => s.id === subMatch[2]);
      if (!sub) return sendJSON(res, 404, { ok: false, error: 'Subscription not found.' });
      if (method === 'DELETE') {
        friend.subscriptions = friend.subscriptions.filter(s => s.id !== sub.id);
        writeDB(db);
        return sendJSON(res, 200, { ok: true });
      }
      const { service, customLabel, price, dueDay } = await readBody(req);
      if (service !== undefined) sub.service = service;
      if (customLabel !== undefined) sub.customLabel = sub.service === 'Custom' ? customLabel.trim() : '';
      if (price !== undefined) sub.price = parseFloat(price) || 0;
      if (dueDay !== undefined) sub.dueDay = dueDay ? parseInt(dueDay, 10) : null;
      writeDB(db);
      return sendJSON(res, 200, { friend: publicFriend(friend) });
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
      writeDB(db);
      return sendJSON(res, 200, { friend: publicFriend(friend) });
    }

    if (pathname === '/api/admin/export' && method === 'GET') {
      return sendJSON(res, 200, { friends: db.friends.map(publicFriend), exportedAt: new Date().toISOString() });
    }

    if (pathname === '/api/admin/import' && method === 'POST') {
      const { friends } = await readBody(req);
      if (!Array.isArray(friends)) return sendJSON(res, 400, { ok: false, error: 'Invalid backup file.' });
      // preserve any existing password hashes for friends whose id+email still match
      const byId = new Map(db.friends.map(f => [f.id, f]));
      db.friends = friends.map(f => ({
        id: f.id || uid(),
        name: f.name || 'Unnamed',
        note: f.note || '',
        email: (f.email || '').toLowerCase(),
        subscriptions: Array.isArray(f.subscriptions) ? f.subscriptions : [],
        passwordHash: byId.has(f.id) ? byId.get(f.id).passwordHash : null
      }));
      writeDB(db);
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { ok: false, error: 'Unknown admin route.' });
  }

  /* ---- friend registration & login ---- */
  if (pathname === '/api/portal/register' && method === 'POST') {
    const { email, password } = await readBody(req);
    if (!email || !password || password.length < 6) {
      return sendJSON(res, 400, { ok: false, error: 'Enter your email and a password of at least 6 characters.' });
    }
    const db = readDB();
    const friend = db.friends.find(f => f.email && f.email.toLowerCase() === email.trim().toLowerCase());
    if (!friend) return sendJSON(res, 404, { ok: false, error: "That email hasn't been added by the admin yet." });
    if (friend.passwordHash) return sendJSON(res, 400, { ok: false, error: 'This account is already registered — log in instead.' });
    friend.passwordHash = hashPassword(password);
    writeDB(db);
    const cookie = makeSessionCookie(FRIEND_COOKIE, { role: 'friend', id: friend.id });
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (pathname === '/api/portal/login' && method === 'POST') {
    const { email, password } = await readBody(req);
    const db = readDB();
    const friend = db.friends.find(f => f.email && f.email.toLowerCase() === (email || '').trim().toLowerCase());
    if (!friend || !friend.passwordHash || !verifyPassword(password || '', friend.passwordHash)) {
      return sendJSON(res, 401, { ok: false, error: 'Incorrect email or password.' });
    }
    const cookie = makeSessionCookie(FRIEND_COOKIE, { role: 'friend', id: friend.id });
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (pathname === '/api/portal/logout' && method === 'POST') {
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(FRIEND_COOKIE) });
  }

  if (pathname === '/api/portal/dues' && method === 'GET') {
    const session = getFriendSession(req);
    if (!session) return sendJSON(res, 401, { ok: false, error: 'Not signed in.' });
    const db = readDB();
    const friend = db.friends.find(f => f.id === session.id);
    if (!friend) return sendJSON(res, 404, { ok: false, error: 'Account not found.' });
    return sendJSON(res, 200, { friend: publicFriend(friend) });
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

server.listen(PORT, () => {
  console.log(`The Ledger server running at http://localhost:${PORT}`);
  console.log(`Admin dashboard:  http://localhost:${PORT}/admin/index.html`);
  console.log(`Friend portal:    http://localhost:${PORT}/portal/login.html`);
});
