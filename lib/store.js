/* =========================================================
   Where the ledger lives.

   Two interchangeable backends behind one interface:
     - Postgres, when DATABASE_URL is set (how it runs hosted)
     - a local JSON file otherwise (how it runs on your machine)

   Either way the whole ledger is held in memory as one object and
   the file/row is rewritten on each change. That keeps readDB()
   synchronous, which matters: request handlers read the ledger
   before awaiting the request body, so handing out one shared
   object is what stops two overlapping writes losing each other.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('./auth');

const DB_PATH = process.env.LEDGER_DB
  ? path.resolve(process.env.LEDGER_DB)
  : path.join(__dirname, '..', 'data', 'ledger.json');

const USING_POSTGRES = !!process.env.DATABASE_URL;

let db = null;
let generatedAdminPassword = null;
let pool = null;
/** Writes are chained so they can never be applied out of order. */
let writeChain = Promise.resolve();

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

function defaultDB() {
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  if (!process.env.ADMIN_PASSWORD) generatedAdminPassword = password;
  return {
    version: 2,
    admin: {
      email: (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase(),
      passwordHash: hashPassword(password)
    },
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    friends: []
  };
}

/** Fill in anything an older or hand-edited ledger is missing. */
function normalise(raw) {
  const out = raw && typeof raw === 'object' ? raw : {};
  if (!out.admin || typeof out.admin !== 'object') out.admin = defaultDB().admin;
  if (!out.admin.email) out.admin.email = 'admin@example.com';
  if (!out.sessionSecret) out.sessionSecret = crypto.randomBytes(32).toString('hex');
  if (!Array.isArray(out.friends)) out.friends = [];
  out.version = 2;
  for (const f of out.friends) {
    if (!Array.isArray(f.subscriptions)) f.subscriptions = [];
    if (typeof f.email !== 'string') f.email = '';
    if (typeof f.note !== 'string') f.note = '';
    // v1 friends signed in with a password; v2 uses a private link.
    if (typeof f.token !== 'string' || f.token.length < 16) f.token = newToken();
    delete f.passwordHash;
    for (const s of f.subscriptions) {
      if (!s.payments || typeof s.payments !== 'object') s.payments = {};
    }
  }
  return out;
}

/* ================= file backend ================= */
const fileBackend = {
  async load() {
    try {
      return normalise(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
    } catch (err) {
      if (err.code === 'ENOENT') {
        const fresh = defaultDB();
        await fileBackend.save(fresh);
        return fresh;
      }
      // A corrupt ledger is set aside rather than silently overwritten.
      const backup = `${DB_PATH}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(DB_PATH, backup);
        console.error(`Could not parse ${DB_PATH} (${err.message}). Moved it to ${backup} and started fresh.`);
      } catch { /* nothing more we can do */ }
      const fresh = defaultDB();
      await fileBackend.save(fresh);
      return fresh;
    }
  },
  async save(value) {
    // temp file + rename, so a crash mid-write cannot truncate the ledger
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const tmp = `${DB_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, DB_PATH);
  },
  async close() {}
};

/* ================= postgres backend ================= */
/* The ledger is small and always read whole, so it lives as a single
   JSONB row rather than being spread over relational tables. */
const pgBackend = {
  async load() {
    const { Pool } = require('pg');
    const url = process.env.DATABASE_URL;
    const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    pool = new Pool({
      connectionString: url,
      // Neon and other managed providers present publicly-trusted
      // certificates, so verify them: without this the connection would
      // accept any certificate and could be read in transit. Providers
      // that issue their own (some self-hosted setups) need the opt-out.
      ssl: isLocal ? false : { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== '1' },
      max: 4,
      idleTimeoutMillis: 30_000
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ledger (
        id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        data       jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await pool.query('SELECT data FROM ledger WHERE id = 1');
    if (rows.length) return normalise(rows[0].data);
    const fresh = defaultDB();
    await pgBackend.save(fresh);
    return fresh;
  },
  async save(value) {
    await pool.query(
      `INSERT INTO ledger (id, data, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [JSON.stringify(value)]
    );
  },
  async close() {
    if (pool) await pool.end();
    pool = null;
  }
};

const backend = USING_POSTGRES ? pgBackend : fileBackend;

/* ================= public interface ================= */

/** Must be awaited once at boot, before any request is served. */
async function initStore() {
  db = await backend.load();
  return db;
}

function readDB() {
  if (!db) throw new Error('Store not initialised — await initStore() first.');
  return db;
}

/** Persists the current ledger. Returns a promise, but callers may ignore
    it: writes are queued in order and flushed before shutdown. */
function writeDB(value) {
  db = value || db;
  const snapshot = JSON.parse(JSON.stringify(db));
  writeChain = writeChain
    .then(() => backend.save(snapshot))
    .catch((err) => { console.error('Failed to persist the ledger:', err.message); });
  return writeChain;
}

/** Waits for queued writes to land. Called on shutdown. */
function flush() {
  return writeChain;
}

async function closeStore() {
  await flush();
  await backend.close();
}

function takeGeneratedAdminPassword() {
  const p = generatedAdminPassword;
  generatedAdminPassword = null;
  return p;
}

const STORE_DESCRIPTION = USING_POSTGRES ? 'Postgres (DATABASE_URL)' : DB_PATH;

module.exports = {
  initStore, readDB, writeDB, flush, closeStore,
  takeGeneratedAdminPassword, newToken,
  DB_PATH, STORE_DESCRIPTION, USING_POSTGRES
};
