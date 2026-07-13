# The Ledger

A subscription tracker for friends you cover on Spotify, Snapchat, or anything
custom — with a private admin dashboard and a separate self-serve portal for
friends to check only their own dues.

This is now a real client-server app (not just files in a browser), so your
data syncs across every device you sign into. That means it needs to run on
a small server instead of a static host like GitHub Pages.

## What changed from the static version

- **Server**: `server.js` — plain Node.js, zero external dependencies. Stores
  data in `data/db.json` on disk.
- **Admin dashboard**: `public/admin/` — your private login, full control.
- **Friend portal**: `public/portal/` — a *completely separate* app. Friends
  register with the email you linked to them, set their own password, and can
  only ever see their own subscriptions. There is no link from the portal to
  the admin dashboard, and the server rejects any attempt by a friend session
  to reach an admin route (and vice versa).

## Running it locally (to try it out)

```
node server.js
```

Then open:
- Admin: http://localhost:3000/admin/index.html
- Friend portal: http://localhost:3000/portal/login.html

Admin login is `ahmedps520@gmail.com` / the password you gave me — that's
seeded into `data/db.json` the first time the server starts.

## Deploying so it's reachable from all your devices

Because this has a real backend, it needs a host that runs Node — static
hosts (GitHub Pages, Netlify's default tier) won't work. Easiest free/cheap
options:

- **Render** or **Railway**: connect the repo, set the start command to
  `node server.js`, done. Both give you a free HTTPS URL.
- **Fly.io**: `fly launch` in this folder, it detects Node automatically.
- Any VPS: `node server.js` behind a reverse proxy (Caddy/nginx) for HTTPS.

Once it's deployed, install it as a PWA from your phone's browser (Add to
Home Screen) for both the admin dashboard and, separately, the portal link
you send friends — they're independent installable apps.

## Persisting data safely

`data/db.json` is the entire database. On most hosts (Render, Railway, Fly),
attach a small persistent volume/disk to that `data/` folder — otherwise a
redeploy can wipe it. Use the in-app **Backup** button regularly either way;
it exports a JSON file you can restore from.

## Linking a friend so they can see their own dues

1. In the admin dashboard, add or edit a friend and enter their email.
2. Open that friend's card → **Copy invite link** (or **Share invite…** to
   send it directly). It points them to `/portal/register.html` with their
   email pre-filled.
3. They pick a password there — this only works if the email matches one you
   already linked, and only once per email (after that they just log in).
4. They'll only ever see their own name and subscriptions, never anyone
   else's, and never your dashboard.

## Known limitations (worth knowing)

- **No email delivery** — "linking an email" here means matching a string,
  not sending anything. You still need to send the invite link yourself
  (text, WhatsApp, etc.) via the Share button.
- **Single admin only** — there's one hardcoded admin account, by design.
- **No Apple Pay** — still cash-only in person, as discussed; real Apple Pay
  needs a merchant account and payment processor, which doesn't fit a
  self-hosted app like this.
- Session secret is auto-generated into `data/session-secret.txt` on first
  run. If you redeploy to a fresh disk, a new secret is generated and
  everyone's logged out (harmless — they just log back in). To keep sessions
  stable across redeploys, set a `SESSION_SECRET` environment variable
  yourself instead.
