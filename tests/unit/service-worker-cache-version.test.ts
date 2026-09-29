// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { serviceWorkerUrl } from '@/components/pwa/ServiceWorkerRegister';

/**
 * #1088 — nazwy cache Service Workera zależą od identyfikatora builda z adresu rejestracji,
 * `activate` usuwa cache poprzednich wdrożeń, a runtime cache ma limit wpisów.
 */

const SOURCE = readFileSync('public/sw.js', 'utf8');

type Handler = (event: unknown) => void;

class FakeCache {
  readonly entries = new Map<string, string>();
  async addAll(urls: string[]) {
    for (const url of urls) this.entries.set(url, 'precached');
  }
  async match(request: { url?: string } | string) {
    return this.entries.get(typeof request === 'string' ? request : request.url!);
  }
  async put(request: { url: string }, response: unknown) {
    this.entries.delete(request.url); // ponowny zapis = nowy koniec kolejki, jak w Cache API
    this.entries.set(request.url, response as string);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(request: { url: string }) {
    return this.entries.delete(request.url);
  }
}

function loadWorker(location: string, existing: string[] = []) {
  const stores = new Map<string, FakeCache>(existing.map((name) => [name, new FakeCache()]));
  const handlers = new Map<string, Handler>();
  const self = {
    location: { href: location, origin: new URL(location).origin },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name)!;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  const fetchMock = async () => ({ ok: true, clone: () => 'body' });
  runInNewContext(SOURCE, { self, caches, URL, fetch: fetchMock, Promise });
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> | undefined;
    handlers.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p), respondWith: (p: Promise<unknown>) => (pending = p) });
    return pending;
  };
  return { stores, dispatch };
}

describe('Service Worker — wersja cache z adresu rejestracji', () => {
  it('używa identyfikatora builda w nazwach cache i po aktywacji usuwa cache poprzednich wdrożeń', async () => {
    const { stores, dispatch } = loadWorker('https://pracuj.be/sw.js?v=0.20260928.1%2Babc123', [
      'runtime-0.20260927.4-def456',
      'precache-0.20260927.4-def456',
      'runtime-v2',
    ]);
    await dispatch('install', {});
    expect([...stores.keys()]).toContain('precache-0.20260928.1-abc123');
    await dispatch('activate', {});
    expect([...stores.keys()].sort()).toEqual(['precache-0.20260928.1-abc123']);
  });

  it('kontrola ujemna: adres bez parametru v używa stałej wersji awaryjnej', async () => {
    const { stores, dispatch } = loadWorker('https://pracuj.be/sw.js');
    await dispatch('install', {});
    expect([...stores.keys()]).toEqual(['precache-v2']);
  });

  it('parametr v jest oczyszczany i obcinany do 64 znaków', async () => {
    const { stores, dispatch } = loadWorker(`https://pracuj.be/sw.js?v=${encodeURIComponent('a b/../c'.padEnd(200, 'x'))}`);
    await dispatch('install', {});
    const [name] = [...stores.keys()];
    expect(name).toMatch(/^precache-[A-Za-z0-9._-]{1,64}$/);
  });

  it('runtime cache ma limit wpisów — najstarsze wypadają pierwsze', async () => {
    const { stores, dispatch } = loadWorker('https://pracuj.be/sw.js?v=b1');
    for (let i = 0; i < 305; i += 1) {
      await dispatch('fetch', {
        request: { method: 'GET', mode: 'no-cors', url: `https://pracuj.be/_next/static/chunks/c${i}.js` },
      });
    }
    const runtime = stores.get('runtime-b1')!;
    expect(runtime.entries.size).toBe(300);
    expect(runtime.entries.has('https://pracuj.be/_next/static/chunks/c0.js')).toBe(false);
    expect(runtime.entries.has('https://pracuj.be/_next/static/chunks/c304.js')).toBe(true);
  });
});

describe('serviceWorkerUrl', () => {
  it('dokłada zakodowany identyfikator builda', () => {
    expect(serviceWorkerUrl('1.0.0+abc')).toBe('/sw.js?v=1.0.0%2Babc');
  });

  it.each([undefined, '', '   '])('kontrola ujemna: %j = goły /sw.js', (version) => {
    expect(serviceWorkerUrl(version)).toBe('/sw.js');
  });
});
