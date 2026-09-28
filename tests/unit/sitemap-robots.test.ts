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

const { default: sitemap, generateSitemaps, parseSitemapId } = await import('@/app/sitemap');
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

  it('#691: brak dawnej atrapy /faq (308 na /pomoc), /pomoc jest w każdym języku', async () => {
    const paths = (await allSitemapEntries()).map((entry) => new URL(entry.url).pathname);
    // Strona usunięta z systemu plików nie trafia już do FORBIDDEN_SEGMENTS, więc tylko ta
    // asercja łapie powrót `/faq` do STATIC_PATHS (kontrola ujemna: dopisanie '/faq' = czerwony).
    expect(FORBIDDEN_SEGMENTS).not.toContain('faq');
    for (const path of paths) expect(path, path).not.toMatch(/^\/[a-z]{2}\/faq(\/|$)/);
    for (const locale of LOCALES) expect(paths).toContain(`/${locale}/pomoc`);
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

/**
 * SEO-01: Next.js 15.5 woła `sitemap({ id })` z fragmentem adresu `/sitemap/<id>.xml` jako
 * TEKSTEM (`'0'`), nie liczbą z `generateSitemaps()`. Stare `id === 0` kierowało `'0'` do
 * partii ofert nr -1: brak stron statycznych/landingów/poradników w KAŻDYM pliku i 50 zapytań
 * o tę samą pierwszą stronę ofert. Testy wyżej wołają liczbą, więc tego nie łapały.
 */
describe('sitemap: id jako tekst (Next.js 15.5, SEO-01)', () => {
  it('loader Next.js przekazuje handlerowi id jako string (fragment adresu bez .xml)', () => {
    const loader = readFileSync(
      join(process.cwd(), 'node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js'),
      'utf8',
    );
    // Gdy ten kontrakt się zmieni (aktualizacja Next), test wskaże, że założenie trzeba sprawdzić.
    expect(loader).toContain('id.slice(0, -4)');
    expect(loader).toContain('handler({ id: targetId })');
  });

  it("id '0' = strony statyczne, landingi i poradniki; bez odczytu listy ofert", async () => {
    const urls = (await sitemap({ id: '0' })).map((entry) => entry.url);
    for (const locale of LOCALES) {
      expect(urls).toContain(`${SITE}/${locale}`);
      expect(urls).toContain(`${SITE}/${locale}/praca`);
      expect(urls).toContain(`${SITE}/${locale}/praca/kategoria/construction`);
    }
    expect(urls.some((url) => url.includes('/poradniki/'))).toBe(true);
    // Kontrola ujemna: stare `id === 0` dawało dla '0' partię ofert (-1) — oferty, getJobs
    // z numerem strony ≤ 0 i zero stron statycznych; każda z tych asercji byłaby czerwona.
    expect(urls.some((url) => url.includes('/oferty-pracy/oferta-'))).toBe(false);
    expect(jobs.getJobs).not.toHaveBeenCalled();
  });

  it("id '1' = pierwsza partia ofert od strony 1, bez stron statycznych; '0' i '1' się nie dublują", async () => {
    const shard = await sitemap({ id: '1' });
    const urls = shard.map((entry) => entry.url);
    expect(urls).toContain(`${SITE}/pl/oferty-pracy/oferta-a`);
    expect(urls).not.toContain(`${SITE}/pl/praca`);
    expect(jobs.getJobs).toHaveBeenCalledTimes(1);
    expect(jobs.getJobs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 100 }));
    const core = new Set((await sitemap({ id: '0' })).map((entry) => entry.url));
    expect(urls.filter((url) => core.has(url))).toEqual([]);
  });

  it("id '2' zaczyna od strony 51 (partie nie są przesunięte)", async () => {
    jobs.getJobs.mockResolvedValue({ jobs: [job('z')], total: 12_000, page: 51, pageSize: 100 });
    await sitemap({ id: '2' });
    expect(jobs.getJobs).toHaveBeenCalledWith(expect.objectContaining({ page: 51 }));
  });

  it('niepoprawne id = pusty plik bez zapytań do bazy', async () => {
    for (const bad of ['-1', 'abc', '', ' 1', '01', '1.5', '1e0', '0x1', '4', '999', undefined, -1, 1.5, NaN]) {
      expect(await sitemap({ id: bad as string | number | undefined }), String(bad)).toEqual([]);
    }
    expect(jobs.getCategoryCounts).not.toHaveBeenCalled();
    expect(jobs.getJobs).not.toHaveBeenCalled();
  });

  it('parseSitemapId: liczby i ich kanoniczny zapis dziesiętny w granicy partii', () => {
    expect(parseSitemapId('0')).toBe(0);
    expect(parseSitemapId(0)).toBe(0);
    expect(parseSitemapId('2')).toBe(2);
    // Granica = ceil((MAX_JOB_LIST_OFFSET + 100) / 5000) = 3 — ta sama, do której dochodzi
    // `generateSitemaps()` przy największym osiągalnym katalogu (test #599 wyżej: id 0..3).
    expect(parseSitemapId('3')).toBe(3);
    expect(parseSitemapId('4')).toBeNull();
    expect(parseSitemapId(4)).toBeNull();
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
