/* =========================================================
   Tiny JSON-file datastore.

   The whole database is a single object held in memory and
   flushed to disk on every write. That matters for more than
   speed: request handlers read the DB *before* awaiting the
   request body, so handing out one shared object is what stops
   two overlapping writes from clobbering each other.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('./auth');

const DB_PATH = process.env.LEDGER_DB
  ? path.resolve(process.env.LEDGER_DB)
  : path.join(__dirname, '..', 'data', 'ledger.json');

let db = null;
/** Password generated on first boot, surfaced once so the server can print it. */
let generatedAdminPassword = null;

function defaultDB() {
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  if (!process.env.ADMIN_PASSWORD) generatedAdminPassword = password;
  return {
    version: 1,
    admin: {
      email: (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase(),
      passwordHash: hashPassword(password)
    },
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    friends: []
  };
}

/** Fill in anything a hand-edited or older DB file is missing. */
function normalise(raw) {
  const out = raw && typeof raw === 'object' ? raw : {};
  if (!out.admin || typeof out.admin !== 'object') out.admin = defaultDB().admin;
  if (!out.admin.email) out.admin.email = 'admin@example.com';
  if (!out.sessionSecret) out.sessionSecret = crypto.randomBytes(32).toString('hex');
  if (!Array.isArray(out.friends)) out.friends = [];
  out.version = 1;
  for (const f of out.friends) {
    if (!Array.isArray(f.subscriptions)) f.subscriptions = [];
    if (typeof f.email !== 'string') f.email = '';
    if (typeof f.note !== 'string') f.note = '';
    if (f.passwordHash === undefined) f.passwordHash = null;
    for (const s of f.subscriptions) {
      if (!s.payments || typeof s.payments !== 'object') s.payments = {};
    }
  }
  return out;
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return normalise(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const fresh = defaultDB();
      persist(fresh);
      return fresh;
    }
    // A corrupt file is kept aside rather than silently overwritten.
    const backup = `${DB_PATH}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(DB_PATH, backup);
      console.error(`Could not parse ${DB_PATH} (${err.message}). Moved it to ${backup} and started fresh.`);
    } catch { /* nothing more we can do */ }
    const fresh = defaultDB();
    persist(fresh);
    return fresh;
  }
}

/** Write via a temp file + rename so a crash mid-write can't truncate the DB. */
function persist(value) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_PATH);
}

function readDB() {
  if (!db) db = load();
  return db;
}

function writeDB(value) {
  db = value || db;
  persist(db);
  return db;
}

/** Only meaningful on the very first boot; null afterwards. */
function takeGeneratedAdminPassword() {
  const p = generatedAdminPassword;
  generatedAdminPassword = null;
  return p;
}

module.exports = { readDB, writeDB, takeGeneratedAdminPassword, DB_PATH };
