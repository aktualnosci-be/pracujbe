import { NextResponse } from 'next/server';

import {
  SALARY_MAX_BOUND,
  buildDemoFacets,
  isSalaryNarrowed,
  parseSidebarFilters,
  toFacetItem,
} from '@/components/public/job-filters';
import { routing, type Locale } from '@/i18n/routing';
import { getJobFilterFacets, getJobs } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const search = new URL(request.url).searchParams;
  const raw = Object.fromEntries(search.entries());
  const requestedLocale = raw['locale'];
  const locale: Locale = routing.locales.includes(requestedLocale as Locale)
    ? (requestedLocale as Locale)
    : routing.defaultLocale;
  const filters = parseSidebarFilters(raw);
  const narrowed = isSalaryNarrowed(filters);
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
    city: raw['city']?.slice(0, 100) || undefined,
    categories: filters.categories,
    locations: filters.locations,
    contractTypes: filters.contractTypes,
    ...(narrowed ? { salaryMin: filters.salaryMin } : {}),
    ...(narrowed && filters.salaryMax < SALARY_MAX_BOUND
      ? { salaryMax: filters.salaryMax }
      : {}),
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
  const facets =
    databaseFacets ??
    buildDemoFacets(
      (
        await getJobs({
          locale,
          keyword: params.keyword,
          city: params.city,
          page: 1,
          pageSize: 100,
        })
      ).jobs.map(toFacetItem),
      filters,
    );
  return NextResponse.json(facets, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
