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
 * #724: Web Push — `push` pokazuje powiadomienie o alercie zapisanego wyszukiwania (payload
 * zaszyfrowany przez serwer: tytuł, ogólna treść, ścieżka panelu, znacznik); `notificationclick`
 * otwiera/aktywuje kartę z tą ścieżką. Adres tylko w tym samym serwisie (ścieżka względna od
 * `/`, bez `//` i schematu) — obcy albo zepsuty adres = strona główna serwisu. Payload bez
 * tytułu = brak powiadomienia. Bez zapisu czegokolwiek na urządzeniu.
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

// --- Web Push (#724) ---------------------------------------------------------
const PUSH_FALLBACK_URL = '/';
const PUSH_MAX_TEXT = 200;

function safePushPath(value) {
  if (typeof value !== 'string' || value.length > 512) return PUSH_FALLBACK_URL;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return PUSH_FALLBACK_URL;
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : PUSH_FALLBACK_URL;
  } catch {
    return PUSH_FALLBACK_URL;
  }
}

function pushText(value) {
  return typeof value === 'string' ? value.slice(0, PUSH_MAX_TEXT) : '';
}

function parsePushMessage(event) {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') return null;
  const title = pushText(data.title);
  if (!title) return null;
  return {
    title,
    body: pushText(data.body),
    url: safePushPath(data.url),
    tag: typeof data.tag === 'string' && /^[a-z0-9-]{1,40}$/.test(data.tag) ? data.tag : undefined,
  };
}

self.addEventListener('push', (event) => {
  const message = parsePushMessage(event);
  if (!message) return;
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: message.tag,
      data: { url: message.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safePushPath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const absolute = new URL(target, self.location.origin).href;
      for (const client of clients) {
        if (client.url === absolute && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
