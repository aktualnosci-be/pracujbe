// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseClientErrorPayload } from '@/lib/client-error/payload';
import { CLIENT_ERROR_MAX_PER_TAB, clientRoute, createClientErrorReporter, isOwnScriptError } from '@/lib/client-error/reporter';
import { buildErrorWebhookText, createErrorWebhookSender } from '@/lib/error-webhook';

/**
 * Błędy z przeglądarki (#502): `POST /api/client-error` przyjmuje wyłącznie kod, trasę
 * i wydanie; obcy Origin = 403, pole spoza listy (np. `message`/`stack`) = 400 bez wysyłki,
 * brak `ERROR_WEBHOOK_URL` = 204 bez wysyłki. Adres webhooka nie trafia do kodu klienta.
 */

const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789';
const PII_EMAIL = 'jan.kowalski@example.com';

describe('parseClientErrorPayload', () => {
  it('przyjmuje kod ze słownika, trasę i wydanie', () => {
    expect(parseClientErrorPayload({ code: 'NOT_FOUND', route: '/pl/oferty-pracy', release: '0.20260926.1+abc123' })).toEqual({
      code: 'NOT_FOUND',
      route: '/pl/oferty-pracy',
      release: '0.20260926.1+abc123',
    });
  });

  it('kod spoza ErrorCodes → INTERNAL; nieprawidłowe wydanie pominięte', () => {
    expect(parseClientErrorPayload({ code: `Cannot read ${PII_EMAIL}`, route: '/pl', release: 'v 1 <script>' })).toEqual({
      code: 'INTERNAL',
      route: '/pl',
    });
  });

  it('trasa bez query, fragmentu i segmentów z danymi osobowymi', () => {
    const parsed = parseClientErrorPayload({
      code: 'INTERNAL',
      route: `/pl/kontakt/${PII_EMAIL}?email=${PII_EMAIL}#token=abcdefghijklmnopqrstuvwxyz0123456789`,
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.route).not.toContain(PII_EMAIL);
    expect(parsed!.route).not.toMatch(/[?#]/);
    expect(parsed!.route.startsWith('/pl/kontakt/')).toBe(true);
  });

  it('kontrola ujemna: payload z message/stack (PII) jest odrzucony w całości', () => {
    expect(parseClientErrorPayload({ code: 'INTERNAL', route: '/pl', message: `Hello ${PII_EMAIL}` })).toBeNull();
    expect(parseClientErrorPayload({ code: 'INTERNAL', stack: 'at foo (x.js:1:1)' })).toBeNull();
    expect(parseClientErrorPayload({ code: 'INTERNAL', userId: 'u1' })).toBeNull();
    expect(parseClientErrorPayload(['INTERNAL'])).toBeNull();
    expect(parseClientErrorPayload({ route: '/pl' })).toBeNull();
    expect(parseClientErrorPayload({ code: 'x'.repeat(65) })).toBeNull();
    expect(parseClientErrorPayload({ code: 'INTERNAL', route: `/${'a'.repeat(600)}` })).toBeNull();
  });
});

describe('wiadomość i deduplikacja dla źródła client', () => {
  it('nagłówek „błąd w przeglądarce”, wydanie z karty', async () => {
    const calls: string[] = [];
    const sender = createErrorWebhookSender({
      target: () => ({ url: WEBHOOK, format: 'discord' }),
      fetch: async (_url, init) => {
        calls.push(String(init?.body));
        return new Response(null, { status: 204 });
      },
      release: () => 'server-release',
    });
    expect(await sender.send({ code: 'INTERNAL', route: '/pl', source: 'client', release: 'tab-release' })).toBe('sent');
    const content = (JSON.parse(calls[0]!) as { content: string }).content;
    expect(content).toContain('błąd w przeglądarce');
    expect(content).toContain('Wydanie: tab-release');
    // Błąd serwera o tym samym kodzie ma osobne okno deduplikacji.
    expect(await sender.send({ code: 'INTERNAL' })).toBe('sent');
    expect(await sender.send({ code: 'INTERNAL', source: 'client' })).toBe('deduplicated');
    expect(buildErrorWebhookText({ code: 'INTERNAL', time: new Date(0) })).toContain('błąd serwera');
  });
});

describe('POST /api/client-error', () => {
  let webhookBodies: string[];

  beforeEach(() => {
    vi.resetModules();
    webhookBodies = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        webhookBodies.push(String(init?.body));
        return new Response(null, { status: 204 });
      }),
    );
    vi.stubEnv('ERROR_WEBHOOK_URL', WEBHOOK);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://pracuj.be');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function route() {
    return import('@/app/api/client-error/route');
  }

  function request(body: string, headers: Record<string, string> = {}, ip = '203.0.113.7'): Request {
    return new Request('http://localhost/api/client-error', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'x-real-ip': ip,
        cookie: `session=${PII_EMAIL}`,
        ...headers,
      },
      body,
    });
  }

  it('ta sama witryna → 204 i wiadomość tylko z kodem, trasą i wydaniem (bez IP i cookies)', async () => {
    const { POST } = await route();
    const res = await POST(request(JSON.stringify({ code: 'NOT_FOUND', route: '/pl/oferty-pracy?q=x', release: '1.0.0+abc' })));
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(webhookBodies).toHaveLength(1);
    const content = (JSON.parse(webhookBodies[0]!) as { content: string }).content;
    expect(content).toContain('Kod: NOT_FOUND');
    expect(content).toContain('Trasa: /pl/oferty-pracy');
    expect(content).toContain('Wydanie: 1.0.0+abc');
    expect(content).not.toContain('q=x');
    expect(content).not.toContain('203.0.113.7');
    expect(content).not.toContain(PII_EMAIL);
  });

  it('origin z NEXT_PUBLIC_SITE_URL też jest dozwolony', async () => {
    const { POST } = await route();
    const res = await POST(request(JSON.stringify({ code: 'INTERNAL', route: '/nl' }), { origin: 'https://pracuj.be' }));
    expect(res.status).toBe(204);
    expect(webhookBodies).toHaveLength(1);
  });

  it('kontrola ujemna: obcy Origin, brak Origin albo cross-site → 403 bez wysyłki', async () => {
    const { POST } = await route();
    const body = JSON.stringify({ code: 'INTERNAL', route: '/pl' });
    expect((await POST(request(body, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(request(body, { origin: 'null' }))).status).toBe(403);
    expect((await POST(request(body, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    const noOrigin = new Request('http://localhost/api/client-error', { method: 'POST', body });
    expect((await POST(noOrigin)).status).toBe(403);
    expect(webhookBodies).toHaveLength(0);
  });

  it('kontrola ujemna: payload z message/stack → 400, nic nie wychodzi', async () => {
    const { POST } = await route();
    const res = await POST(
      request(JSON.stringify({ code: 'INTERNAL', route: '/pl', message: `boom ${PII_EMAIL}`, stack: 'Error at x' })),
    );
    expect(res.status).toBe(400);
    expect((await POST(request('not json'))).status).toBe(400);
    expect(webhookBodies).toHaveLength(0);
  });

  it('body > 4 KB → 413', async () => {
    const { POST } = await route();
    const res = await POST(request(JSON.stringify({ code: 'INTERNAL', route: `/${'a'.repeat(5000)}` })));
    expect(res.status).toBe(413);
    expect(webhookBodies).toHaveLength(0);
  });

  it('brak ERROR_WEBHOOK_URL → 204 bez wysyłki', async () => {
    vi.stubEnv('ERROR_WEBHOOK_URL', '');
    const { POST } = await route();
    const res = await POST(request(JSON.stringify({ code: 'INTERNAL', route: '/pl' })));
    expect(res.status).toBe(204);
    expect(webhookBodies).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('limiter po adresie: 11. zgłoszenie w minucie → 429', async () => {
    const { POST } = await route();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await POST(request(JSON.stringify({ code: 'INTERNAL', route: `/pl/${i}` }), {}, '198.51.100.1'))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 204)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Inny adres ma osobny licznik.
    expect((await POST(request(JSON.stringify({ code: 'INTERNAL' }), {}, '198.51.100.2'))).status).toBe(204);
  });

  it('GET → 405', async () => {
    const { GET } = await route();
    expect(GET().status).toBe(405);
  });
});

describe('reporter przeglądarki', () => {
  it('wysyła tylko kod, trasę i wydanie; deduplikacja w karcie i limit', () => {
    const bodies: Record<string, unknown>[] = [];
    const inits: RequestInit[] = [];
    let path = '/pl/oferty-pracy';
    const report = createClientErrorReporter({
      fetch: (async (url: string, init?: RequestInit) => {
        expect(url).toBe('/api/client-error');
        inits.push(init!);
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
      pathname: () => path,
      release: '1.0.0+abc',
    });
    report({ code: 'INTERNAL' });
    report({ code: 'INTERNAL' });
    expect(bodies).toEqual([{ code: 'INTERNAL', route: '/pl/oferty-pracy', release: '1.0.0+abc' }]);
    expect(inits[0]!.credentials).toBe('omit');
    for (let i = 0; i < 20; i += 1) {
      path = `/pl/${i}`;
      report({ code: 'INTERNAL' });
    }
    expect(bodies).toHaveLength(CLIENT_ERROR_MAX_PER_TAB);
    expect(Object.keys(bodies[0]!).sort()).toEqual(['code', 'release', 'route']);
  });

  it('trasa bez query/fragmentu; błędy skryptów obcych witryn pomijane', () => {
    expect(clientRoute('/pl/a?x=1#y')).toBe('/pl/a');
    expect(clientRoute('pl')).toBe('/pl');
    expect(isOwnScriptError({ filename: 'https://pracuj.be/_next/static/chunk.js' }, 'https://pracuj.be')).toBe(true);
    expect(isOwnScriptError({ filename: '' }, 'https://pracuj.be')).toBe(false);
    expect(isOwnScriptError({ filename: 'chrome-extension://abc/x.js' }, 'https://pracuj.be')).toBe(false);
    expect(isOwnScriptError({ filename: 'https://pracuj.be.evil.example/x.js' }, 'https://pracuj.be')).toBe(false);
  });
});

describe('strażnik bundla klienta: adres webhooka nie trafia do przeglądarki', () => {
  const ROOT = resolve(__dirname, '../..');
  const SRC = join(ROOT, 'src');
  const EXT = ['.ts', '.tsx', '.js', '.mjs'];

  function resolveLocal(spec: string, from: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
    else return null;
    const candidates = [base, ...EXT.map((e) => base + e), ...EXT.map((e) => join(base, `index${e}`))];
    return candidates.find((p) => existsSync(p) && statSync(p).isFile()) ?? null;
  }

  function reachable(entry: string): string[] {
    const seen = new Set<string>();
    const queue = [join(ROOT, entry)];
    while (queue.length) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const next = resolveLocal(m[1]!, file);
        if (next) queue.push(next);
      }
    }
    return [...seen].map((f) => relative(ROOT, f));
  }

  function leaks(files: string[]): string[] {
    return files.filter((f) => {
      // Komentarze mogą wspominać nazwę zmiennej — liczy się kod.
      const src = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return f.includes('src/lib/error-webhook') || /ERROR_WEBHOOK_URL|discord(app)?\.com/.test(src);
    });
  }

  it.each(['src/lib/client-error/reporter.ts', 'src/components/errors/ClientErrorReporter.tsx', 'src/app/global-error.tsx'])(
    '%s nie sięga modułu wysyłki ani adresu',
    (entry) => {
      const files = reachable(entry);
      expect(files).toContain('src/lib/error-report.ts');
      expect(leaks(files)).toEqual([]);
    },
  );

  it('reporter jest komponentem klienckim bez process.env poza NEXT_PUBLIC_APP_VERSION', () => {
    const src = readFileSync(join(SRC, 'lib/client-error/reporter.ts'), 'utf8');
    expect(src.startsWith("'use client'")).toBe(true);
    expect([...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1])).toEqual(['NEXT_PUBLIC_APP_VERSION']);
  });

  it('kontrola ujemna strażnika: z trasy serwerowej moduł wysyłki JEST osiągalny', () => {
    expect(leaks(reachable('src/app/api/client-error/route.ts')).length).toBeGreaterThan(0);
  });
});
