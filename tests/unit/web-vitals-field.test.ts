import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { CF_GRAPHQL_ENDPOINT, fetchFieldWebVitals } from '@/lib/web-vitals/cloudflare-client';
import {
  WEB_VITALS_QUERY,
  buildWebVitalsRequest,
  displayPath,
  parseWebVitalsPeriod,
  parseWebVitalsResponse,
  rateWebVital,
  readWebVitalsConfig,
  webVitalsDateRange,
} from '@/lib/web-vitals/field-report';

/**
 * Dane polowe CWV z Cloudflare Web Analytics: portal nie zbiera metryk sam (beacon CF po zgodzie
 * analitycznej, Invariant #7), panel admina czyta agregaty p75 przez GraphQL API na serwerze.
 */

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const SITE = 'fedcba9876543210fedcba9876543210';
const TOKEN = 'cf-token-secret-value-1234567890';
const ENV = { CF_ANALYTICS_ACCOUNT_ID: ACCOUNT, CF_WEB_ANALYTICS_SITE_TAG: SITE, CF_ANALYTICS_API_TOKEN: TOKEN };
const NOW = new Date('2026-09-26T07:30:00Z');

const q = (lcp: number, inp: number, cls: number) => ({
  largestContentfulPaintP75: lcp,
  interactionToNextPaintP75: inp,
  cumulativeLayoutShiftP75: cls,
});

const OK_BODY = {
  data: {
    viewer: {
      accounts: [
        {
          total: [{ count: 1240, quantiles: q(2_310_000, 180_400, 0.04) }],
          paths: [
            { count: 800, dimensions: { requestPath: '/pl' }, quantiles: q(1_900_000, 150_000, 0.02) },
            { count: 60, dimensions: { requestPath: '/fr/offres?x=1#y' }, quantiles: q(4_500_000, -1, -1) },
          ],
        },
      ],
    },
  },
  errors: null,
};

function okResponse(body: unknown = OK_BODY): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('konfiguracja', () => {
  it('wymaga trzech zmiennych w poprawnym zapisie (kontrola ujemna: brak/zły zapis = null)', () => {
    expect(readWebVitalsConfig(ENV)).toEqual({ accountId: ACCOUNT, siteTag: SITE, apiToken: TOKEN });
    expect(readWebVitalsConfig({})).toBeNull();
    expect(readWebVitalsConfig({ ...ENV, CF_ANALYTICS_API_TOKEN: '' })).toBeNull();
    expect(readWebVitalsConfig({ ...ENV, CF_WEB_ANALYTICS_SITE_TAG: 'nie-hex' })).toBeNull();
    expect(readWebVitalsConfig({ ...ENV, CF_ANALYTICS_ACCOUNT_ID: `${ACCOUNT}0` })).toBeNull();
  });

  it('okres z adresu: 7 albo 28, inne wartości = 28', () => {
    expect(parseWebVitalsPeriod('7')).toBe(7);
    expect(parseWebVitalsPeriod(['28'])).toBe(28);
    expect(parseWebVitalsPeriod('90')).toBe(28);
    expect(parseWebVitalsPeriod(undefined)).toBe(28);
  });

  it('zakres dat w UTC włącznie z dziś', () => {
    expect(webVitalsDateRange(7, NOW)).toEqual({ from: '2026-09-20', to: '2026-09-26' });
    expect(webVitalsDateRange(28, NOW)).toEqual({ from: '2026-08-30', to: '2026-09-26' });
  });
});

describe('zapytanie GraphQL', () => {
  it('stałe zapytanie, wartości tylko w zmiennych, bez tokenu i tylko ruch ludzi', () => {
    const req = buildWebVitalsRequest(readWebVitalsConfig(ENV)!, 7, NOW);
    expect(req.query).toBe(WEB_VITALS_QUERY);
    expect(req.query).not.toContain(SITE);
    expect(req.variables).toEqual({
      accountTag: ACCOUNT,
      filter: { siteTag: SITE, date_geq: '2026-09-20', date_leq: '2026-09-26', bot: 0 },
      limit: 20,
    });
    expect(JSON.stringify(req)).not.toContain(TOKEN);
    expect(WEB_VITALS_QUERY).toContain('rumWebVitalsEventsAdaptiveGroups');
    expect(WEB_VITALS_QUERY).toContain('largestContentfulPaintP75');
  });
});

describe('odpowiedź', () => {
  const range = { from: '2026-09-20', to: '2026-09-26' };

  it('przelicza mikrosekundy na ms, ujemne = brak danych, ścieżka bez query', () => {
    const parsed = parseWebVitalsResponse(OK_BODY, range);
    expect(parsed).toEqual({
      ok: true,
      report: {
        ...range,
        total: { count: 1240, lcpMs: 2310, inpMs: 180, cls: 0.04 },
        paths: [
          { path: '/pl', count: 800, lcpMs: 1900, inpMs: 150, cls: 0.02 },
          { path: '/fr/offres', count: 60, lcpMs: 4500, inpMs: null, cls: null },
        ],
      },
    });
  });

  it('błąd GraphQL i zły kształt dają sam kod (bez treści dostawcy)', () => {
    const withErrors = parseWebVitalsResponse({ data: null, errors: [{ message: `bad token ${TOKEN}` }] }, range);
    expect(withErrors).toEqual({ ok: false, code: 'CF_API_ERROR' });
    expect(JSON.stringify(withErrors)).not.toContain(TOKEN);
    expect(parseWebVitalsResponse({ data: { viewer: { accounts: [] } } }, range)).toEqual({
      ok: false,
      code: 'CF_BAD_RESPONSE',
    });
    expect(parseWebVitalsResponse('html', range)).toEqual({ ok: false, code: 'CF_BAD_RESPONSE' });
  });

  it('pusta grupa total = zero pomiarów, bez wartości', () => {
    const body = { data: { viewer: { accounts: [{ total: [], paths: [] }] } } };
    const parsed = parseWebVitalsResponse(body, range);
    expect(parsed.ok && parsed.report.total).toEqual({ count: 0, lcpMs: null, inpMs: null, cls: null });
  });

  it('ścieżka: tylko znaki drukowalne, z ukośnikiem, najwyżej 200 znaków', () => {
    expect(displayPath('pl/oferty\u0000\n')).toBe('/pl/oferty');
    expect(displayPath(`/${'a'.repeat(300)}`)).toHaveLength(200);
  });
});

describe('ocena według progów Core Web Vitals', () => {
  it.each([
    ['lcp', 2500, 'good'],
    ['lcp', 2501, 'needsImprovement'],
    ['lcp', 4001, 'poor'],
    ['inp', 200, 'good'],
    ['inp', 500, 'needsImprovement'],
    ['inp', 501, 'poor'],
    ['cls', 0.1, 'good'],
    ['cls', 0.25, 'needsImprovement'],
    ['cls', 0.26, 'poor'],
  ] as const)('%s %s → %s', (metric, value, rating) => {
    expect(rateWebVital(metric, value)).toBe(rating);
  });

  it('brak wartości = brak oceny', () => {
    expect(rateWebVital('inp', null)).toBeNull();
  });
});

describe('klient Cloudflare', () => {
  it('bez konfiguracji nie wysyła żadnego żądania', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchFieldWebVitals(28, { env: {}, fetchImpl, now: NOW })).resolves.toEqual({ status: 'unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('token tylko w nagłówku Authorization, POST na endpoint GraphQL', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const result = await fetchFieldWebVitals(7, { env: ENV, fetchImpl, now: NOW });
    expect(result.status).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CF_GRAPHQL_ENDPOINT);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(String(init.body)).not.toContain(TOKEN);
  });

  it('HTTP ≠ 2xx, błąd sieci, timeout i zła treść → kod błędu bez tokenu', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => new Response('forbidden', { status: 403 }), 'CF_HTTP_ERROR'],
      [async () => { throw new TypeError('fetch failed'); }, 'CF_HTTP_ERROR'],
      [async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, 'CF_TIMEOUT'],
      [async () => new Response('<html>', { status: 200 }), 'CF_BAD_RESPONSE'],
      [async () => okResponse({ data: null, errors: [{ message: 'x' }] }), 'CF_API_ERROR'],
    ];
    for (const [impl, code] of cases) {
      const result = await fetchFieldWebVitals(28, { env: ENV, fetchImpl: vi.fn(impl) as unknown as typeof fetch, now: NOW });
      expect(result).toEqual({ status: 'error', code });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });
});

describe('bez własnej zbiórki metryk w przeglądarce (Invariant #7)', () => {
  it('klient Cloudflare jest server-only, a zbiórka to beacon CF za zgodą', () => {
    expect(readFileSync('src/lib/web-vitals/cloudflare-client.ts', 'utf8')).toMatch(/^import 'server-only';/);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['web-vitals']).toBeUndefined();
    const analytics = readFileSync('src/components/cookies/Analytics.tsx', 'utf8');
    expect(analytics).toContain("record?.categories.analytics === true");
    expect(analytics).toContain('allowsTrackingOnPath');
  });
});

describe('warstwa danych panelu admina', () => {
  it('bez bazy i bez Cloudflare = raport przykładowy oznaczony demo; z bazą = instrukcja (bez danych)', async () => {
    vi.resetModules();
    const portal = { configured: false };
    const requireAdmin = vi.fn(async () => undefined);
    vi.doMock('@/lib/db/portal', () => ({ isPortalDataConfigured: () => portal.configured }));
    vi.doMock('@/lib/data/admin', () => ({ requireAdmin }));
    vi.doMock('@/lib/error-report', () => ({ captureError: vi.fn() }));
    const saved = { ...process.env };
    delete process.env.CF_ANALYTICS_ACCOUNT_ID;
    delete process.env.CF_WEB_ANALYTICS_SITE_TAG;
    delete process.env.CF_ANALYTICS_API_TOKEN;
    try {
      const { getFieldWebVitals } = await import('@/lib/data/admin-web-vitals');
      const demo = await getFieldWebVitals(7);
      expect(demo.status === 'ok' && demo.demo).toBe(true);
      expect(requireAdmin).not.toHaveBeenCalled();
      // Kontrola ujemna: z bazą (produkcja) nigdy dane przykładowe.
      portal.configured = true;
      await expect(getFieldWebVitals(7)).resolves.toEqual({ status: 'unconfigured' });
      expect(requireAdmin).toHaveBeenCalledTimes(1);
    } finally {
      process.env = saved;
      vi.doUnmock('@/lib/db/portal');
      vi.doUnmock('@/lib/data/admin');
      vi.doUnmock('@/lib/error-report');
    }
  });
});
