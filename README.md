# The Ledger

A subscription tracker for the things you pay for on behalf of friends —
Spotify, Snapchat, or anything custom. You keep the book; each friend gets
a private link showing what they owe.

- **Admin dashboard** (`/admin/`) — add friends, track their subscriptions,
  stamp each month paid or unpaid, and send a nudge. Password protected.
- **Private dues links** (`/f/<link>`) — you send each friend their own
  link. They tap it and see their dues. No account, no password, nothing
  to remember.

Amounts are in **Saudi Riyals**. To change that, edit the two lines at the
top of `public/shared/util.js`.

---

## Putting it online

Two free accounts, about fifteen minutes, no card required.

### 1. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. On the project dashboard, copy the **connection string**. It looks like
   `postgresql://user:password@ep-something.neon.tech/neondb?sslmode=require`.
3. Keep that tab open — you'll paste this in step 2.

The free tier is permanent and far larger than this app will ever need.

### 2. Create the website (Render)

1. Sign up at [render.com](https://render.com) with your GitHub account.
2. **New → Blueprint**, choose the `ledger` repository, and click Apply.
   Render reads `render.yaml` and configures everything itself.
3. It will ask for three values:

   | Name | What to put |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `ADMIN_EMAIL` | your email — this is your login |
   | `ADMIN_PASSWORD` | a password you choose — **this is your login** |

4. Click deploy and wait a few minutes.

Your site is then at **`https://the-ledger.onrender.com`**. If that name is
taken, Render will say so — change `name:` in `render.yaml` to something
else and push.

### 3. Use it

Open `https://the-ledger.onrender.com/admin/` and sign in with the email and
password from step 2. Add a friend, tap **Link**, and send them what's
copied.

From then on, every push to `main` redeploys the site automatically.

### The one catch

On Render's free plan the site sleeps after 15 minutes of no visitors, so
whoever opens it first waits ~40 seconds while it wakes up. Everyone after
that is instant. Upgrading to a paid plan later removes this and changes
nothing else.

---

## Running it on your own computer

You don't need to — the hosted site is the real one — but if you want to:

```bash
npm install
npm start
```

Then open <http://localhost:3000>. With no `DATABASE_URL` set it stores
everything in a local file at `data/ledger.json` instead of Postgres, so it
runs with no database at all.

On the very first run an admin account is created and its password is
printed to the console **once**. To choose your own instead, on Windows
PowerShell:

```powershell
$env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="something-strong"; npm start
```

or on macOS and Linux:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='something-strong' npm start
```

To change it later: `npm run set-password -- you@example.com 'new-password'`

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | *(unset)* | Postgres connection string. Unset = local file |
| `PORT` | `3000` | Port to listen on |
| `LEDGER_DB` | `data/ledger.json` | File location, when not using Postgres |
| `ADMIN_EMAIL` | `admin@example.com` | Admin login, first run only |
| `ADMIN_PASSWORD` | *generated* | Admin password, first run only |
| `SESSION_SECRET` | *stored in the database* | Overrides the cookie signing key |
| `COOKIE_SECURE` | off | Set to `1` when serving over HTTPS |

---

## How the private links work

Each friend has a random 32-character token; their link is
`/f/<token>`. Opening it shows that friend's subscriptions and nothing
else — no other friend's data is ever sent, and the link grants no ability
to change anything.

Treat a link like a house key: anyone holding it can see that one person's
dues. If one goes astray, open the friend's **⋯ → New link**. The old link
stops working immediately.

Exported backups contain everyone's links, so keep the file to yourself.

## Data

Everything is stored as a single JSON document — one row in Postgres when
hosted, one file locally. `data/` is git-ignored and must stay that way; it
holds your admin password hash and everyone's links.

Use **⇅ → Export backup** in the dashboard for a copy you can keep
elsewhere. Backups from the older password-based version still import
cleanly; those friends are given links on import.

## Development

```bash
npm test                                  # end-to-end tests, file backend
DATABASE_URL=postgres://... npm test      # same tests against real Postgres
npm run icons                             # regenerate the app icons
```

The test suite boots a real server against a throwaway database and drives
both the admin and friend flows over HTTP.

## Layout

```
server.js               HTTP server, routing, JSON API
render.yaml             Render deployment blueprint
lib/store.js            storage: Postgres or local JSON file
lib/auth.js             scrypt password hashing, signed session cookies
public/admin/           admin dashboard
public/portal/          the friend's dues page
public/shared/          stylesheet and helpers used by both
scripts/                icon generator, admin password tool
test/smoke.js           end-to-end tests
```

## A note on the old version

The first version of this app kept everything in `localStorage` with the
admin password hashed into `app.js`. That password should be considered
public — anyone who loaded the page could read the hash, and the plaintext
was in a comment beside it. It is no longer used anywhere. If you reused it
elsewhere, change it there.
