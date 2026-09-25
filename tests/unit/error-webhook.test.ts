// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureError, setErrorReporter } from '@/lib/error-report';
import {
  ERROR_WEBHOOK_MAX_CHARS,
  buildErrorWebhookPayload,
  buildErrorWebhookText,
  createErrorWebhookSender,
  installErrorWebhook,
  parseErrorWebhookUrl,
  reportRequestError,
  safeRoute,
} from '@/lib/error-webhook';
import { AppError } from '@/lib/errors';
import { readinessChecks } from '@/lib/env';

import { PII, expectNoPii } from '../helpers/privacy-fixtures';

/**
 * #571 — kanał błędów przez webhook Discorda (`ERROR_WEBHOOK_URL`) zamiast Sentry.
 * Każde zachowanie ma kontrolę ujemną (wejście zawiera to, czego wyjście nie może mieć).
 */
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdEFGH';
const NATIVE = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;
const SLACK = `${NATIVE}/slack`;

type Call = { url: string; init: RequestInit };

function recorder(responses: Array<Response | (() => Promise<Response>)> = []) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (typeof next === 'function') return next();
    return next ?? new Response(null, { status: 204 });
  });
  return { calls, fetch: fetchMock as unknown as typeof fetch };
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

afterEach(() => {
  setErrorReporter(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('adres webhooka', () => {
  it('rozpoznaje postać natywną i zgodną ze Slackiem po końcówce ścieżki', () => {
    expect(parseErrorWebhookUrl(NATIVE)).toEqual({ url: NATIVE, format: 'discord' });
    expect(parseErrorWebhookUrl(SLACK)).toEqual({ url: SLACK, format: 'slack' });
    expect(parseErrorWebhookUrl(`  ${NATIVE.replace('discord.com', 'discordapp.com')}/  `)?.format).toBe('discord');
  });

  it('odrzuca inny host, http, port, dane logowania, query, fragment i obcą ścieżkę', () => {
    for (const bad of [
      '',
      '   ',
      NATIVE.replace('https:', 'http:'),
      NATIVE.replace('discord.com', 'discord.com.evil.example'),
      NATIVE.replace('discord.com', 'evil.example'),
      NATIVE.replace('discord.com', 'discord.com:8443'),
      NATIVE.replace('https://', 'https://user:pass@'),
      `${NATIVE}?wait=true`,
      `${NATIVE}#x`,
      NATIVE.replace('/api/webhooks/', '/api/other/'),
      `${NATIVE}/github`,
      'not a url',
    ]) {
      expect(parseErrorWebhookUrl(bad), bad).toBeNull();
    }
  });
});

describe('brak zmiennej = brak wysyłki', () => {
  it('pusta ERROR_WEBHOOK_URL: nie woła fetch, /api/health errorWebhook=false', async () => {
    vi.stubEnv('ERROR_WEBHOOK_URL', '');
    const rec = recorder();
    const sender = createErrorWebhookSender({ fetch: rec.fetch });
    expect(await sender.send({ code: 'INTERNAL' })).toBe('disabled');
    expect(rec.calls).toHaveLength(0);
    expect(readinessChecks().errorWebhook).toBe(false);

    // Kontrola ujemna: ta sama ścieżka z poprawnym adresem wysyła i raportuje true.
    vi.stubEnv('ERROR_WEBHOOK_URL', NATIVE);
    expect(await sender.send({ code: 'INTERNAL' })).toBe('sent');
    expect(rec.calls).toHaveLength(1);
    expect(readinessChecks().errorWebhook).toBe(true);
    expect(readinessChecks()).not.toHaveProperty('sentry');
  });

  it('niepoprawny adres (obcy host) też nic nie wysyła', async () => {
    vi.stubEnv('ERROR_WEBHOOK_URL', NATIVE.replace('discord.com', 'evil.example'));
    const rec = recorder();
    expect(await createErrorWebhookSender({ fetch: rec.fetch }).send({ code: 'INTERNAL' })).toBe('disabled');
    expect(rec.calls).toHaveLength(0);
    expect(readinessChecks().errorWebhook).toBe(false);
  });
});

describe('payload', () => {
  it('natywny Discord: content + allowed_mentions bez wzmianek; /slack: sam text', async () => {
    const rec = recorder();
    const target = { url: NATIVE, format: 'discord' as const };
    await createErrorWebhookSender({ fetch: rec.fetch, target: () => target, now: () => 0 }).send({ code: 'INTERNAL' });
    const native = bodyOf(rec.calls[0]!);
    expect(rec.calls[0]!.url).toBe(NATIVE);
    expect(rec.calls[0]!.init.method).toBe('POST');
    expect(Object.keys(native).sort()).toEqual(['allowed_mentions', 'content']);
    expect(native.allowed_mentions).toEqual({ parse: [] });

    const rec2 = recorder();
    await createErrorWebhookSender({ fetch: rec2.fetch, target: () => ({ url: SLACK, format: 'slack' }), now: () => 0 }).send({
      code: 'INTERNAL',
    });
    const slack = bodyOf(rec2.calls[0]!);
    expect(rec2.calls[0]!.url).toBe(SLACK);
    expect(Object.keys(slack)).toEqual(['text']);
    expect(slack.text).toBe(native.content);
  });

  it('tylko kod, trasa, wydanie, środowisko i czas', () => {
    const text = buildErrorWebhookText({
      code: 'PERMISSION_DENIED',
      route: '/[locale]/oferty-pracy/[slug]',
      release: '0.20260925.1+abc1234',
      environment: 'production',
      time: new Date('2026-09-25T10:00:00.000Z'),
    });
    expect(text).toBe(
      [
        'pracuj.be: błąd serwera',
        'Kod: PERMISSION_DENIED',
        'Trasa: /[locale]/oferty-pracy/[slug]',
        'Wydanie: 0.20260925.1+abc1234',
        'Środowisko: production',
        'Czas: 2026-09-25T10:00:00.000Z',
      ].join('\n'),
    );
  });

  it('błąd z danymi kandydata: w payloadzie nie ma PII, query, treści wyjątku ani kontekstu', async () => {
    vi.stubEnv('ERROR_WEBHOOK_URL', NATIVE);
    const rec = recorder();
    setErrorReporter(createErrorWebhookSender({ fetch: rec.fetch }).reporter);
    const original = new AppError('PERMISSION_DENIED', {
      cause: new Error(`${PII.email} ${PII.cvFile} ${PII.niss}`),
      context: { message: PII.messageBody, phone: PII.phoneIntl },
    });
    const context = { area: 'candidate.private', bio: PII.bio, email: PII.email };
    // Kontrola ujemna: wejście naprawdę niesie dane, które nie mogą wyjść.
    const naive = JSON.stringify({ message: String(original.cause), context, ctx: original.context });
    expect(naive).toContain(PII.email);
    expect(naive).toContain(PII.bio);

    captureError(original, context);
    await vi.waitFor(() => expect(rec.calls).toHaveLength(1));
    const raw = String(rec.calls[0]!.init.body);
    expectNoPii(raw);
    expect(raw).not.toContain('candidate.private');
    expect(bodyOf(rec.calls[0]!).content).toContain('Kod: PERMISSION_DENIED');
  });

  it('trasa z żądania: bez query/fragmentu i segmentów z danymi; kod spoza słownika = INTERNAL', () => {
    const route = `/pl/aplikacja/przejmij/${PII.token}?email=${PII.email}#token=${PII.token}`;
    expect(route).toContain(PII.email);
    const safe = safeRoute(route);
    expect(safe).toBe('/pl/aplikacja/przejmij/[Filtered]');
    expect(safeRoute(`/pl/**${PII.email}**/<@123>`)).not.toMatch(/[*<@>]/);
    expect(safeRoute(`https://pracuj.be/pl/x?t=${PII.token}`)).toBe('/pl/x');

    const text = buildErrorWebhookText({ code: `boom ${PII.email}`, route, time: new Date(0) });
    expectNoPii(text);
    expect(text).toContain('Kod: INTERNAL');
  });

  it('limit 2000 znaków: długi tekst jest obcinany w obu formatach', () => {
    const long = 'x'.repeat(5000);
    const native = buildErrorWebhookPayload('discord', long) as { content: string };
    const slack = buildErrorWebhookPayload('slack', long) as { text: string };
    expect(native.content).toHaveLength(ERROR_WEBHOOK_MAX_CHARS);
    expect(slack.text).toHaveLength(ERROR_WEBHOOK_MAX_CHARS);
    expect(native.content.endsWith('…')).toBe(true);
    // Kontrola ujemna: krótki tekst bez zmian.
    expect((buildErrorWebhookPayload('discord', 'ok') as { content: string }).content).toBe('ok');

    const text = buildErrorWebhookText({
      code: 'INTERNAL',
      route: `/${'a'.repeat(4000)}`,
      release: 'r'.repeat(4000),
      environment: 'e'.repeat(4000),
      time: new Date(0),
    });
    expect(text.length).toBeLessThanOrEqual(ERROR_WEBHOOK_MAX_CHARS);
  });
});

describe('deduplikacja, 429, timeout i awarie', () => {
  const target = () => ({ url: NATIVE, format: 'discord' as const });

  it('ten sam kod najwyżej raz na okno; po oknie wiadomość z liczbą pominiętych', async () => {
    let now = 1_000_000;
    const rec = recorder();
    const sender = createErrorWebhookSender({ fetch: rec.fetch, target, now: () => now, dedupMs: 60_000 });
    expect(await sender.send({ code: 'INTERNAL' })).toBe('sent');
    expect(await sender.send({ code: 'INTERNAL' })).toBe('deduplicated');
    expect(await sender.send({ code: 'INTERNAL' })).toBe('deduplicated');
    // Inny kod nie jest blokowany.
    expect(await sender.send({ code: 'VALIDATION_FAILED' })).toBe('sent');
    expect(rec.calls).toHaveLength(2);
    now += 60_000;
    expect(await sender.send({ code: 'INTERNAL' })).toBe('sent');
    expect(rec.calls).toHaveLength(3);
    expect(String(bodyOf(rec.calls[2]!).content)).toContain('Pominięte powtórzenia: 2');
  });

  it('429 z retry_after wstrzymuje wysyłkę do upływu przerwy', async () => {
    let now = 0;
    const rec = recorder([
      new Response(JSON.stringify({ retry_after: 2.5 }), { status: 429, headers: { 'content-type': 'application/json' } }),
    ]);
    const sender = createErrorWebhookSender({ fetch: rec.fetch, target, now: () => now, dedupMs: 0 });
    expect(await sender.send({ code: 'INTERNAL' })).toBe('rate_limited');
    now = 2000;
    expect(await sender.send({ code: 'NOT_FOUND' })).toBe('rate_limited');
    expect(rec.calls).toHaveLength(1);
    now = 2500;
    expect(await sender.send({ code: 'NOT_FOUND' })).toBe('sent');
    expect(rec.calls).toHaveLength(2);
  });

  it('timeout przerywa wysyłkę, a błąd sieci (z adresem w komunikacie) jest cichy', async () => {
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error(`aborted ${NATIVE}`)));
        }),
    ) as unknown as typeof fetch;
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    const sender = createErrorWebhookSender({ fetch: hanging, target, timeoutMs: 20 });
    expect(await sender.send({ code: 'INTERNAL' })).toBe('failed');

    const failing = vi.fn(async () => {
      throw new Error(`getaddrinfo ENOTFOUND ${NATIVE}`);
    }) as unknown as typeof fetch;
    expect(await createErrorWebhookSender({ fetch: failing, target }).send({ code: 'INTERNAL' })).toBe('failed');
    expect(
      await createErrorWebhookSender({ fetch: recorder([new Response('x', { status: 500 })]).fetch, target }).send({
        code: 'INTERNAL',
      }),
    ).toBe('failed');
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it('reporter (captureError) nie rzuca nawet przy awarii wysyłki', () => {
    const failing = vi.fn(() => {
      throw new Error('sync boom');
    }) as unknown as typeof fetch;
    setErrorReporter(createErrorWebhookSender({ fetch: failing, target }).reporter);
    expect(() => captureError(new Error('x'))).not.toThrow();
  });
});

describe('rejestracja i onRequestError', () => {
  it('bez zarejestrowanego reportera (przeglądarka) captureError to no-op', () => {
    setErrorReporter(null);
    expect(() => captureError(new AppError('INTERNAL'))).not.toThrow();
  });

  it('onRequestError zgłasza szablon trasy, nie ścieżkę z wartościami', async () => {
    vi.stubEnv('ERROR_WEBHOOK_URL', SLACK);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    installErrorWebhook();
    reportRequestError(
      new Error(`boom ${PII.email}`),
      { path: `/pl/oferty-pracy/${PII.token}?q=${PII.lastName}` },
      { routePath: '/[locale]/oferty-pracy/[slug]' },
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(SLACK);
    const raw = String(init?.body);
    expectNoPii(raw);
    expect(raw).toContain('Trasa: /[locale]/oferty-pracy/[slug]');
    expect(raw).toContain('Kod: INTERNAL');
  });
});

describe('strażnik: adres tylko po stronie serwera, bez Sentry', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : /\.(tsx?|mjs)$/.test(entry.name) ? [path] : [];
    });
  }
  const files = walk('src').map((path) => ({ path, src: readFileSync(path, 'utf8') }));

  it('komponenty klienckie nie importują modułu wysyłki; brak NEXT_PUBLIC_ adresu i SDK Sentry', () => {
    const client = files.filter((f) => /^['"]use client['"]/m.test(f.src));
    expect(client.length).toBeGreaterThan(10);
    const offenders = client.filter((f) => f.src.includes('@/lib/error-webhook'));
    expect(offenders.map((f) => f.path)).toEqual([]);
    expect(files.filter((f) => /NEXT_PUBLIC_ERROR_WEBHOOK/.test(f.src)).map((f) => f.path)).toEqual([]);
    expect(files.filter((f) => /@sentry\//.test(f.src)).map((f) => f.path)).toEqual([]);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith(['@sentry', ''].join('/')))).toEqual([]);
    // Kontrola ujemna strażnika: wzorzec wykrywa import w komponencie klienckim.
    expect("'use client';\nimport { x } from '@/lib/error-webhook';".includes('@/lib/error-webhook')).toBe(true);
  });

  it('moduł izomorficzny error-report nie zawiera kodu wysyłki ani adresu', () => {
    const src = readFileSync('src/lib/error-report.ts', 'utf8');
    expect(src).not.toMatch(/fetch\(|process\.env|from '@\/lib\/error-webhook/);
  });
});
