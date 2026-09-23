import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #374 — Invariant #9 w gałęzi PRODUKCYJNEJ `sitemap.ts` i `robots.ts` (E2E działa poza
 * produkcją, gdzie sitemap jest pusty, a robots blokuje wszystko). Listy zakazanych tras
 * powstają z systemu plików, więc nowa strona panelu/auth/prawna jest objęta automatycznie.
 */

const state = vi.hoisted(() => ({ production: true }));
const jobs = vi.hoisted(() => ({
  getJobs: vi.fn(),
  getCategoryCounts: vi.fn(),
  getCityCounts: vi.fn(),
  getJobsAvailableLocales: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: { siteUrl: 'https://pracuj.be' },
  isProductionDeployment: () => state.production,
}));
vi.mock('@/lib/jobs', () => jobs);

const { default: sitemap } = await import('@/app/sitemap');
const { default: robots } = await import('@/app/robots');

const SITE = 'https://pracuj.be';
const LOCALES = ['pl', 'nl', 'fr', 'en'];
const APP = join(process.cwd(), 'src/app/[locale]');

function dirs(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/** Pierwsze segmenty tras, które nie mogą trafić do sitemap: panele, auth, strony z placeholderem prawnym. */
const FORBIDDEN_SEGMENTS = [
  'candidate',
  'employer',
  'admin',
  'api',
  'offline',
  ...dirs(join(APP, '(auth)')),
  ...dirs(join(APP, '(public)')).filter((name) => {
    try {
      return readFileSync(join(APP, '(public)', name, 'page.tsx'), 'utf8').includes('_legal/legal-page');
    } catch {
      return false;
    }
  }),
];

function job(id: string) {
  return { id, slug: `oferta-${id}`, publishedAt: '2026-09-01T00:00:00.000Z' };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.production = true;
  jobs.getCategoryCounts.mockResolvedValue({ construction: 3, warehouse: 1 });
  jobs.getCityCounts.mockImplementation(async (_l: string, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, key === 'ghent' ? 2 : 0])),
  );
  jobs.getJobs.mockResolvedValue({ jobs: [job('a'), job('b')], total: 2, page: 1, pageSize: 100 });
  jobs.getJobsAvailableLocales.mockResolvedValue(null);
});

describe('sitemap (produkcja)', () => {
  it('lista zakazanych segmentów pochodzi z systemu plików i obejmuje auth oraz strony prawne', () => {
    expect(FORBIDDEN_SEGMENTS).toEqual(expect.arrayContaining(['logowanie', 'rejestracja', 'reset-hasla', 'regulamin']));
  });

  it('żaden URL nie prowadzi do panelu, API, auth, offline ani strony z placeholderem prawnym', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      expect(LOCALES).toContain(segments[0]);
      expect(FORBIDDEN_SEGMENTS, url).not.toContain(segments[1]);
    }
  });

  it('brak duplikatów; każdy URL ma alternates dla 4 języków i x-default', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const entry of entries) {
      const languages = entry.alternates?.languages as Record<string, string>;
      expect(Object.keys(languages).sort(), entry.url).toEqual([...LOCALES, 'x-default'].sort());
      expect(Object.values(languages)).toContain(entry.url);
      expect(languages['x-default']).toBe(languages.pl);
    }
  });

  it('zawiera strony publiczne we wszystkich językach', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    for (const locale of LOCALES) {
      expect(urls).toEqual(
        expect.arrayContaining([
          `${SITE}/${locale}`,
          `${SITE}/${locale}/oferty-pracy`,
          `${SITE}/${locale}/praca/kategoria/construction`,
          `${SITE}/${locale}/praca/miasto/ghent`,
          `${SITE}/${locale}/oferty-pracy/oferta-a`,
        ]),
      );
    }
  });

  it('paginacja ofert kończy się na suficie 5000 (nie pętli bez końca)', async () => {
    let n = 0;
    jobs.getJobs.mockImplementation(async () => ({
      jobs: Array.from({ length: 100 }, () => job(String((n += 1)))),
      total: 1_000_000,
      page: 1,
      pageSize: 100,
    }));
    const urls = (await sitemap()).filter((entry) => entry.url.includes('/oferty-pracy/oferta-'));
    expect(jobs.getJobs).toHaveBeenCalledTimes(50);
    expect(urls).toHaveLength(5000 * LOCALES.length);
  });

  it('poza produkcją: pusty sitemap bez odczytu ofert', async () => {
    state.production = false;
    expect(await sitemap()).toEqual([]);
    expect(jobs.getJobs).not.toHaveBeenCalled();
  });
});

describe('robots', () => {
  it('produkcja: blokuje panele i API, wskazuje sitemap', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules;
    expect(rules.allow).toBe('/');
    expect(rules.disallow).toEqual(expect.arrayContaining(['/api/', '/*/candidate', '/*/employer', '/*/admin']));
    expect(result.sitemap).toBe(`${SITE}/sitemap.xml`);
  });

  it('każdy katalog panelu w src/app/[locale] jest zablokowany w robots', () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules[0]! : rules).disallow as string[];
    for (const panel of ['candidate', 'employer', 'admin']) {
      expect(dirs(APP)).toContain(panel);
      expect(disallow).toContain(`/*/${panel}`);
    }
  });

  it('poza produkcją: Disallow: / i brak sitemap', () => {
    state.production = false;
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });
});
