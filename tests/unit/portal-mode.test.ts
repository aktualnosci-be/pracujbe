// @vitest-environment node
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, isAppError, toUserMessageKey } from '@/lib/errors';
import {
  PORTAL_LEGAL_MODE_ENV,
  assertRecruitmentEnabled,
  isRecruitmentEnabled,
  notFoundUnlessRecruitment,
  portalLegalMode,
} from '@/lib/portal-mode';

/**
 * #1136 — flaga trybu produktu (decyzja produktowa: portal ogłoszeniowy). Fail-closed:
 * rekrutację włącza wyłącznie dokładna wartość `RECRUITMENT`.
 */

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => ({ query: queryMock }) }));

afterEach(() => vi.unstubAllEnvs());

/** Mutacje do kontroli ujemnych — tak NIE wolno liczyć trybu. */
function mutantDefaultRecruitment(raw: string | undefined): string {
  const v = (raw ?? '').trim().toUpperCase();
  return v === 'CLASSIFIEDS_ONLY' ? 'CLASSIFIEDS_ONLY' : 'RECRUITMENT';
}
function mutantStartsWith(raw: string | undefined): string {
  return (raw ?? '').trim().toUpperCase().startsWith('RECRUITMENT') ? 'RECRUITMENT' : 'CLASSIFIEDS_ONLY';
}

const ENABLING = ['RECRUITMENT', ' recruitment ', 'Recruitment'];
const DISABLING = ['', ' ', 'true', '1', 'FULL', 'RECRUITMENT_', 'RECRUITMENTS', 'RECRUIT', 'CLASSIFIEDS_ONLY', 'on'];

describe('portalLegalMode()', () => {
  it('brak zmiennej = CLASSIFIEDS_ONLY', () => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, undefined as unknown as string);
    delete process.env[PORTAL_LEGAL_MODE_ENV];
    expect(portalLegalMode()).toBe('CLASSIFIEDS_ONLY');
    expect(isRecruitmentEnabled()).toBe(false);
  });

  it.each(ENABLING)('%j → RECRUITMENT', (value) => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, value);
    expect(portalLegalMode()).toBe('RECRUITMENT');
    expect(isRecruitmentEnabled()).toBe(true);
    expect(isRecruitmentEnabled('applications')).toBe(true);
  });

  it.each(DISABLING)('%j → CLASSIFIEDS_ONLY', (value) => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, value);
    expect(portalLegalMode()).toBe('CLASSIFIEDS_ONLY');
    expect(isRecruitmentEnabled()).toBe(false);
  });

  it('kontrola ujemna: mutacja „domyślnie RECRUITMENT” i porównanie startsWith nie przechodzą tych przypadków', () => {
    const expected = (raw: string | undefined) => (DISABLING.includes(raw ?? '') || raw === undefined ? 'CLASSIFIEDS_ONLY' : 'RECRUITMENT');
    const cases: (string | undefined)[] = [undefined, ...DISABLING, ...ENABLING];
    const failsDefault = cases.some((c) => mutantDefaultRecruitment(c) !== expected(c));
    const failsStartsWith = cases.some((c) => mutantStartsWith(c) !== expected(c));
    expect(failsDefault).toBe(true);
    expect(failsStartsWith).toBe(true);
    // A implementacja przechodzi wszystkie.
    for (const c of cases) {
      if (c === undefined) delete process.env[PORTAL_LEGAL_MODE_ENV];
      else vi.stubEnv(PORTAL_LEGAL_MODE_ENV, c);
      expect(portalLegalMode()).toBe(expected(c));
    }
  });

  it('odczyt leniwy: zmiana zmiennej działa bez przeładowania modułu', () => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    expect(isRecruitmentEnabled()).toBe(true);
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
    expect(isRecruitmentEnabled()).toBe(false);
  });
});

describe('assertRecruitmentEnabled() / notFoundUnlessRecruitment()', () => {
  it('tryb ogłoszeniowy: rzuca AppError RECRUITMENT_DISABLED z kluczem tłumaczenia', () => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
    let caught: unknown;
    try {
      assertRecruitmentEnabled('offers');
    } catch (e) {
      caught = e;
    }
    expect(isAppError(caught)).toBe(true);
    expect((caught as AppError).code).toBe('RECRUITMENT_DISABLED');
    expect((caught as AppError).userMessageKey).toBe('errors.recruitmentDisabled');
    expect(toUserMessageKey('RECRUITMENT_DISABLED')).toBe('errors.recruitmentDisabled');
  });

  it('tryb RECRUITMENT: nie rzuca', () => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    expect(() => assertRecruitmentEnabled()).not.toThrow();
    expect(() => notFoundUnlessRecruitment()).not.toThrow();
  });

  it('tryb ogłoszeniowy: notFoundUnlessRecruitment() wywołuje notFound() (404)', () => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'yes');
    let caught: unknown;
    try {
      notFoundUnlessRecruitment('candidateSearch');
    } catch (e) {
      caught = e;
    }
    expect(String((caught as { digest?: string } | undefined)?.digest ?? '')).toMatch(/404|NOT_FOUND/);
  });
});

describe('komunikat RECRUITMENT_DISABLED', () => {
  it.each(['pl', 'nl', 'fr', 'en'])('%s: klucz errors.recruitmentDisabled istnieje i jest neutralny', (locale) => {
    const messages = JSON.parse(readFileSync(`src/messages/${locale}.json`, 'utf8')) as {
      errors: Record<string, string>;
    };
    const text = messages.errors.recruitmentDisabled ?? "";
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(10);
    // Bez technikaliów (Invariant #8) i bez nazw trybów/zmiennych.
    expect(text).not.toMatch(/RECRUITMENT|CLASSIFIEDS|PORTAL_LEGAL_MODE|error|SQL/);
  });
});

describe('moduł działa w middleware/edge i w bundlu klienta', () => {
  it('nie importuje server-only ani node:*', () => {
    const source = readFileSync('src/lib/portal-mode.ts', 'utf8');
    expect(source).not.toMatch(/['"]server-only['"]/);
    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toMatch(/require\(['"]node:/);
    // Importy tylko z listy dozwolonych (bez modułów serwerowych).
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['@/lib/errors', 'next/navigation']);
  });

  it('env.ts nie importuje portal-mode (env.ts trafia do bundla klienta bez next/navigation)', () => {
    expect(readFileSync('src/lib/env.ts', 'utf8')).not.toMatch(/portal-mode/);
  });
});

describe('GET /api/health — tryb tylko w szczegółach', () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [{ ok: 1 }] });
  });

  async function get(headers: Record<string, string> = {}) {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(new Request('https://pracuj.be/api/health', { headers }));
    return (await res.json()) as Record<string, unknown>;
  }

  it('produkcja bez sekretu: brak portalLegalMode', async () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('HEALTH_CHECK_SECRET', 's'.repeat(32));
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    const body = await get();
    expect(Object.keys(body)).toEqual(['status']);
  });

  it('produkcja z sekretem: portalLegalMode = nazwa trybu', async () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv('HEALTH_CHECK_SECRET', 's'.repeat(32));
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
    expect((await get({ 'x-health-token': 's'.repeat(32) })).portalLegalMode).toBe('CLASSIFIEDS_ONLY');
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    expect((await get({ 'x-health-token': 's'.repeat(32) })).portalLegalMode).toBe('RECRUITMENT');
  });

  it('tryb nie wpływa na status gotowości', async () => {
    vi.stubEnv('APP_MODE', 'demo');
    vi.stubEnv('DATABASE_APP_URL', 'postgres://example/db');
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
    const a = await get();
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    const b = await get();
    expect(a.status).toBe(b.status);
  });
});
