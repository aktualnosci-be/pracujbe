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

const { default: sitemap, generateSitemaps } = await import('@/app/sitemap');
const { default: robots } = await import('@/app/robots');

/**
 * #599: sitemap jest teraz INDEXEM (`generateSitemaps` + `/sitemap/<id>.xml`) zamiast
 * jednego pliku. Helper spłaszcza wszystkie partie do jednej listy — tak jak zrobiłby to
 * crawler idący za `robots.txt`.
 */
async function allSitemapEntries() {
  const ids = await generateSitemaps();
  const entries = [];
  for (const { id } of ids) entries.push(...(await sitemap({ id })));
  return entries;
}

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
    const urls = (await allSitemapEntries()).map((entry) => entry.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      expect(LOCALES).toContain(segments[0]);
      expect(FORBIDDEN_SEGMENTS, url).not.toContain(segments[1]);
    }
  });

  it('#51: brak cennika, płatności, checkoutu i Stripe — bezpłatny MVP bez powierzchni sprzedaży', async () => {
    const urls = (await allSitemapEntries()).map((entry) => entry.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url).pathname, url).not.toMatch(
        /cennik|pricing|tarif|prijs|platnosci|billing|checkout|stripe|pakiet|premium/i,
      );
    }
  });

  it('brak duplikatów; każdy URL ma alternates dla 4 języków i x-default', async () => {
    const entries = await allSitemapEntries();
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
    const urls = (await allSitemapEntries()).map((entry) => entry.url);
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

  it('#599: katalog >5000 ofert dostaje WIĘCEJ partii zamiast ucięcia na pierwszej', async () => {
    let n = 0;
    jobs.getJobs.mockImplementation(async () => ({
      jobs: Array.from({ length: 100 }, () => job(String((n += 1)))),
      total: 12_000,
      page: 1,
      pageSize: 100,
    }));

    // 12 000 ofert → reachable = min(12000, MAX_JOB_LIST_OFFSET(10000) + 100) = 10100 →
    // 3 partie po 5000 (id 1, 2, 3) + core (id 0) = 4 pliki sitemap. Dawny sztywny sufit
    // dawałby TYLKO 5000 ofert łącznie, bez żadnej dalszej partii.
    const ids = await generateSitemaps(); // 1 wywołanie `getJobs` (sonda licznika)
    expect(ids).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }]);

    const entries = [];
    for (const { id } of ids) entries.push(...(await sitemap({ id })));
    const urls = entries.filter((entry) => entry.url.includes('/oferty-pracy/oferta-'));

    // Każda partia jest sama w sobie ograniczona (50 stron × 100 ofert = 5000) — pętla
    // wewnątrz jednej partii kończy się zawsze, niezależnie od `total`.
    expect(jobs.getJobs).toHaveBeenCalledTimes(1 /* sonda licznika */ + 3 * 50);
    expect(urls).toHaveLength(3 * 5000 * LOCALES.length);
  });

  it('poza produkcją: pusty sitemap i pojedynczy core sitemap bez odczytu ofert', async () => {
    state.production = false;
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    expect(await sitemap({ id: 0 })).toEqual([]);
    expect(jobs.getJobs).not.toHaveBeenCalled();
  });

  it('#591: profil firmy — jeden wpis na companySlug (zebrany z ofert, bez osobnego zapytania)', async () => {
    jobs.getJobs.mockResolvedValue({
      jobs: [
        { ...job('a'), companySlug: 'firma-x' },
        { ...job('b'), companySlug: 'firma-x' }, // druga oferta tej samej firmy — bez duplikatu wpisu
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    const entries = await sitemap({ id: 1 }); // partia ofert (#599) — profile firm idą z ofertami
    const companyUrls = entries
      .filter((entry) => new URL(entry.url).pathname.includes('/pracodawcy/'))
      .map((entry) => entry.url);
    for (const locale of LOCALES) {
      expect(companyUrls).toContain(`${SITE}/${locale}/pracodawcy/firma-x`);
    }
    // Kontrola ujemna: bez deduplikacji dwie oferty tej samej firmy dałyby 8 wpisów (2 × 4 języki),
    // nie 4 — ta asercja złapałaby regresję z Set → tablicą.
    expect(companyUrls).toHaveLength(LOCALES.length);
  });

  it('#591 kontrola ujemna: oferta demo/bez companySlug nie tworzy profilu firmy', async () => {
    jobs.getJobs.mockResolvedValue({ jobs: [job('a'), job('b')], total: 2, page: 1, pageSize: 100 });
    const entries = await sitemap({ id: 1 });
    expect(entries.some((entry) => new URL(entry.url).pathname.includes('/pracodawcy/'))).toBe(false);
  });
});

describe('robots', () => {
  it('produkcja: blokuje panele i API, wskazuje KAŻDY plik sitemap (#599: index zamiast jednego adresu)', async () => {
    const result = await robots();
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules;
    expect(rules.allow).toBe('/');
    expect(rules.disallow).toEqual(expect.arrayContaining(['/api/', '/*/candidate', '/*/employer', '/*/admin']));
    // total=2 (fixture domyślna z beforeEach) → core (id 0) + jedna partia ofert (id 1).
    expect(result.sitemap).toEqual([`${SITE}/sitemap/0.xml`, `${SITE}/sitemap/1.xml`]);
  });

  it('katalog z kilkoma partiami ofert: robots wskazuje WSZYSTKIE, nie tylko pierwszą', async () => {
    jobs.getJobs.mockResolvedValue({ jobs: [job('a')], total: 12_000, page: 1, pageSize: 1 });
    const result = await robots();
    expect(result.sitemap).toEqual([
      `${SITE}/sitemap/0.xml`,
      `${SITE}/sitemap/1.xml`,
      `${SITE}/sitemap/2.xml`,
      `${SITE}/sitemap/3.xml`,
    ]);
  });

  it('każdy katalog panelu w src/app/[locale] jest zablokowany w robots', async () => {
    const rules = (await robots()).rules;
    const disallow = (Array.isArray(rules) ? rules[0]! : rules).disallow as string[];
    for (const panel of ['candidate', 'employer', 'admin']) {
      expect(dirs(APP)).toContain(panel);
      expect(disallow).toContain(`/*/${panel}`);
    }
  });

  it('poza produkcją: Disallow: / i brak sitemap', async () => {
    state.production = false;
    expect(await robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });
});
