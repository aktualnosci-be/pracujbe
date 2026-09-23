import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MapPin, Search, SearchX, X } from 'lucide-react';

import { Link, redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getJobFilterFacets, getJobs } from '@/lib/jobs';
import { FilterSidebar, SortMenu } from '@/components/public/FilterSidebar';
import { FilterSheet } from '@/components/public/FilterSheet';
import { JobCard } from '@/components/public/JobCard';
import { Pagination } from '@/components/public/Pagination';
import {
  SALARY_MAX_BOUND,
  buildDemoFacets,
  isSalaryNarrowed,
  parseSidebarFilters,
  parseSort,
  sidebarFiltersToParams,
  splitParam,
  toFacetItem,
  type DateValue,
  type SortValue,
} from '@/components/public/job-filters';

/**
 * Lista ofert pracy (SSR) wg makiety 02-jobs-list.
 *
 * Układ 2-kolumnowy na desktopie: lewy `FilterSidebar`, prawa kolumna z chipami aktywnych
 * filtrów, sortowaniem, wierszami `JobCard` i paginacją. Na mobile: górna wyszukiwarka,
 * pasek „Filtry (n)” (bottom-sheet `FilterSheet`) + sortowanie, oferty i paginacja.
 *
 * Wszystkie filtry trzymane są w URL. Słowo kluczowe i miasto zawężają zbiór natywnie przez
 * `getJobs`. WYNIKI (lista + licznik + paginacja + sort + KOMPLET filtrów sidebara:
 * kategoria/lokalizacja/widełki/umowa/zakwaterowanie/od zaraz/bez języka/data) liczone są w
 * SQL (get_public_jobs, 0046 — P1-12), więc skalują się na dowolny wolumen ofert. Działa BEZ
 * zmiennych środowiskowych (dane demonstracyjne z `getJobs`).
 *
 * Liczniki opcji filtrów pochodzą z jednego dokładnego agregatu SQL i zachowują pozostałe
 * aktywne filtry. Nie zależą od strony wyników ani od próbki ofert.
 *
 * TODO(i18n-slugs): jeden segment `oferty-pracy` dla wszystkich języków; lokalizowane slugi
 * (vacatures/offres-emploi/jobs) w mapie drogowej (spec 12).
 */

const BASE_PATH = '/oferty-pracy';
const PAGE_SIZE = 12;

/** Mapowanie locale aplikacji → locale Open Graph (format język_KRAJ). Spójne z layoutem/stroną główną. */
const OG_LOCALE: Record<string, string> = {
  pl: 'pl_PL',
  nl: 'nl_BE',
  fr: 'fr_BE',
  en: 'en_GB',
};

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function flatten(sp: SearchParams): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};
  for (const key of Object.keys(sp)) {
    flat[key] = firstValue(sp[key]);
  }
  return flat;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, tMeta] = await Promise.all([
    getTranslations({ locale, namespace: 'jobs' }),
    getTranslations({ locale, namespace: 'metadata' }),
  ]);

  const base = env.siteUrl;
  const shareImage = new URL('/og.png', base).href;
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${BASE_PATH}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${BASE_PATH}`;

  const url = `${base}/${locale}${BASE_PATH}`;

  return {
    title: t('pageTitle'),
    description: tMeta('jobsDescription'),
    alternates: { canonical: url, languages },
    openGraph: {
      title: tMeta('jobsTitle'),
      description: tMeta('jobsDescription'),
      url,
      siteName: 'Pracuj.be',
      type: 'website',
      locale: OG_LOCALE[locale] ?? locale,
      images: [{ url: shareImage, width: 1200, height: 630, alt: 'Pracuj.be' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: tMeta('jobsTitle'),
      description: tMeta('jobsDescription'),
      images: [shareImage],
    },
  };
}

export default async function JobsListPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const flat = flatten(sp);

  const keyword = flat['keyword']?.trim() || undefined;
  const city = flat['city']?.trim() || undefined;
  const sort: SortValue = parseSort(flat['sort']);
  const sf = parseSidebarFilters(flat);

  const pageRaw = Number(flat['page']);
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.trunc(pageRaw) : 1;

  const [t, tFilters, tCat, tContract, tCommon, tNav] = await Promise.all([
    getTranslations('jobs'),
    getTranslations('filters'),
    getTranslations('categories'),
    getTranslations('contractTypes'),
    getTranslations('common'),
    getTranslations('nav'),
  ]);

  // Data „od" dla filtra świeżości (P1-12: liczone w SQL).
  const DAY_MS = 86_400_000;
  const sinceWindow =
    sf.date === '24h'
      ? DAY_MS
      : sf.date === '7d'
        ? 7 * DAY_MS
        : sf.date === '30d'
          ? 30 * DAY_MS
          : 0;
  const since = sinceWindow
    ? new Date(Date.now() - sinceWindow).toISOString()
    : undefined;

  // WYNIKI: komplet filtrów sidebara + sort + paginacja + licznik PO STRONIE SQL (P1-12) —
  // koniec liczenia w pamięci nad wycinkiem 200 (oferty nie znikają, liczba stron poprawna).
  const narrowed = isSalaryNarrowed(sf);
  const filterParams = {
    locale,
    keyword,
    city,
    categories: sf.categories,
    locations: sf.locations,
    contractTypes: sf.contractTypes,
    ...(narrowed ? { salaryMin: sf.salaryMin } : {}),
    ...(narrowed && sf.salaryMax < SALARY_MAX_BOUND
      ? { salaryMax: sf.salaryMax }
      : {}),
    ...(sf.accommodation.length === 1
      ? { accommodation: sf.accommodation.includes('provided') }
      : {}),
    ...(sf.immediate ? { immediate: true } : {}),
    ...(sf.noLanguageRequired ? { noLanguageRequired: true } : {}),
    ...(since ? { since } : {}),
  };
  const [results, databaseFacets] = await Promise.all([
    getJobs({ ...filterParams, sort, page, pageSize: PAGE_SIZE }),
    getJobFilterFacets(filterParams),
  ]);
  const facets =
    databaseFacets ??
    buildDemoFacets(
      (
        await getJobs({ locale, keyword, city, page: 1, pageSize: 100 })
      ).jobs.map(toFacetItem),
      sf,
    );
  const pageItems = results.jobs;
  const total = results.total;

  const currency = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });

  // Zestaw aktywnych parametrów (spójny z tym, co zapisuje sidebar) do budowy linków.
  const activeParams: Record<string, string> = {
    ...sidebarFiltersToParams(sf),
  };
  if (keyword) activeParams['keyword'] = keyword;
  if (city) activeParams['city'] = city;
  if (sort !== 'newest') activeParams['sort'] = sort;

  const hrefFrom = (paramsObj: Record<string, string>): string => {
    const qs = new URLSearchParams(paramsObj).toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  };
  // Strona spoza zakresu (np. ?page=999) przy niepustym wyniku → ostatnia istniejąca strona
  // z tymi samymi filtrami (#228). Pusty wynik zostaje pod adresem (stan pusty jest spójny).
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > lastPage) {
    redirect({
      href: hrefFrom(
        lastPage > 1
          ? { ...activeParams, page: String(lastPage) }
          : activeParams,
      ),
      locale,
    });
  }

  const withoutKey = (key: string): string => {
    const next = { ...activeParams };
    delete next[key];
    return hrefFrom(next);
  };
  const withoutValue = (key: string, value: string): string => {
    const next = { ...activeParams };
    const rest = splitParam(next[key]).filter((v) => v !== value);
    if (rest.length) next[key] = rest.join(',');
    else delete next[key];
    return hrefFrom(next);
  };
  const withoutSalary = (): string => {
    const next = { ...activeParams };
    delete next['salaryMin'];
    delete next['salaryMax'];
    return hrefFrom(next);
  };
  const sortHref = (value: SortValue): string => {
    const next = { ...activeParams };
    if (value === 'newest') delete next['sort'];
    else next['sort'] = value;
    return hrefFrom(next);
  };

  const dateChipLabel = (d: DateValue): string =>
    d === '24h'
      ? tFilters('date24h')
      : d === '7d'
        ? tFilters('date7d')
        : d === '30d'
          ? tFilters('date30d')
          : tFilters('any');

  const salaryMaxLabel =
    sf.salaryMax >= SALARY_MAX_BOUND
      ? tFilters('salaryMaxCap', { value: currency.format(sf.salaryMax) })
      : currency.format(sf.salaryMax);
  const salaryChipLabel = tFilters('salaryChip', {
    min: currency.format(sf.salaryMin),
    max: salaryMaxLabel,
  });

  // Chipy aktywnych filtrów (odzwierciedlają activeParams).
  const chips: Array<{ id: string; label: string; href: string }> = [];
  if (keyword)
    chips.push({ id: 'kw', label: keyword, href: withoutKey('keyword') });
  if (city) chips.push({ id: 'city', label: city, href: withoutKey('city') });
  for (const cat of sf.categories) {
    chips.push({
      id: `cat-${cat}`,
      label: tCat(cat),
      href: withoutValue('category', cat),
    });
  }
  for (const loc of sf.locations) {
    chips.push({
      id: `loc-${loc}`,
      label: loc,
      href: withoutValue('location', loc),
    });
  }
  for (const ct of sf.contractTypes) {
    chips.push({
      id: `ct-${ct}`,
      label: tContract(ct),
      href: withoutValue('contractType', ct),
    });
  }
  if (isSalaryNarrowed(sf)) {
    chips.push({ id: 'salary', label: salaryChipLabel, href: withoutSalary() });
  }
  if (sf.accommodation.length === 1) {
    const value = sf.accommodation.includes('provided')
      ? 'provided'
      : 'unavailable';
    chips.push({
      id: 'acc',
      label: tFilters(value),
      href: withoutKey('accommodation'),
    });
  }
  if (sf.immediate) {
    chips.push({
      id: 'immediate',
      label: tFilters('immediate'),
      href: withoutKey('immediate'),
    });
  }
  if (sf.noLanguageRequired) {
    chips.push({
      id: 'nolang',
      label: tFilters('noLanguageRequired'),
      href: withoutKey('noLang'),
    });
  }
  if (sf.date !== 'any') {
    chips.push({
      id: 'date',
      label: dateChipLabel(sf.date),
      href: withoutKey('date'),
    });
  }

  // „Wyczyść filtry” usuwa wszystkie chipy — także słowo kluczowe i miasto; inaczej przy samym
  // wyszukiwaniu tekstowym link prowadził na ten sam adres (#228). Sortowanie zostaje.
  const clearFiltersHref = hrefFrom(sort !== 'newest' ? { sort } : {});

  // Parametry ukryte w formularzu wyszukiwarki (zachowanie filtrów przy wyszukiwaniu tekstem).
  const hiddenSearchParams = { ...activeParams };
  delete hiddenSearchParams['keyword'];
  delete hiddenSearchParams['city'];

  const sortOptions = [
    { value: 'newest', label: tFilters('sortNewest'), href: sortHref('newest') },
    { value: 'salary', label: tFilters('sortSalary'), href: sortHref('salary') },
  ] as const;

  const sortMenu = () => (
    <SortMenu
      sortByLabel={tFilters('sortBy')}
      current={sort}
      options={sortOptions}
    />
  );

  return (
    <PublicSavedJobsProvider
      key={JSON.stringify(pageItems.map((job) => job.id))}
      jobIds={pageItems.map((job) => job.id)}
    >
    <div className="container py-6 md:py-10">
      {/* Breadcrumb */}
        <nav
          aria-label={tCommon('breadcrumb')}
          className="mb-4 text-sm text-muted-foreground"
        >
        <ol className="flex items-center gap-1.5">
          <li>
              <Link
                href="/"
                className="transition-colors hover:text-foreground"
              >
              {tCommon('home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground">{tNav('jobs')}</li>
        </ol>
      </nav>

      {/* Prosty nagłówek zatwierdzonego kierunku „Ludzie i praca”. */}
      <header className="mb-6 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {t('pageTitle')}
        </h1>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">
            {t('subtitle')}
          </p>
      </header>

      {/* Wyszukiwarka (GET — działa bez JS, zachowuje aktywne filtry) */}
      <form
        action={`/${locale}${BASE_PATH}`}
        method="get"
        role="search"
        className="grid gap-3 rounded-[17px] border border-border bg-background p-2.5 md:grid-cols-[1.5fr_1.2fr_auto] md:items-end"
      >
        <div className="space-y-1.5 px-1.5 pt-1.5 md:py-1.5">
            <label
              htmlFor="q-keyword"
              className="text-xs font-semibold text-muted-foreground"
            >
            {t('keyword')}
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="q-keyword"
              name="keyword"
              defaultValue={keyword ?? ''}
              placeholder={t('keywordPlaceholder')}
              autoComplete="off"
              className="flex h-12 w-full rounded-[11px] border border-input bg-background pl-9 pr-3 text-base text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <div className="space-y-1.5 px-1.5 md:py-1.5">
            <label
              htmlFor="q-city"
              className="text-xs font-semibold text-muted-foreground"
            >
            {t('location')}
          </label>
          <div className="relative">
            <MapPin
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="q-city"
              name="city"
              defaultValue={city ?? ''}
              placeholder={t('locationPlaceholder')}
              autoComplete="off"
              className="flex h-12 w-full rounded-[11px] border border-input bg-background pl-9 pr-3 text-base text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>

        {Object.entries(hiddenSearchParams).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}

        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[11px] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:min-h-[58px]"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('searchJobs')}
        </button>
      </form>

      {/* Układ wyników */}
      <div className="mt-6 lg:grid lg:grid-cols-[288px_1fr] lg:gap-8">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <FilterSidebar
                facets={facets}
              initial={sf}
              keyword={keyword}
              city={city}
              sort={sort}
              className="max-h-[calc(100dvh-7rem-var(--cookie-banner-h,0px))]"
            />
          </div>
        </aside>

        {/* Kolumna wyników */}
        <div className="min-w-0">
          {/* Pasek narzędzi (mobile) */}
          <div className="mb-4 flex flex-col items-stretch gap-3 lg:hidden [&>details]:w-full [&>details>summary]:justify-between">
            <FilterSheet
                facets={facets}
              initial={sf}
              keyword={keyword}
              city={city}
              sort={sort}
              className="w-full"
            />
            {sortMenu()}
          </div>

          {/* Nagłówek wyników (desktop) */}
          <div className="mb-4 hidden items-center justify-between gap-3 lg:flex">
            <h2
              data-results-heading
              tabIndex={-1}
              className="rounded-sm text-sm font-normal text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-live="polite"
            >
              {t('resultsCount', { count: total })}
            </h2>
            {sortMenu()}
          </div>

          {/* Liczba wyników (mobile) */}
          <h2
            data-results-heading
            tabIndex={-1}
            className="mb-3 rounded-sm text-sm font-normal text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden"
            aria-live="polite"
          >
            {t('resultsCount', { count: total })}
          </h2>

          {/* Chipy aktywnych filtrów */}
          {chips.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {chips.map((chip) => (
                <Link
                  key={chip.id}
                  href={chip.href}
                  aria-label={`${tFilters('removeFilter')}: ${chip.label}`}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border bg-soft py-1 pl-3 pr-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  {/* Długie słowo (złożenie, adres) łamie się zamiast rozpychać stronę (#230). */}
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {chip.label}
                  </span>
                    <X
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                </Link>
              ))}
              <Link
                href={clearFiltersHref}
                className="ml-1 inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {tFilters('clear')}
              </Link>
            </div>
          ) : null}

          {/* Wyniki */}
          {pageItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-soft px-6 py-16 text-center">
                <SearchX
                  className="h-10 w-10 text-muted-foreground"
                  aria-hidden="true"
                />
              <p className="max-w-md text-muted-foreground">{t('empty')}</p>
              {chips.length > 0 ? (
                <Link
                  href={clearFiltersHref}
                  data-empty-reset
                  className="mt-2 inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-background px-5 text-sm font-semibold text-foreground transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {tFilters('clearAll')}
                </Link>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {pageItems.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ul>
          )}

          <Pagination
            basePath={BASE_PATH}
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            filters={activeParams}
          />
        </div>
      </div>
    </div>
    </PublicSavedJobsProvider>
  );
}
