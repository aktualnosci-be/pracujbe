import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  buildDemoFacets,
  parseSidebarFilters,
  salaryQueryParams,
  toFacetItem,
} from '@/components/public/job-filters';
import { routing, type Locale } from '@/i18n/routing';
import { createTtlSingleFlightCache } from '@/lib/cache/ttl-single-flight';
import { getJobFilterFacets, getJobs } from '@/lib/jobs';
import { localizeLocationFacets, resolveCityFilters } from '@/lib/locations/city-aliases';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_ACTION = 'job-filter-facets';
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Krótki cache + single-flight (#595): te same filtry (kanoniczny klucz z parametrów zapytania
 * do `getJobFilterFacets`/`getJobs`) w tym oknie dostają jeden, wspólny wynik zamiast osobnej
 * agregacji na każde żądanie — nawet bez sesji/cookies (endpoint jest bezstanowy dla gościa,
 * patrz brak `viewer` w wywołaniu niżej). Ograniczona liczba wpisów — dowolny tekst wyszukiwania
 * nie może rozrastać cache bez końca.
 */
const FACETS_CACHE_TTL_MS = 30_000;
const FACETS_CACHE_MAX_ENTRIES = 300;
const facetsCache = createTtlSingleFlightCache<unknown>({
  ttlMs: FACETS_CACHE_TTL_MS,
  maxEntries: FACETS_CACHE_MAX_ENTRIES,
});

/**
 * Stabilny klucz cache o STAŁYM rozmiarze (kolejność kluczy obiektu nie wpływa na trafienie).
 * Parametry gościa mogą zawierać dowolnie długi tekst (`keyword`, `city`, lista `location`) —
 * skrót SHA-256 zamiast surowego JSON-a ogranicza pamięć na wpis niezależnie od długości wejścia.
 */
function facetsCacheKey(params: Record<string, unknown>): string {
  const canonical = JSON.stringify(params, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
  return createHash('sha256').update(canonical).digest('hex');
}

export async function GET(request: Request): Promise<NextResponse> {
  const allowed = await checkRateLimit(RATE_LIMIT_ACTION, {
    max: RATE_LIMIT_MAX,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'private, no-store',
          'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS),
        },
      },
    );
  }

  const search = new URL(request.url).searchParams;
  const raw = Object.fromEntries(search.entries());
  const requestedLocale = raw['locale'];
  const locale: Locale = routing.locales.includes(requestedLocale as Locale)
    ? (requestedLocale as Locale)
    : routing.defaultLocale;
  const filters = parseSidebarFilters(raw);
  // #189: ta sama reguła miast co lista ofert (zapytanie po aliasach, nazwy w języku strony).
  const cityFilters = resolveCityFilters(
    { city: raw['city']?.slice(0, 100) || undefined, locations: filters.locations },
    locale,
  );
  const days =
    filters.date === '24h'
      ? 1
      : filters.date === '7d'
        ? 7
        : filters.date === '30d'
          ? 30
          : 0;
  const params = {
    locale,
    keyword: raw['keyword']?.slice(0, 100) || undefined,
    city: cityFilters.city,
    categories: filters.categories,
    locations: cityFilters.queryLocations,
    contractTypes: filters.contractTypes,
    ...salaryQueryParams(filters),
    ...(filters.accommodation.length === 1
      ? { accommodation: filters.accommodation.includes('provided') }
      : {}),
    ...(filters.immediate ? { immediate: true } : {}),
    ...(filters.noLanguageRequired ? { noLanguageRequired: true } : {}),
    ...(days
      ? { since: new Date(Date.now() - days * 86_400_000).toISOString() }
      : {}),
  };
  // Klucz cache = dokładnie parametry zapytania (`raw`), z których w sposób deterministyczny
  // wynikają `params`/`filters`/`cityFilters` niżej — nie zawiera nic obliczonego przy
  // żądaniu (np. znacznika czasu), więc te same filtry trafiają w to samo trafienie.
  const facets = await facetsCache.run(facetsCacheKey(raw), async () => {
    const databaseFacets = await getJobFilterFacets(params);
    return databaseFacets
      ? {
          ...databaseFacets,
          locations: localizeLocationFacets(
            databaseFacets.locations,
            cityFilters.cityKey,
            locale,
          ),
        }
      : buildDemoFacets(
          (
            await getJobs({
              locale,
              keyword: params.keyword,
              ...cityFilters.cityQuery,
              page: 1,
              pageSize: 100,
            })
          ).jobs.map(toFacetItem),
          { ...filters, locations: cityFilters.displayLocations },
        );
  });
  return NextResponse.json(facets, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
