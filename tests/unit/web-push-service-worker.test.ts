// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

/**
 * #724 — obsługa `push` i `notificationclick` w `public/sw.js`. Powiadomienie tylko z tytułem
 * z payloadu, adres tylko w tym samym serwisie (obcy / `//` / schemat → strona główna),
 * kliknięcie aktywuje kartę z tym adresem albo otwiera nową. Kontrole ujemne: brak tytułu,
 * zepsuty JSON, obcy adres.
 */

const SOURCE = readFileSync('public/sw.js', 'utf8');
type Handler = (event: Record<string, unknown>) => void;

function loadWorker() {
  const handlers = new Map<string, Handler>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const focused: string[] = [];
  let windows: Array<{ url: string; focus: () => Promise<void> }> = [];
  const self = {
    location: { href: 'https://pracuj.be/sw.js?v=1', origin: 'https://pracuj.be' },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(SOURCE, { self, caches: {}, URL, fetch: async () => undefined, Promise });
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> | undefined;
    handlers.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  const setWindows = (urls: string[]) => {
    windows = urls.map((url) => ({ url, focus: async () => void focused.push(url) }));
  };
  return { dispatch, shown, opened, focused, setWindows };
}

const pushEvent = (data: unknown) => ({
  data: { json: () => (typeof data === 'string' ? JSON.parse(data) : data) },
});

describe('Service Worker — Web Push', () => {
  it('pokazuje powiadomienie z payloadu i zapamiętuje ścieżkę panelu', async () => {
    const w = loadWorker();
    await w.dispatch('push', pushEvent({ title: 'Nowe oferty', body: 'Nowe oferty: 3', url: '/pl/candidate/wyszukiwania', tag: 'saved-search-alert' }));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.title).toBe('Nowe oferty');
    expect(w.shown[0]!.options).toMatchObject({ body: 'Nowe oferty: 3', tag: 'saved-search-alert', data: { url: '/pl/candidate/wyszukiwania' } });
  });

  it.each(['https://evil.example/phish', '//evil.example/phish', 'javascript:alert(1)', '/\\evil.example'])(
    'kontrola ujemna: adres spoza serwisu (%s) → strona główna',
    async (url) => {
      const w = loadWorker();
      await w.dispatch('push', pushEvent({ title: 'X', url }));
      expect((w.shown[0]!.options['data'] as { url: string }).url).toBe('/');
    },
  );

  it('kontrola ujemna: bez tytułu albo z zepsutym payloadem — brak powiadomienia', async () => {
    const w = loadWorker();
    await w.dispatch('push', pushEvent({ body: 'bez tytułu' }));
    await w.dispatch('push', { data: { json: () => { throw new SyntaxError('bad'); } } });
    await w.dispatch('push', { data: null });
    expect(w.shown).toHaveLength(0);
  });

  it('kliknięcie: aktywuje kartę z tym adresem albo otwiera nową', async () => {
    const w = loadWorker();
    let closed = 0;
    const notification = { close: () => void (closed += 1), data: { url: '/nl/candidate/wyszukiwania' } };
    w.setWindows(['https://pracuj.be/nl/candidate/wyszukiwania']);
    await w.dispatch('notificationclick', { notification });
    expect(w.focused).toEqual(['https://pracuj.be/nl/candidate/wyszukiwania']);
    w.setWindows([]);
    await w.dispatch('notificationclick', { notification });
    expect(w.opened).toEqual(['/nl/candidate/wyszukiwania']);
    expect(closed).toBe(2);
    // Kontrola ujemna: obcy adres w danych powiadomienia nie jest otwierany.
    await w.dispatch('notificationclick', { notification: { close: () => undefined, data: { url: 'https://evil.example' } } });
    expect(w.opened.at(-1)).toBe('/');
  });
});
