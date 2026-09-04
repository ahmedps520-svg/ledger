/* =========================================================
   Offline shell for The Ledger.

   Two rules matter here:
   1. /api/ is never touched. Those responses are per-account and
      per-session; caching them would serve one person's ledger to
      another, and would show stale money after a change.
   2. The shell is cached individually rather than with addAll(),
      because addAll() rejects atomically — one missing file and
      the whole service worker fails to install.
   ========================================================= */
const CACHE_NAME = 'ledger-cache-v2';
const ASSETS = [
  '/admin/',
  '/admin/index.html',
  '/admin/app.js',
  '/portal/login.html',
  '/portal/register.html',
  '/portal/dues.html',
  '/portal/portal.js',
  '/shared/styles.css',
  '/manifest.json',
  '/portal/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        ASSETS.map((url) => cache.add(url).catch(() => {
          // A single missing asset shouldn't sink the whole install.
          console.warn('[sw] could not pre-cache', url);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache account data

  // Network-first for pages, so a deployed change shows up immediately
  // and the cache is only a fallback when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/admin/index.html')))
    );
    return;
  }

  // Cache-first for static assets, refreshed in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
