/*
 * Service Worker — Pracuj.be (PWA)
 *
 * Zakres CELOWO wąski i bezpieczny dla portalu z sesjami:
 *  - precache: strona offline + ikony,
 *  - runtime cache-first TYLKO dla niezmiennych assetów build ( /_next/static/ ) i fontów,
 *  - nawigacje: network-first, a przy braku sieci -> strona offline.
 *
 * NIE cache'ujemy dynamicznego/uwierzytelnionego HTML (ryzyko podania nieaktualnej,
 * cudzej treści panelu) ani żądań POST/API. Bez trackingu.
 */
const VERSION = 'v2';
const PRECACHE = `precache-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const PRECACHE_URLS = ['/offline.html', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PRECACHE).then((c) => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // nie ruszaj POST/PUT/API mutujących

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // tylko własny origin

  // Niezmienne assety builda + fonty: cache-first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  // Nawigacje (dokumenty): network-first, fallback offline.html.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
});
