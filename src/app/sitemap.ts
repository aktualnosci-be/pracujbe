import type { MetadataRoute } from 'next';

import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { isSearchIndexingEnabled } from '@/lib/seo/indexing';
import {
  getCategoryCounts,
  getCityCounts,
  getJobs,
  getJobsAvailableLocales,
  getJobsCount,
  type CategoryKey,
} from '@/lib/jobs';
import { MAX_JOB_LIST_OFFSET } from '@/lib/job-list-pagination';
import { getAllGuideSlugs } from '@/lib/guides/guides';
import { pickXDefaultLocale } from '@/lib/seo/locales';
import { sitemapEntriesCache, sitemapIdsCache } from '@/lib/cache/sitemap-cache';
import { CITY_LANDING_KEYS, cityLandingQualifies } from '@/lib/locations/city-landings';

/**
 * Mapa strony — Pracuj.be. Sitemap INDEX (#599): id `0` = strony statyczne, landing-page'e
 * kategorii/lokalizacji i poradniki (jeden plik wystarcza — kilkadziesiąt URL-i); id `1..N` =
 * kolejne partie szczegółów ofert (`JOBS_PER_SITEMAP_SHARD` na plik), po `generateSitemaps()`
 * dostępne pod `/sitemap/<id>.xml` (konwencja Next.js — patrz `robots.ts`, który wylicza te
 * same identyfikatory i wskazuje każdy plik osobno zamiast pojedynczego adresu).
 *
 * Dawny sztywny sufit `SITEMAP_MAX_JOBS = 5000` (jeden plik, bez dalszych partii) ucinał
 * katalog bezpowrotnie — starsze/dalsze oferty zostawały publiczne, ale poza sitemapem (#599).
 * Teraz partii przybywa wraz z wolumenem, aż do granicy paginacji publicznej listy ofert
 * (`MAX_JOB_LIST_OFFSET`, #593) — powyżej niej `get_public_jobs` i tak nie oddaje kolejnych
 * wyników przez offset (odrębne ograniczenie backendu list, nie tego pliku).
 *
 * Każdy wpis ma alternatywy językowe (hreflang). Panele (candidate/employer/admin) i API są
 * celowo pominięte (patrz `robots.ts`). Działa bez env (dane demonstracyjne z `getJobs`).
 *
 * Profile firm (#591) są w partii `0` (PERF-05, #1231): jeden wpis na `companySlug` zebrany
 * z jednej iteracji po WSZYSTKICH osiągalnych ofertach (strony listy bez licznika, #1230),
 * więc firma z ofertami w kilku partiach ofert nie powtarza się między plikami sitemap.
 * Dane demonstracyjne nie mają `companySlug`, więc profili firm tam nie ma.
 *
 * TODO(i18n-slugs): segment listy ofert jest wspólny (`oferty-pracy`) — po wdrożeniu
 * lokalizowanych slugów zaktualizować ścieżki per język.
 */

/**
 * Generowany per żądanie, nie w `next build` (#429). W produkcji build celowo nie czyta bazy
 * (#534: liczniki i oferty w fazie builda = brak danych), a sitemap bez liczników nie może
 * zgadywać — prerender przerywał build z `APP_MODE=production` (Railway buduje ze zmiennymi
 * usługi). Per żądanie sitemap widzi aktualne oferty; roboty pobierają go rzadko.
 * Strażnik: `tests/unit/readiness-postgres-only.test.ts`.
 *
 * Koszt powtarzanych żądań (#1042, krok 1): wynik każdego pliku i lista partii są trzymane w
 * pamięci procesu przez 3600 s z deduplikacją równoległych obliczeń (`sitemap-cache.ts`), więc
 * anonimowe pobieranie sitemapy nie liczy ofert za każdym razem.
 */
export const dynamic = 'force-dynamic';

/** Ofert szczegółowych na jeden plik sitemap (dużo poniżej limitu protokołu 50 000 URL-i). */
const JOBS_PER_SITEMAP_SHARD = 5000;
/** Rozmiar strony przy odpytywaniu `getJobs` wewnątrz jednej partii (jak dotąd). */
const SITEMAP_JOBS_PAGE = 100;

/**
 * Liczba partii ofert (id `1..N`) potrzebna dla obecnego wolumenu. Wołana tylko przy włączonym
 * indeksowaniu — poza nim `generateSitemaps` zwraca sam core bez odczytu bazy (#429, #1115). `getJobsCount` jest dokładnym licznikiem publicznych
 * ofert (P1-12), niezależnym od sufitu paginacji offsetowej; bez odczytu wierszy (#1230).
 */
async function jobSitemapShardCount(): Promise<number> {
  const total = await getJobsCount({ locale: routing.defaultLocale });
  const reachable = Math.min(total, MAX_JOB_LIST_OFFSET + SITEMAP_JOBS_PAGE);
  return Math.max(0, Math.ceil(reachable / JOBS_PER_SITEMAP_SHARD));
}

/** Identyfikatory plików sitemap: `0` = core, `1..N` = partie ofert (Next.js: `generateSitemaps`). */
export async function generateSitemaps(): Promise<{ id: number }[]> {
  // Poza indeksowaniem (nie-produkcja albo bramka hasła, #1115): sam core, bez odczytu bazy.
  // Sprawdzenie PRZED cache — lista partii policzona za bramką nie zostaje po jej zdjęciu.
  if (!isSearchIndexingEnabled()) return [{ id: 0 }];
  return sitemapIdsCache.run('ids', async () => {
    const jobShards = await jobSitemapShardCount();
    return Array.from({ length: jobShards + 1 }, (_, id) => ({ id }));
  });
}

const JOBS_PATH = '/oferty-pracy';
const COMPANIES_PATH = '/pracodawcy';
const HUB_PATH = '/praca';
const GUIDES_PATH = '/poradniki';
const EMPLOYERS_PATH = '/dla-pracodawcow';
const HELP_PATH = '/pomoc';
const CONTACT_PATH = '/kontakt';

/** Publiczne strony statyczne (segment bez prefiksu języka). '' = strona główna.
 *  Tylko trasy zwracające 200 (zweryfikowane smoke) i z REALNĄ treścią.
 *  Pomoc i Kontakt (#61) mają realną treść (FAQ z faktów produktu, formularz kontaktu).
 *  Strony prawne/informacyjne (regulamin, prywatność, cookies, o-nas) mają obecnie treść
 *  placeholder → są `noindex` i CELOWO poza sitemap (audyt FUN-09).
 *  Po zatwierdzeniu treści dodać je tu z powrotem i zdjąć `noindex` w `_legal/legal-page.tsx`. */
const STATIC_PATHS: readonly string[] = [
  '',
  JOBS_PATH,
  HUB_PATH,
  GUIDES_PATH,
  EMPLOYERS_PATH,
  HELP_PATH,
  CONTACT_PATH,
];

const CATEGORY_KEYS: readonly CategoryKey[] = [
  'construction',
  'transport',
  'warehouse',
  'production',
  'technical',
  'cleaning',
  'hospitality',
  'care',
  'logistics',
  'seasonal',
];

/** Buduje mapę hreflang { locale -> absolutny URL } dla ścieżki (opcjonalnie zależnej od języka).
 *  Dodaje wpis `x-default` wskazujący na język domyślny — spójnie z hreflang stron. */
function buildLanguages(
  base: string,
  locales: readonly string[],
  pathForLocale: (locale: string) => string,
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[locale] = `${base}${pathForLocale(locale)}`;
  }
  // #1097: ta sama reguła co hreflang w metadata oferty (kolejność `routing.locales`, nie kolejność z bazy).
  const xDefault = pickXDefaultLocale(locales);
  if (xDefault) languages['x-default'] = `${base}${pathForLocale(xDefault)}`;
  return languages;
}

/**
 * Języki, w których landing ma ≥1 ofertę (#299). Liczniki używają tego samego filtra co strona
 * (kategoria; miasto po kluczu i wszystkich jego nazwach — #189), więc sitemap nie zgłasza pustych landingów,
 * które same mają `noindex`. `null` z licznika = błąd odczytu: sitemap nie może zgadywać.
 */
async function nonEmptyLandingLocales(
  locales: readonly string[],
): Promise<{ categories: Map<string, string[]>; cities: Map<string, string[]> }> {
  const categoryCounts = await getCategoryCounts(routing.defaultLocale, CATEGORY_KEYS);
  if (!categoryCounts) throw new Error('sitemap: brak liczników kategorii');
  const categories = new Map<string, string[]>();
  for (const key of CATEGORY_KEYS) {
    categories.set(key, (categoryCounts[key] ?? 0) > 0 ? [...locales] : []);
  }

  // #189: licznik per klucz miasta (wszystkie nazwy PL/NL/FR/EN) — landing ma te same oferty
  // w każdym języku, więc kwalifikuje się albo nie jednocześnie we wszystkich wersjach.
  // #920: katalog i próg podaży = metadane strony miasta i hub (`city-landings.ts`).
  const cityCounts = await getCityCounts(routing.defaultLocale, CITY_LANDING_KEYS);
  if (!cityCounts) throw new Error('sitemap: brak liczników miast');
  const cities = new Map<string, string[]>();
  for (const key of CITY_LANDING_KEYS) {
    cities.set(key, cityLandingQualifies(cityCounts[key]) ? [...locales] : []);
  }
  return { categories, cities };
}

/**
 * Górna granica identyfikatora partii ofert, niezależna od bazy: tyle partii wystarcza na
 * wszystkie oferty osiągalne przez paginację listy (`MAX_JOB_LIST_OFFSET`, jak w
 * `jobSitemapShardCount`). Wyższe id nie mają treści — bez tej granicy `/sitemap/999.xml`
 * wykonywał zapytania, które `get_public_jobs` klampuje do ostatniej strony (duplikaty).
 */
const MAX_JOB_SITEMAP_SHARDS = Math.ceil(
  (MAX_JOB_LIST_OFFSET + SITEMAP_JOBS_PAGE) / JOBS_PER_SITEMAP_SHARD,
);

/**
 * Normalizuje `id` pliku sitemap. Next.js 15.5 (`next-metadata-route-loader`) wywołuje handler
 * z `{ id: '0' }` — fragmentem adresu `/sitemap/0.xml` jako TEKSTEM, nie liczbą z
 * `generateSitemaps()`. Dawne `id === 0` było więc zawsze fałszywe: `/sitemap/0.xml` zwracał
 * partię ofert nr -1 zamiast stron statycznych, landingów i poradników (SEO-01).
 * Dozwolone: kanoniczna liczba całkowita `0..MAX_JOB_SITEMAP_SHARDS` (liczba albo jej zapis
 * dziesiętny bez zer wiodących, spacji, znaku, wykładnika). Inaczej `null` = pusty plik.
 */
export function parseSitemapId(id: unknown): number | null {
  const text = typeof id === 'number' ? String(id) : id;
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)$/.test(text)) return null;
  const n = Number(text);
  return n <= MAX_JOB_SITEMAP_SHARDS ? n : null;
}

export default async function sitemap({
  id,
}: {
  // Next.js przekazuje string (fragment adresu); liczba zostaje dla wywołań bezpośrednich.
  id?: number | string;
}): Promise<MetadataRoute.Sitemap> {
  // Staging/preview/local albo bramka hasła (#1115): pusty sitemap (spójne z robots.ts Disallow:/).
  // Jedno źródło: isSearchIndexingEnabled() (P1-19 + bramka).
  if (!isSearchIndexingEnabled()) return [];

  const shard = parseSitemapId(id);
  if (shard === null) return [];

  // #1042: 3600 s w pamięci procesu. Wynik zdegradowany (nieznane języki tłumaczeń) nie zostaje.
  const health = { degraded: false };
  const key = String(shard);
  const entries = await sitemapEntriesCache.run(key, () =>
    shard === 0 ? coreSitemap() : jobsSitemapShard(shard - 1, health),
  );
  if (health.degraded) sitemapEntriesCache.delete(key);
  return entries;
}

/** Stron listy (po `SITEMAP_JOBS_PAGE`) osiągalnych paginacją — ta sama granica co partie ofert. */
const MAX_SITEMAP_JOB_PAGES = Math.ceil((MAX_JOB_LIST_OFFSET + SITEMAP_JOBS_PAGE) / SITEMAP_JOBS_PAGE);

/**
 * PERF-05 (#1231): slugi firm z aktywnymi, osiągalnymi ofertami — jedna iteracja po całej
 * liście (bez licznika i przekładu), w kolejności pierwszego wystąpienia.
 */
async function collectCompanySlugs(): Promise<string[]> {
  const slugs = new Set<string>();
  for (let page = 1; page <= MAX_SITEMAP_JOB_PAGES; page += 1) {
    const result = await getJobs(
      { locale: routing.defaultLocale, page, pageSize: SITEMAP_JOBS_PAGE },
      undefined,
      { withTotal: false },
    );
    for (const job of result.jobs) {
      if (job.companySlug) slugs.add(job.companySlug);
    }
    if (result.jobs.length < SITEMAP_JOBS_PAGE) break; // ostatnia strona całej listy
  }
  return [...slugs];
}

/** `id=0`: strony statyczne, landing-page'e kategorii/lokalizacji, poradniki i profile firm. */
async function coreSitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.siteUrl;
  const locales = routing.locales;
  const entries: MetadataRoute.Sitemap = [];

  // --- Strony statyczne ---
  for (const path of STATIC_PATHS) {
    const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: path === '' ? 'daily' : 'weekly',
        priority: path === '' ? 1 : path === JOBS_PATH ? 0.9 : 0.6,
        alternates: { languages },
      });
    }
  }

  const landings = await nonEmptyLandingLocales(locales);

  // --- Landing-page'e kategorii (dedykowana trasa /praca/kategoria/<klucz>, slug stabilny) ---
  // Tylko z ≥1 ofertą (#299).
  for (const key of CATEGORY_KEYS) {
    const path = `${HUB_PATH}/kategoria/${key}`;
    const withJobs = landings.categories.get(key) ?? [];
    const languages = buildLanguages(base, withJobs, (locale) => `/${locale}${path}`);
    for (const locale of withJobs) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: 'weekly',
        priority: 0.6,
        alternates: { languages },
      });
    }
  }

  // --- Landing-page'e miast (dedykowana trasa /praca/miasto/<slug>, slug stabilny) ---
  // Tylko miasta powyżej progu podaży (#920; dawniej ≥1 oferta, #299).
  for (const key of CITY_LANDING_KEYS) {
    const path = `${HUB_PATH}/miasto/${key}`;
    const withJobs = landings.cities.get(key) ?? [];
    const languages = buildLanguages(base, withJobs, (locale) => `/${locale}${path}`);
    for (const locale of withJobs) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages },
      });
    }
  }

  // --- Poradniki (blog) ---
  for (const slug of getAllGuideSlugs()) {
    const path = `${GUIDES_PATH}/${slug}`;
    const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: 'monthly',
        priority: 0.5,
        alternates: { languages },
      });
    }
  }

  // --- Profile firm (#591; #1231: tylko tutaj, raz na firmę w całym indeksie) — komplet
  // języków (treść nie zależy od tłumaczenia oferty, w przeciwieństwie do samej oferty). ---
  for (const slug of await collectCompanySlugs()) {
    const path = `${COMPANIES_PATH}/${slug}`;
    const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages },
      });
    }
  }

  return entries;
}

/**
 * `id=1..N` (parametr 0-indeksowany `shardIndex`): jedna partia (`JOBS_PER_SITEMAP_SHARD`)
 * szczegółów ofert — koniec sztywnego ucinania katalogu po pierwszych 5000 (#599). Kolejne
 * partie to kolejne zakresy stron `getJobs` (P1-13: `get_public_jobs` klampuje limit do
 * 100/stronę, więc iterujemy stronami w obrębie tej partii).
 */
async function jobsSitemapShard(
  shardIndex: number,
  health: { degraded: boolean },
): Promise<MetadataRoute.Sitemap> {
  const base = env.siteUrl;
  const locales = routing.locales;
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  const pagesPerShard = JOBS_PER_SITEMAP_SHARD / SITEMAP_JOBS_PAGE;
  const firstPage = shardIndex * pagesPerShard + 1;
  const lastPage = firstPage + pagesPerShard - 1;
  for (let page = firstPage; page <= lastPage; page += 1) {
    // #1230: partia nie potrzebuje licznika — jedno zapytanie na stronę zamiast dwóch.
    const result = await getJobs(
      { locale: routing.defaultLocale, page, pageSize: SITEMAP_JOBS_PAGE },
      undefined,
      { withTotal: false },
    );
    if (result.jobs.length === 0) break;
    // Tylko wersje językowe z tłumaczeniem (#301); nieznane (błąd odczytu) = wszystkie, jak dotąd.
    const availableByJob = await getJobsAvailableLocales(result.jobs.map((job) => job.id));
    if (!availableByJob) health.degraded = true; // błąd odczytu: wszystkie wersje, ale nie trzymamy tego w cache
    for (const job of result.jobs) {
      const path = `${JOBS_PATH}/${job.slug}`;
      const available = availableByJob?.[job.id];
      const jobLocales = availableByJob && available?.length ? available : locales;
      const languages = buildLanguages(base, jobLocales, (locale) => `/${locale}${path}`);
      const publishedTs = Date.parse(job.publishedAt);
      const lastModified = Number.isNaN(publishedTs) ? now : new Date(publishedTs);
      for (const locale of jobLocales) {
        entries.push({
          url: `${base}/${locale}${path}`,
          lastModified,
          changeFrequency: 'daily',
          priority: 0.8,
          alternates: { languages },
        });
      }
    }
    if (result.jobs.length < SITEMAP_JOBS_PAGE) break; // ostatnia strona całej listy
  }

  return entries;
}
