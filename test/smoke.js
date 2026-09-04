#!/usr/bin/env node
/* End-to-end check: boots the real server against a throwaway
   database and drives the admin + portal flows over HTTP. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-')), 'db.json');

let passed = 0;
function check(label, cond) {
  assert.ok(cond, `FAILED: ${label}`);
  console.log(`  ok  ${label}`);
  passed++;
}

/* a cookie jar, since auth here is cookie-based */
const jars = { admin: {}, friend: {} };
async function req(jar, method, url, body) {
  const cookie = Object.entries(jars[jar]).map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value === '') delete jars[jar][name];
    else jars[jar][name] = value;
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), LEDGER_DB: DB, ADMIN_EMAIL: 'boss@example.com', ADMIN_PASSWORD: 'secret123' },
  stdio: ['ignore', 'pipe', 'inherit']
});
server.stdout.on('data', () => {});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + '/api/admin/me'); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('server never came up');
}

(async () => {
  await waitForServer();
  console.log('\nstatic files');
  check('/ serves the admin dashboard', (await req('admin', 'GET', '/')).text.includes('The Ledger'));
  check('/portal/ serves the portal login', (await req('admin', 'GET', '/portal/')).text.includes('Sign in'));
  check('stylesheet is served', (await req('admin', 'GET', '/shared/styles.css')).text.includes('--gold'));
  check('admin app.js is served', (await req('admin', 'GET', '/admin/app.js')).status === 200);
  check('portal.js is served', (await req('admin', 'GET', '/portal/portal.js')).status === 200);
  check('icons exist', (await req('admin', 'GET', '/icons/icon-192.png')).status === 200);
  check('service worker is served', (await req('admin', 'GET', '/service-worker.js')).status === 200);
  check('manifest is served', (await req('admin', 'GET', '/manifest.json')).status === 200);
  check('missing file gives 404', (await req('admin', 'GET', '/nope.html')).status === 404);
  check('path traversal is blocked', [403, 404].includes((await req('admin', 'GET', '/../../etc/passwd')).status));

  console.log('\nadmin auth');
  check('locked out before login', (await req('admin', 'GET', '/api/admin/friends')).status === 401);
  check('wrong password rejected', (await req('admin', 'POST', '/api/admin/login', { email: 'boss@example.com', password: 'nope' })).status === 401);
  check('login succeeds', (await req('admin', 'POST', '/api/admin/login', { email: 'BOSS@example.com', password: 'secret123' })).status === 200);
  check('session recognised', (await req('admin', 'GET', '/api/admin/me')).json.loggedIn === true);

  console.log('\nfriends & subscriptions');
  const created = await req('admin', 'POST', '/api/admin/friends', { name: 'Sarah', email: 'Sarah@Example.com', note: 'roommate' });
  check('friend created', created.status === 201 && created.json.friend.name === 'Sarah');
  check('email normalised to lowercase', created.json.friend.email === 'sarah@example.com');
  check('password hash never leaves the server', created.json.friend.passwordHash === undefined);
  const fid = created.json.friend.id;

  check('duplicate email rejected', (await req('admin', 'POST', '/api/admin/friends', { name: 'Dupe', email: 'sarah@example.com' })).status === 400);
  check('nameless friend rejected', (await req('admin', 'POST', '/api/admin/friends', { name: '  ' })).status === 400);

  const sub = await req('admin', 'POST', `/api/admin/friends/${fid}/subscriptions`, { service: 'Spotify', price: '5.99', dueDay: '5' });
  check('subscription added', sub.status === 201 && sub.json.friend.subscriptions.length === 1);
  const sid = sub.json.friend.subscriptions[0].id;
  check('price coerced to a number', sub.json.friend.subscriptions[0].price === 5.99);

  const mk = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const paid = await req('admin', 'POST', `/api/admin/friends/${fid}/subscriptions/${sid}/toggle`);
  check('toggle marks paid for this month', paid.json.friend.subscriptions[0].payments[mk].paid === true);
  const unpaid = await req('admin', 'POST', `/api/admin/friends/${fid}/subscriptions/${sid}/toggle`);
  check('toggle again marks unpaid', unpaid.json.friend.subscriptions[0].payments[mk].paid === false);

  const edited = await req('admin', 'PUT', `/api/admin/friends/${fid}/subscriptions/${sid}`, { service: 'Custom', customLabel: 'YouTube', price: 11.5 });
  check('subscription edited', edited.json.friend.subscriptions[0].customLabel === 'YouTube');
  check('unknown friend gives 404', (await req('admin', 'PUT', '/api/admin/friends/deadbeef', { name: 'X' })).status === 404);

  console.log('\nfriend portal');
  check('dues need a session', (await req('friend', 'GET', '/api/portal/dues')).status === 401);
  check('unknown email cannot register', (await req('friend', 'POST', '/api/portal/register', { email: 'ghost@example.com', password: 'letmein1' })).status === 404);
  check('short password rejected', (await req('friend', 'POST', '/api/portal/register', { email: 'sarah@example.com', password: 'abc' })).status === 400);
  check('registration succeeds', (await req('friend', 'POST', '/api/portal/register', { email: 'sarah@example.com', password: 'letmein1' })).status === 200);
  check('double registration rejected', (await req('friend', 'POST', '/api/portal/register', { email: 'sarah@example.com', password: 'letmein1' })).status === 400);

  const dues = await req('friend', 'GET', '/api/portal/dues');
  check('friend sees their own dues', dues.status === 200 && dues.json.friend.name === 'Sarah');
  check('friend sees their subscription', dues.json.friend.subscriptions[0].customLabel === 'YouTube');
  check('friend cannot reach admin routes', (await req('friend', 'GET', '/api/admin/friends')).status === 401);

  await req('friend', 'POST', '/api/portal/logout');
  check('logout clears the session', (await req('friend', 'GET', '/api/portal/dues')).status === 401);
  check('wrong portal password rejected', (await req('friend', 'POST', '/api/portal/login', { email: 'sarah@example.com', password: 'wrong' })).status === 401);
  check('portal login works', (await req('friend', 'POST', '/api/portal/login', { email: 'sarah@example.com', password: 'letmein1' })).status === 200);

  console.log('\nbackup & persistence');
  const exported = await req('admin', 'GET', '/api/admin/export');
  check('export returns the ledger', exported.json.friends.length === 1);
  check('bad import rejected', (await req('admin', 'POST', '/api/admin/import', { friends: 'nope' })).status === 400);
  check('import restores data', (await req('admin', 'POST', '/api/admin/import', { friends: exported.json.friends })).status === 200);
  check('friend keeps portal access through an import', (await req('friend', 'GET', '/api/portal/dues')).status === 200);

  const onDisk = JSON.parse(fs.readFileSync(DB, 'utf8'));
  check('data persisted to disk', onDisk.friends[0].name === 'Sarah');
  check('friend password stored hashed', /^scrypt\$/.test(onDisk.friends[0].passwordHash));
  check('admin password stored hashed', /^scrypt\$/.test(onDisk.admin.passwordHash) && !JSON.stringify(onDisk).includes('secret123'));

  await req('admin', 'POST', '/api/admin/logout');
  check('admin logout works', (await req('admin', 'GET', '/api/admin/friends')).status === 401);

  console.log(`\n${passed} checks passed\n`);
})()
  .catch((err) => { console.error(`\n${err.message}\n`); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(path.dirname(DB), { recursive: true, force: true }); });
