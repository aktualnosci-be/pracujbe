// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FUNNEL_MAX_JOBS, parseFunnelPayload } from '@/lib/job-funnel/events';
import { classifyFunnelRequest } from '@/lib/job-funnel/request-filter';
import { createFunnelRateLimiter } from '@/lib/job-funnel/rate-limit';
import { funnelDateRange, parseFunnelRange } from '@/lib/job-funnel/range';
import { recordJobFunnelEvent } from '@/lib/db/job-funnel';
import type { TransactionClient, TransactionPool } from '@/lib/db/transaction';

/**
 * Serwerowy lejek ofert (#99): walidacja zdarzenia, jawna reguła botów/podglądów, limiter bez
 * przechowywania adresu, zakres dni w Brukseli i zapis jako gość z bramką endpointu.
 */

const JOB = '3f1c7a52-6f7e-4d0b-9a55-1a2b3c4d5e6f';
const JOB2 = '9b2e4c10-1111-4222-8333-444455556666';
const NONCE = 'c0ffee00-1234-4abc-8def-0123456789ab';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

describe('parseFunnelPayload', () => {
  it('accepts a valid event and removes duplicate jobs', () => {
    expect(parseFunnelPayload({ event: 'search_appearance', nonce: NONCE, jobIds: [JOB, JOB.toUpperCase(), JOB2] }))
      .toEqual({ event: 'search_appearance', nonce: NONCE, jobIds: [JOB, JOB2] });
  });

  it.each([
    ['unknown event', { event: 'click', nonce: NONCE, jobIds: [JOB] }],
    ['missing nonce', { event: 'detail_view', jobIds: [JOB] }],
    ['non-uuid nonce', { event: 'detail_view', nonce: 'abc', jobIds: [JOB] }],
    ['non-uuid job', { event: 'detail_view', nonce: NONCE, jobIds: ['12345'] }],
    ['empty jobs', { event: 'detail_view', nonce: NONCE, jobIds: [] }],
    ['two jobs for a detail view', { event: 'detail_view', nonce: NONCE, jobIds: [JOB, JOB2] }],
    ['too many list jobs', { event: 'search_appearance', nonce: NONCE,
      jobIds: Array.from({ length: FUNNEL_MAX_JOBS.search_appearance + 1 }, () => JOB) }],
    // Zdarzenie nie może nieść dodatkowych danych (np. tekstu wyszukiwania albo identyfikatora).
    ['extra field', { event: 'detail_view', nonce: NONCE, jobIds: [JOB], keyword: 'magazyn' }],
    ['array body', [JOB]],
    ['null body', null],
  ])('rejects %s', (_name, body) => {
    expect(parseFunnelPayload(body)).toBeNull();
  });

  it('keeps the list limit equal to the database limit in 0089', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/0089_job_funnel.sql'), 'utf8');
    expect(sql).toContain(`when p_event = 'search_appearance' then ${FUNNEL_MAX_JOBS.search_appearance} else 1`);
  });
});

describe('classifyFunnelRequest — bots and previews are excluded', () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it('counts an ordinary same-origin browser request', () => {
    expect(classifyFunnelRequest(headers({ 'user-agent': BROWSER_UA, 'sec-fetch-site': 'same-origin' }))).toBe('count');
    // Starsze przeglądarki bez nagłówków Fetch Metadata.
    expect(classifyFunnelRequest(headers({ 'user-agent': BROWSER_UA }))).toBe('count');
  });

  it.each([
    '',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'TelegramBot (like TwitterBot)',
    'LinkedInBot/1.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) Chrome-Lighthouse',
    'curl/8.5.0',
    'python-requests/2.32.3',
    'UptimeRobot/2.0',
  ])('treats %j as a bot', (ua) => {
    expect(classifyFunnelRequest(headers(ua ? { 'user-agent': ua } : {}))).toBe('bot');
  });

  it.each([
    ['sec-purpose', 'prefetch;prerender'],
    ['sec-purpose', 'prefetch'],
    ['purpose', 'prefetch'],
    ['x-purpose', 'prefetch'],
    ['x-moz', 'prefetch'],
    ['next-router-prefetch', '1'],
  ])('treats %s: %s as a prefetch', (name, value) => {
    expect(classifyFunnelRequest(headers({ 'user-agent': BROWSER_UA, [name]: value }))).toBe('prefetch');
  });

  it('rejects cross-site submissions', () => {
    expect(classifyFunnelRequest(headers({ 'user-agent': BROWSER_UA, 'sec-fetch-site': 'cross-site' }))).toBe('cross-site');
    expect(classifyFunnelRequest(headers({ 'user-agent': BROWSER_UA, 'sec-fetch-site': 'same-site' }))).toBe('cross-site');
  });
});

describe('createFunnelRateLimiter', () => {
  it('limits one address per window and resets with the next window', () => {
    const limiter = createFunnelRateLimiter({ max: 3, windowMs: 60_000 });
    expect([1, 2, 3, 4].map(() => limiter.hit('203.0.113.7', 1_000))).toEqual([true, true, true, false]);
    expect(limiter.hit('198.51.100.2', 1_000)).toBe(true);
    expect(limiter.hit('203.0.113.7', 61_000)).toBe(true);
  });

  it('refuses new keys beyond the memory bound instead of growing without limit', () => {
    const limiter = createFunnelRateLimiter({ max: 5, windowMs: 60_000, maxKeys: 2 });
    expect(limiter.hit('a', 0)).toBe(true);
    expect(limiter.hit('b', 0)).toBe(true);
    expect(limiter.hit('c', 0)).toBe(false);
    expect(limiter.hit('a', 0)).toBe(true);
  });
});

describe('funnel date range (Europe/Brussels days)', () => {
  it('includes today and the previous days in Brussels time', () => {
    // 23:30 UTC = 01:30 CEST następnego dnia.
    expect(funnelDateRange(30, new Date('2026-09-23T23:30:00Z'))).toEqual({ days: 30, from: '2026-08-26', to: '2026-09-24' });
    expect(funnelDateRange(7, new Date('2026-03-29T00:30:00Z'))).toEqual({ days: 7, from: '2026-03-23', to: '2026-03-29' });
  });

  it('accepts only offered ranges', () => {
    expect(parseFunnelRange('7')).toBe(7);
    expect(parseFunnelRange(['90'])).toBe(90);
    expect(parseFunnelRange('365')).toBe(30);
    expect(parseFunnelRange(undefined)).toBe(30);
  });
});

describe('recordJobFunnelEvent', () => {
  it('writes as a guest with the endpoint gate set only for this transaction', async () => {
    const queries: { text: string; values?: unknown[] }[] = [];
    const client: TransactionClient = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        return text.includes('record_job_funnel_event') ? { rows: [{ counted: 1 }] } : { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool: TransactionPool = { connect: vi.fn(async () => client) };

    expect(await recordJobFunnelEvent(pool, { event: 'detail_view', nonce: NONCE, jobIds: [JOB] })).toBe(1);
    expect(queries.map((q) => q.text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE anon',
      "SELECT set_config('app.current_uid', $1, true)",
      "SELECT set_config('pracujbe.funnel_writer', 'on', true)",
      'SELECT public.record_job_funnel_event($1::text, $2::uuid, $3::uuid[]) AS counted',
      'COMMIT',
    ]);
    expect(queries[2]!.values).toEqual(['']);
    expect(queries[4]!.values).toEqual(['detail_view', NONCE, [JOB]]);
  });
});

describe('POST /api/job-funnel', () => {
  const record = vi.fn();
  const originalUrl = process.env.DATABASE_APP_URL;

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_APP_URL;
    else process.env.DATABASE_APP_URL = originalUrl;
  });

  beforeEach(() => {
    vi.resetModules();
    record.mockReset().mockResolvedValue(1);
    vi.doMock('@/lib/db/runtime', () => ({ getDomainPool: vi.fn(async () => ({})) }));
    vi.doMock('@/lib/db/job-funnel', () => ({ recordJobFunnelEvent: record }));
    vi.doMock('@/lib/error-report', () => ({ captureError: vi.fn() }));
    process.env.DATABASE_APP_URL = 'postgres://example.invalid/app';
  });

  async function post(body: unknown, headers: Record<string, string> = {}) {
    const { POST } = await import('@/app/api/job-funnel/route');
    return POST(new Request('http://localhost/api/job-funnel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': BROWSER_UA, 'x-real-ip': '203.0.113.9', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
  }

  it('records a valid event and answers 204 without cache or cookies', async () => {
    const response = await post({ event: 'detail_view', nonce: NONCE, jobIds: [JOB] });
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(record).toHaveBeenCalledWith({}, { event: 'detail_view', nonce: NONCE, jobIds: [JOB] });
  });

  it('answers 204 to a bot without recording anything', async () => {
    const response = await post({ event: 'detail_view', nonce: NONCE, jobIds: [JOB] }, { 'user-agent': 'Googlebot/2.1' });
    expect(response.status).toBe(204);
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies and oversize payloads', async () => {
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ event: 'detail_view', nonce: NONCE, jobIds: [JOB], ip: '1.2.3.4' })).status).toBe(400);
    expect((await post('x'.repeat(5000))).status).toBe(413);
    expect(record).not.toHaveBeenCalled();
  });

  it('rate limits one address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 62; i += 1) {
      statuses.push((await post({ event: 'detail_view', nonce: NONCE, jobIds: [JOB] }, { 'x-real-ip': '192.0.2.44' })).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 204)).toBe(true);
    expect(statuses.slice(60)).toEqual([429, 429]);
  });

  it('does nothing in demo mode and hides database failures from the client', async () => {
    delete process.env.DATABASE_APP_URL;
    expect((await post({ event: 'detail_view', nonce: NONCE, jobIds: [JOB] })).status).toBe(204);
    expect(record).not.toHaveBeenCalled();

    process.env.DATABASE_APP_URL = 'postgres://example.invalid/app';
    record.mockRejectedValueOnce(new Error('connection refused'));
    expect((await post({ event: 'detail_view', nonce: NONCE, jobIds: [JOB] })).status).toBe(204);
  });

  it('refuses GET', async () => {
    const { GET } = await import('@/app/api/job-funnel/route');
    expect(GET().status).toBe(405);
  });
});
