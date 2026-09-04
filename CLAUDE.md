# Working in this repo

## Git

Commit and push **directly to `main`**. No feature branches, no pull
requests — the owner wants this kept simple.

## Running

`npm start`, then <http://localhost:3000>. No dependencies to install.

Run `npm test` before pushing; it boots a real server against a
throwaway database and takes a couple of seconds.

## Things to know

- `data/` holds the live ledger, including password hashes. It is
  git-ignored and must stay that way. Never commit it.
- The admin account is seeded on first run only, from `ADMIN_EMAIL` /
  `ADMIN_PASSWORD`, or with a generated password printed once.
- No dependencies. Node's standard library only — keep it that way.
