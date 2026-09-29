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
 *
 * #1088: nazwy cache zależą od identyfikatora builda przekazanego w adresie rejestracji
 * (`/sw.js?v=<NEXT_PUBLIC_APP_VERSION>`, `ServiceWorkerRegister`). Każde wdrożenie ma inny adres
 * skryptu, więc przeglądarka instaluje nowego workera, a `activate` usuwa cache poprzedniego
 * wdrożenia (hashowane chunki `/_next/static/` z poprzednich wdrożeń nie zostają na urządzeniu).
 * Dodatkowo runtime cache ma twardy limit wpisów (najstarsze wypadają pierwsze).
 * Bez parametru `v` (stary adres rejestracji) obowiązuje stała wersja awaryjna.
 */
const FALLBACK_VERSION = 'v2';
const MAX_RUNTIME_ENTRIES = 300;

function buildVersion() {
  try {
    const raw = new URL(self.location.href).searchParams.get('v') || '';
    const safe = raw.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
    return safe || FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

const VERSION = buildVersion();
const PRECACHE = `precache-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const PRECACHE_URLS = ['/offline.html', '/icon-192.png', '/icon-512.png'];

// Limit wpisów runtime cache: `cache.keys()` zwraca kolejność wstawienia, więc kasujemy najstarsze.
async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_RUNTIME_ENTRIES;
  for (let i = 0; i < excess; i += 1) await cache.delete(keys[i]);
}

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
        if (res && res.ok) {
          await cache.put(request, res.clone());
          await trimRuntimeCache(cache);
        }
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
