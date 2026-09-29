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
  getCategoryCounts: vi.fn(),
  getCityCounts: vi.fn(),
}));
// #1042: katalog ofert = kursorowe RPC (`src/lib/sitemap-jobs.ts`), bez getJobs/licznika/offsetu.
const catalog = vi.hoisted(() => ({
  getSitemapJobShardStarts: vi.fn(),
  getSitemapJobsShard: vi.fn(),
  getSitemapCompanySlugs: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: { siteUrl: 'https://pracuj.be' },
  isProductionDeployment: () => state.production,
}));
vi.mock('@/lib/jobs', () => jobs);
vi.mock('@/lib/sitemap-jobs', () => catalog);

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

/**
 * Dopasowanie reguł robots jak Google (RFC 9309): `*` = dowolny ciąg (także `/`), `$` = koniec
 * adresu, reguła = prefiks; wygrywa najdłuższa pasująca reguła, przy remisie `Allow`.
 */
function robotsAllows(path: string, allow: string[], disallow: string[]): boolean {
  const matches = (rule: string) => {
    const anchored = rule.endsWith('$');
    const body = (anchored ? rule.slice(0, -1) : rule)
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
  };
  const longest = (rules: string[]) => Math.max(-1, ...rules.filter(matches).map((rule) => rule.length));
  return longest(allow) >= longest(disallow);
}
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
  return {
    id,
    slug: `oferta-${id}`,
    publishedAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    locales: [] as string[],
  };
}

/** Katalog z `shards` partiami; `rows(shardIndex)` = oferty partii (numer od 1, jak w RPC). */
function setCatalog(shards: number, rows: (shardIndex: number) => ReturnType<typeof job>[]) {
  catalog.getSitemapJobShardStarts.mockResolvedValue(
    Array.from({ length: shards }, (_, i) => ({ shardIndex: i + 1, after: null })),
  );
  catalog.getSitemapJobsShard.mockImplementation(async (shardIndex: number) => rows(shardIndex));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.production = true;
  jobs.getCategoryCounts.mockResolvedValue({ construction: 3, warehouse: 1 });
  jobs.getCityCounts.mockImplementation(async (_l: string, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, key === 'ghent' ? 2 : 0])),
  );
  setCatalog(1, () => [job('a'), job('b')]);
  catalog.getSitemapCompanySlugs.mockResolvedValue([]);
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
    // 3 granice partii z bazy = 3 pliki ofert (id 1, 2, 3) + core (id 0); każda partia 5000 ofert.
    setCatalog(3, () => Array.from({ length: 5000 }, () => job(String((n += 1)))));

    const ids = await generateSitemaps(); // jedno zapytanie o granice, bez licznika ofert
    expect(ids).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }]);
    expect(catalog.getSitemapJobShardStarts).toHaveBeenCalledTimes(1);
    expect(catalog.getSitemapJobShardStarts).toHaveBeenCalledWith(5000);

    const entries = [];
    for (const { id } of ids) entries.push(...(await sitemap({ id })));
    const urls = entries.filter((entry) => entry.url.includes('/oferty-pracy/oferta-'));

    // Każda partia = jedno wywołanie kursorowe (bez pętli po stronach offsetu, bez sufitu 10 100).
    expect(catalog.getSitemapJobsShard).toHaveBeenCalledTimes(3);
    expect(urls).toHaveLength(3 * 5000 * LOCALES.length);
  });

  it('#1042: katalog powyżej dawnego sufitu offsetu (10 100 ofert) nie jest ucinany', async () => {
    setCatalog(4, () => []);
    expect(await generateSitemaps()).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  });

  it('#1042: brak ofert = sam core sitemap (bez plików ofert)', async () => {
    setCatalog(0, () => []);
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
  });

  it('poza produkcją: pusty sitemap i pojedynczy core sitemap bez odczytu ofert', async () => {
    state.production = false;
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    expect(await sitemap({ id: 0 })).toEqual([]);
    expect(catalog.getSitemapJobShardStarts).not.toHaveBeenCalled();
    expect(catalog.getSitemapJobsShard).not.toHaveBeenCalled();
  });

  it('#591/#1231: profil firmy — jeden wpis na companySlug w CAŁYM indeksie (partia 0)', async () => {
    // Firma X ma oferty w dwóch partiach ofert; slugi firm (zdeduplikowane kursorem po całym
    // katalogu, `getSitemapCompanySlugs`) trafiają tylko do partii 0.
    setCatalog(2, (shard) =>
      shard === 1
        ? [{ ...job('a'), companySlug: 'firma-x' }, { ...job('b'), companySlug: 'firma-x' }]
        : [{ ...job('c'), companySlug: 'firma-x' }, { ...job('d'), companySlug: 'firma-y' }],
    );
    catalog.getSitemapCompanySlugs.mockResolvedValue(['firma-x', 'firma-y']);
    const perFile = [];
    for (const { id } of await generateSitemaps()) {
      perFile.push({
        id,
        companies: (await sitemap({ id }))
          .map((entry) => entry.url)
          .filter((url) => new URL(url).pathname.includes('/pracodawcy/')),
      });
    }
    const all = perFile.flatMap((file) => file.companies);
    for (const locale of LOCALES) {
      expect(all).toContain(`${SITE}/${locale}/pracodawcy/firma-x`);
      expect(all).toContain(`${SITE}/${locale}/pracodawcy/firma-y`);
    }
    // Kontrola ujemna: dawny Set per partia dawał firma-x w partiach 1 i 2 (8 wpisów zamiast 4).
    expect(all).toHaveLength(2 * LOCALES.length);
    expect(new Set(all).size).toBe(all.length);
    expect(perFile.filter((file) => file.companies.length > 0).map((file) => file.id)).toEqual([0]);
    expect(catalog.getSitemapCompanySlugs).toHaveBeenCalledTimes(1);
  });

  it('#591 kontrola ujemna: oferta demo/bez companySlug nie tworzy profilu firmy', async () => {
    const entries = [...(await sitemap({ id: 0 })), ...(await sitemap({ id: 1 }))];
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

  it("id '0' = strony statyczne, landingi, poradniki i profile firm; bez URL-i ofert", async () => {
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
    expect(catalog.getSitemapJobsShard).not.toHaveBeenCalled();
  });

  it("id '1' = pierwsza partia ofert (RPC nr 1), bez stron statycznych; '0' i '1' się nie dublują", async () => {
    const shard = await sitemap({ id: '1' });
    const urls = shard.map((entry) => entry.url);
    expect(urls).toContain(`${SITE}/pl/oferty-pracy/oferta-a`);
    expect(urls).not.toContain(`${SITE}/pl/praca`);
    expect(catalog.getSitemapJobsShard).toHaveBeenCalledTimes(1);
    expect(catalog.getSitemapJobsShard).toHaveBeenCalledWith(1, 5000);
    const core = new Set((await sitemap({ id: '0' })).map((entry) => entry.url));
    expect(urls.filter((url) => core.has(url))).toEqual([]);
  });

  it("id '2' czyta partię nr 2 (numer pliku = numer partii RPC, bez przesunięcia)", async () => {
    setCatalog(3, (shard) => [job(`z${shard}`)]);
    const urls = (await sitemap({ id: '2' })).map((entry) => entry.url);
    expect(catalog.getSitemapJobsShard).toHaveBeenCalledWith(2, 5000);
    expect(urls).toContain(`${SITE}/pl/oferty-pracy/oferta-z2`);
    expect(urls.some((url) => url.includes('oferta-z1') || url.includes('oferta-z3'))).toBe(false);
  });

  it('niepoprawne id = pusty plik bez zapytań do bazy', async () => {
    for (const bad of ['-1', 'abc', '', ' 1', '01', '1.5', '1e0', '0x1', '101', '999', undefined, -1, 1.5, NaN]) {
      expect(await sitemap({ id: bad as string | number | undefined }), String(bad)).toEqual([]);
    }
    expect(jobs.getCategoryCounts).not.toHaveBeenCalled();
    expect(catalog.getSitemapJobsShard).not.toHaveBeenCalled();
  });

  it('parseSitemapId: liczby i ich kanoniczny zapis dziesiętny w granicy partii', () => {
    expect(parseSitemapId('0')).toBe(0);
    expect(parseSitemapId(0)).toBe(0);
    expect(parseSitemapId('2')).toBe(2);
    // Granica niezależna od bazy (#1042): 100 partii po 5000 ofert; powyżej — pusty plik bez zapytań.
    expect(parseSitemapId('100')).toBe(100);
    expect(parseSitemapId('101')).toBeNull();
    expect(parseSitemapId(101)).toBeNull();
  });
});

describe('robots', () => {
  it('produkcja: blokuje panele i API, wskazuje KAŻDY plik sitemap (#599: index zamiast jednego adresu)', async () => {
    const result = await robots();
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules;
    expect(rules.allow).toBe('/');
    expect(rules.disallow).toEqual(expect.arrayContaining(['/api/', '/pl/candidate$', '/pl/candidate/', '/nl/admin/']));
    // Jedna partia (fixture domyślna z beforeEach) → core (id 0) + jedna partia ofert (id 1).
    expect(result.sitemap).toEqual([`${SITE}/sitemap/0.xml`, `${SITE}/sitemap/1.xml`]);
  });

  it('katalog z kilkoma partiami ofert: robots wskazuje WSZYSTKIE, nie tylko pierwszą', async () => {
    setCatalog(3, () => [job('a')]);
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
      for (const locale of LOCALES) {
        expect(disallow).toContain(`/${locale}/${panel}$`);
        expect(disallow).toContain(`/${locale}/${panel}/`);
      }
    }
  });

  it('#1217: slugi zaczynające się od nazwy panelu nie są blokowane, same panele tak', async () => {
    const result = await robots();
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules;
    const disallow = rules.disallow as string[];
    const allow = [rules.allow as string];
    const allowed = [
      '/nl/oferty-pracy/administratief-bediende-1a2b3c4d',
      '/pl/pracodawcy/administratiekantoor-peeters',
      '/pl/oferty-pracy/employer-branding-specialist-12ab',
      '/fr/oferty-pracy/candidate-experience-manager-9f8e',
      '/pl/oferty-pracy/magazynier-1a2b',
      '/pl/candidates-guide',
    ];
    const blocked = [
      '/pl/candidate',
      '/pl/candidate/profil',
      '/nl/employer',
      '/nl/employer/oferty?x=1',
      '/en/admin',
      '/fr/admin/firmy/1',
      '/api/health',
    ];
    for (const path of allowed) expect(robotsAllows(path, allow, disallow), path).toBe(true);
    for (const path of blocked) expect(robotsAllows(path, allow, disallow), path).toBe(false);
    // Kontrola ujemna: dawne reguły z gwiazdką blokowały slug „administratief-…”.
    const legacy = ['/api/', '/*/candidate', '/*/employer', '/*/admin'];
    expect(robotsAllows('/nl/oferty-pracy/administratief-bediende-1a2b3c4d', allow, legacy)).toBe(false);
    expect(robotsAllows('/pl/oferty-pracy/employer-branding-specialist-12ab', allow, legacy)).toBe(false);
  });

  it('poza produkcją: Disallow: / i brak sitemap', async () => {
    state.production = false;
    expect(await robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });
});
