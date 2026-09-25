// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runProductionSmoke } from '../../scripts/production-smoke.mjs';

/**
 * Test wdrożeniowy (#12): przechodzi tylko produkcja z oczekiwanym SHA, panelami za logowaniem
 * i indeksowaniem produkcyjnym. Kontrole ujemne odtwarzają stany obserwowane na produkcji
 * 22–23.09 (mode=demo, panele demo bez sesji, Disallow: /, canonical localhost).
 */

const BASE = 'https://pracuj.be';
const TOKEN = 'h'.repeat(40);

interface Site {
  mode: string;
  version: string;
  panelStatus: number;
  robots: string;
  canonical: string;
  healthStatus?: number;
}

const PRODUCTION: Site = {
  mode: 'production',
  version: '0.20260925.123+abc1234',
  panelStatus: 307,
  robots: 'User-Agent: *\nAllow: /\nDisallow: /api/\n',
  canonical: `${BASE}/pl`,
};

function fakeFetch(site: Site): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok', mode: site.mode, version: site.version }, { status: site.healthStatus ?? 200 });
    }
    const panel = /^\/(pl|nl|fr|en)\/(candidate|employer|admin)$/u.exec(url.pathname);
    if (panel) {
      return site.panelStatus === 200
        ? new Response('<html>panel demo</html>', { status: 200 })
        : new Response(null, { status: site.panelStatus, headers: { location: `/${panel[1]}/logowanie` } });
    }
    if (url.pathname === '/robots.txt') return new Response(site.robots);
    if (url.pathname === '/pl') return new Response(`<html><head><link rel="canonical" href="${site.canonical}"/></head></html>`);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

const env = (extra: Record<string, string> = {}) => ({
  SMOKE_BASE_URL: BASE, HEALTH_CHECK_SECRET: TOKEN, EXPECTED_SHA: 'abc1234def5678', ...extra,
});

describe('runProductionSmoke', () => {
  it('produkcja z oczekiwanym SHA i panelami za logowaniem = OK', async () => {
    expect(await runProductionSmoke({ env: env(), fetchImpl: fakeFetch(PRODUCTION) })).toEqual({ ok: true, failures: [] });
  });

  it.each([
    ['tryb demo', { mode: 'demo' }, /mode=demo/],
    ['stary deploy (inny SHA)', { version: '0.20260924.1+0ld5ha9' }, /nie odpowiada/],
    ['panele demo bez sesji', { panelStatus: 200 }, /candidate: HTTP 200/],
    ['robots blokuje wszystko', { robots: 'User-Agent: *\nDisallow: /\n' }, /robots/],
    ['canonical z localhost', { canonical: 'http://localhost:3000/pl' }, /canonical/],
    ['health 503', { healthStatus: 503 }, /health: HTTP 503/],
  ] as const)('kontrola ujemna: %s → porażka', async (_label, change, pattern) => {
    const result = await runProductionSmoke({ env: env(), fetchImpl: fakeFetch({ ...PRODUCTION, ...change }) });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(pattern);
    // Raport nie zawiera sekretu.
    expect(result.failures.join('\n')).not.toContain(TOKEN);
  });

  it('SHA bez tokenu nie jest sprawdzalne → porażka zamiast cichego sukcesu', async () => {
    const result = await runProductionSmoke({ env: env({ HEALTH_CHECK_SECRET: '' }), fetchImpl: fakeFetch(PRODUCTION) });
    expect(result.ok).toBe(false);
  });

  it.each(['', 'http://pracuj.be', 'https://pracuj.be/pl'])('zły SMOKE_BASE_URL „%s” → błąd konfiguracji', async (url) => {
    expect(await runProductionSmoke({ env: { SMOKE_BASE_URL: url }, fetchImpl: fakeFetch(PRODUCTION) }))
      .toMatchObject({ ok: false, config: true });
  });
});
