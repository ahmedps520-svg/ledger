#!/usr/bin/env node
/* Change the admin email / password on an existing ledger.
   Usage: npm run set-password -- <email> [password]
   With no password given, a strong one is generated and printed. */
const crypto = require('crypto');
const { initStore, readDB, writeDB, closeStore, STORE_DESCRIPTION } = require('../lib/store');
const { hashPassword } = require('../lib/auth');

const [email, given] = process.argv.slice(2);
if (!email || !email.includes('@')) {
  console.error('Usage: npm run set-password -- <email> [password]');
  process.exit(1);
}

const password = given || crypto.randomBytes(9).toString('base64url');

(async () => {
  await initStore();
  const db = readDB();
  db.admin.email = email.trim().toLowerCase();
  db.admin.passwordHash = hashPassword(password);
  await writeDB(db);
  await closeStore();

  console.log(`Updated ${STORE_DESCRIPTION}`);
  console.log(`  email:    ${db.admin.email}`);
  console.log(`  password: ${password}`);
  if (!given) console.log('\nThis generated password is shown once. Save it now.');
})().catch((err) => { console.error(err.message); process.exit(1); });
