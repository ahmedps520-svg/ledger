/* =========================================================
   Password hashing + signed session cookies.
   Uses only Node's built-in crypto — no dependencies.
   ========================================================= */
const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ---------------- passwords ---------------- */

/** Hash a password with scrypt. Returns "scrypt$<salt-hex>$<hash-hex>". */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time check of a password against a stored hash. */
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  let expected;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* ---------------- sessions ---------------- */
/* A session cookie is  base64url(JSON payload) + "." + base64url(HMAC).
   The payload carries an `exp` timestamp, so a stolen cookie eventually
   dies on its own and the signature stops anyone editing the payload. */

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

let secret = null;
/** Called once at boot with the persisted (or env-supplied) signing secret. */
function setSessionSecret(value) {
  secret = Buffer.from(String(value), 'utf8');
}

function sign(data) {
  if (!secret) throw new Error('Session secret not initialised — call setSessionSecret() first.');
  return crypto.createHmac('sha256', secret).update(data).digest();
}

function createSession(payload, ttlMs = SESSION_TTL_MS) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  return `${body}.${b64url(sign(body))}`;
}

/** Returns the payload if the token is well-formed, correctly signed and unexpired. */
function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const givenSig = fromB64url(token.slice(dot + 1));
  const wantSig = sign(body);
  if (givenSig.length !== wantSig.length || !crypto.timingSafeEqual(givenSig, wantSig)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}

/* ---------------- cookies ---------------- */

function parseCookies(req) {
  const out = {};
  const header = req.headers && req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/* Secure is opt-in: it would break plain-http use on localhost, which is
   how this is normally run. Set COOKIE_SECURE=1 when serving over HTTPS. */
const SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';

function makeSessionCookie(name, payload) {
  const value = createSession(payload);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE}`;
}

function clearSessionCookie(name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE}`;
}

module.exports = {
  hashPassword, verifyPassword,
  setSessionSecret, createSession, verifySession,
  parseCookies, makeSessionCookie, clearSessionCookie
};
