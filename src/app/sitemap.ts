import type { MetadataRoute } from 'next';

import { routing } from '@/i18n/routing';
import { env, isProductionDeployment } from '@/lib/env';
import {
  getCategoryCounts,
  getCityCounts,
  type CategoryKey,
  type LocationKey,
} from '@/lib/jobs';
import { getSitemapJobShardStarts, getSitemapJobsShard } from '@/lib/sitemap-jobs';
import type { SitemapJobRow } from '@/lib/db/sitemap-jobs';
import { getAllGuideSlugs } from '@/lib/guides/guides';
import { pickXDefaultLocale } from '@/lib/seo/locales';
import { sitemapEntriesCache, sitemapIdsCache } from '@/lib/cache/sitemap-cache';

/**
 * Mapa strony — Pracuj.be. Sitemap INDEX (#599): id `0` = strony statyczne, landing-page'e
 * kategorii/lokalizacji i poradniki (jeden plik wystarcza — kilkadziesiąt URL-i); id `1..N` =
 * kolejne partie szczegółów ofert (`JOBS_PER_SITEMAP_SHARD` na plik), po `generateSitemaps()`
 * dostępne pod `/sitemap/<id>.xml` (konwencja Next.js — patrz `robots.ts`, który wylicza te
 * same identyfikatory i wskazuje każdy plik osobno zamiast pojedynczego adresu).
 *
 * Dawny sztywny sufit `SITEMAP_MAX_JOBS = 5000` (jeden plik, bez dalszych partii) ucinał
 * katalog bezpowrotnie — starsze/dalsze oferty zostawały publiczne, ale poza sitemapem (#599).
 * Partii przybywa wraz z wolumenem. Od #1042 (migracja 0965) katalog czytają dwa lekkie RPC
 * kursorowe (`src/lib/sitemap-jobs.ts`): granice partii (bez licznika) i strony po 1000 ofert
 * kursorem (`published_at`, `id`) razem z językami tłumaczeń — bez OFFSET, więc bez sufitu
 * offsetu publicznej listy (`MAX_JOB_LIST_OFFSET`, #593) i bez kosztu rosnącego z głębokością.
 *
 * Każdy wpis ma alternatywy językowe (hreflang). Panele (candidate/employer/admin) i API są
 * celowo pominięte (patrz `robots.ts`). Poza produkcją pusta (bez odczytu bazy).
 *
 * Profile firm (#591) trafiają do partii ofert: jeden wpis na `companySlug` zebrany przy tej
 * samej iteracji po ofertach partii (bez osobnego zapytania). Firma z ofertami w dwóch partiach
 * pojawi się w obu (dopuszczalny duplikat URL-a między plikami; dopiero powyżej 5000 ofert).
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
 * Koszt powtarzanych żądań (#1042): krok 1 — wynik każdego pliku i lista partii są trzymane w
 * pamięci procesu przez 3600 s z deduplikacją równoległych obliczeń (`sitemap-cache.ts`), więc
 * anonimowe pobieranie sitemapy nie liczy ofert za każdym razem; krok 2 — pojedyncze przeliczenie
 * jest lekkie (kursorowe RPC bez licznika i OFFSET, `src/lib/sitemap-jobs.ts`).
 */
export const dynamic = 'force-dynamic';

/** Ofert szczegółowych na jeden plik sitemap (dużo poniżej limitu protokołu 50 000 URL-i). */
const JOBS_PER_SITEMAP_SHARD = 5000;

/**
 * Liczba partii ofert (id `1..N`) potrzebna dla obecnego wolumenu = liczba granic partii z bazy
 * (jedno lekkie zapytanie, bez osobnego licznika ofert). Poza produkcją = 0 (sam core sitemap,
 * #429 — bez odczytu bazy).
 */
async function jobSitemapShardCount(): Promise<number> {
  if (!isProductionDeployment()) return 0;
  return (await getSitemapJobShardStarts(JOBS_PER_SITEMAP_SHARD)).length;
}

/** Identyfikatory plików sitemap: `0` = core, `1..N` = partie ofert (Next.js: `generateSitemaps`). */
export async function generateSitemaps(): Promise<{ id: number }[]> {
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

const LOCATION_KEYS: readonly LocationKey[] = [
  'brussels',
  'antwerp',
  'ghent',
  'leuven',
  'mechelen',
  'hasselt',
  'liege',
  'charleroi',
  'bruges',
  'kortrijk',
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
  // w każdym języku, więc jest pusty albo niepusty jednocześnie we wszystkich wersjach.
  const cityCounts = await getCityCounts(routing.defaultLocale, LOCATION_KEYS);
  if (!cityCounts) throw new Error('sitemap: brak liczników miast');
  const cities = new Map<string, string[]>();
  for (const key of LOCATION_KEYS) {
    cities.set(key, (cityCounts[key] ?? 0) > 0 ? [...locales] : []);
  }
  return { categories, cities };
}

/**
 * Górna granica identyfikatora partii ofert, niezależna od bazy: `/sitemap/999.xml` nie
 * wykonuje żadnego zapytania. 100 partii × 5000 = 500 000 ofert (dziesiątki razy więcej niż
 * dziś); kolejna partia poza istniejącymi (numer w granicy, ale bez ofert) = pusty plik.
 */
const MAX_JOB_SITEMAP_SHARDS = 100;

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
  // Staging/preview/local: pusty sitemap (spójne z robots.ts Disallow:/ i X-Robots-Tag).
  // JEDNO źródło prawdy o środowisku (P1-19): isProductionDeployment().
  if (!isProductionDeployment()) return [];

  const shard = parseSitemapId(id);
  if (shard === null) return [];

  // #1042: 3600 s w pamięci procesu (błąd odczytu nie jest cache'owany — rzut przechodzi dalej;
  // języki tłumaczeń idą w tym samym zapytaniu co oferty, więc nie ma wyniku „zdegradowanego”).
  return sitemapEntriesCache.run(String(shard), () =>
    shard === 0 ? coreSitemap() : jobsSitemapShard(shard - 1),
  );
}

/** `id=0`: strony statyczne, landing-page'e kategorii/lokalizacji i poradniki. */
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
  // Tylko języki, w których filtr miasta znajduje ≥1 ofertę (#299).
  for (const key of LOCATION_KEYS) {
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

  return entries;
}

/**
 * `lastModified` wpisu oferty: data ostatniej edycji (`jobs.updated_at`, #796) — po istotnej
 * edycji opublikowanej oferty jest nowsza niż `published_at`; fallback na datę publikacji,
 * a przy błędzie obu — bieżący czas (jak dotąd).
 */
function jobLastModified(job: Pick<SitemapJobRow, 'publishedAt' | 'updatedAt'>, fallback: Date): Date {
  const updatedTs = Date.parse(job.updatedAt);
  if (!Number.isNaN(updatedTs)) return new Date(updatedTs);
  const publishedTs = Date.parse(job.publishedAt);
  return Number.isNaN(publishedTs) ? fallback : new Date(publishedTs);
}

/**
 * `id=1..N` (parametr 0-indeksowany `shardIndex`): jedna partia (`JOBS_PER_SITEMAP_SHARD`)
 * szczegółów ofert — koniec sztywnego ucinania katalogu po pierwszych 5000 (#599). Partię
 * wyznaczają kursory (`published_at`, `id`) z bazy (#1042): oferty wraz z językami tłumaczeń
 * przychodzą stronami po 1000 w jednym zapytaniu, bez licznika i offsetu.
 */
async function jobsSitemapShard(shardIndex: number): Promise<MetadataRoute.Sitemap> {
  const base = env.siteUrl;
  const locales = routing.locales;
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  const jobs = await getSitemapJobsShard(shardIndex + 1, JOBS_PER_SITEMAP_SHARD);
  // #591: profile firm zbierane PRZY OKAZJI tej samej iteracji (bez osobnego zapytania) —
  // `companySlug` jest już w wyniku (0140). Jeden wpis na firmę w partii.
  const companySlugs = new Set<string>();

  for (const job of jobs) {
    if (job.companySlug) companySlugs.add(job.companySlug);
    const path = `${JOBS_PATH}/${job.slug}`;
    // Tylko wersje językowe z tłumaczeniem (#301); oferta bez żadnego wpisu = wszystkie, jak dotąd.
    const jobLocales = job.locales.length > 0 ? job.locales : locales;
    const languages = buildLanguages(base, jobLocales, (locale) => `/${locale}${path}`);
    const lastModified = jobLastModified(job, now);
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

  // --- Profile firm (#591) — jeden wpis na slug, komplet języków (treść nie zależy od
  // tłumaczenia oferty, w przeciwieństwie do samej oferty). ---
  for (const slug of companySlugs) {
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
