# Working in this repo

## Git

Commit and push **directly to `main`**. No feature branches, no pull
requests — the owner wants this kept simple.

## Running

`npm start`, then <http://localhost:3000>. No dependencies to install.

Run `npm test` before pushing; it boots a real server against a
throwaway database and takes a couple of seconds.

## Things to know

- Storage is Postgres when `DATABASE_URL` is set (production, on Render)
  and a local JSON file otherwise. Both are behind `lib/store.js`.
- `data/` holds the local ledger, including the admin password hash and
  friends' private links. It is git-ignored and must stay that way.
- Friends authenticate by a private link token, not a password. Never log
  a token or put one in an error message.
- The admin account is seeded on first run only, from `ADMIN_EMAIL` /
  `ADMIN_PASSWORD`, or with a generated password printed once.
- One dependency, `pg`, used only by the Postgres backend. Don't add more
  without good reason.
- Amounts are Saudi Riyals; the currency is set in `public/shared/util.js`.
