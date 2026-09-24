import { NextResponse } from 'next/server';

import {
  buildDemoFacets,
  parseSidebarFilters,
  salaryQueryParams,
  toFacetItem,
} from '@/components/public/job-filters';
import { routing, type Locale } from '@/i18n/routing';
import { getJobFilterFacets, getJobs } from '@/lib/jobs';
import { localizeLocationFacets, resolveCityFilters } from '@/lib/locations/city-aliases';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
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
  const databaseFacets = await getJobFilterFacets(params);
  const facets = databaseFacets
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
  return NextResponse.json(facets, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
