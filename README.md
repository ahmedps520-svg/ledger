# The Ledger

A subscription tracker for the things you pay for on behalf of friends —
Spotify, Snapchat, or anything custom. You keep the book; they can check
what they owe without asking you.

Two front ends on one small Node server:

- **Admin dashboard** (`/admin/`) — add friends, track their subscriptions,
  stamp each month paid or unpaid, and send a nudge.
- **Friend portal** (`/portal/`) — friends sign in and see only their own
  dues.

No frameworks and no dependencies: just Node's standard library.

## Running it

```bash
npm start
```

Then open <http://localhost:3000>.

On the very first run an admin account is created and its password is
printed to the console **once** — save it. To choose your own instead:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='something-strong' npm start
```

To change it later:

```bash
npm run set-password -- you@example.com 'new-password'
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `LEDGER_DB` | `data/ledger.json` | Where the ledger is stored |
| `ADMIN_EMAIL` | `admin@example.com` | Admin login, first run only |
| `ADMIN_PASSWORD` | *generated* | Admin password, first run only |
| `SESSION_SECRET` | *generated & stored* | Overrides the stored cookie signing key |
| `COOKIE_SECURE` | off | Set to `1` when serving over HTTPS |

## Giving a friend portal access

1. Add the friend with their email address, or add the email later via **⋯ → Edit**.
2. Use **Copy portal invite** to get the link to send them.
3. They visit `/portal/register.html`, enter that same email and choose a
   password. Their card in the dashboard then shows a **portal** badge.

A friend can only ever see their own row, and only the admin can change
anything. Changing a friend's email clears their password, so they will
need to register again.

## Data

Everything lives in one JSON file (`data/ledger.json` by default), written
atomically. It holds password hashes and your friends' details, so it is
**git-ignored** — don't commit it. Use **⇅ → Export backup** in the
dashboard for a copy you can keep elsewhere; exports contain no password
hashes, and importing one preserves the portal logins your friends already
set up.

## Development

```bash
npm test     # end-to-end API tests against a throwaway database
npm run icons # regenerate the app icons from scripts/generate-icons.js
```

## Layout

```
server.js               HTTP server, routing, JSON API
lib/store.js            JSON-file datastore
lib/auth.js             scrypt password hashing, signed session cookies
public/admin/           admin dashboard
public/portal/          friend portal
public/shared/          stylesheet shared by both
scripts/                icon generator, admin password tool
test/smoke.js           end-to-end tests
```

## A note on the old version

An earlier version of this app kept everything in `localStorage` with the
admin password hashed into `app.js`. That password should be considered
public — anyone who loaded the page could read the hash, and the plaintext
was in a comment beside it. It is no longer used anywhere: passwords are
now hashed with scrypt and stored server-side. If you reused that password
elsewhere, change it there.

Backups exported from that version still import cleanly.
