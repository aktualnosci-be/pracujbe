'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { useRouter, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { CategoryKey, ContractType } from '@/lib/jobs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CATEGORY_KEYS,
  CONTRACT_TYPES,
  DATE_VALUES,
  SALARY_MAX_BOUND,
  SALARY_MIN_BOUND,
  SALARY_STEP,
  emptySidebarFilters,
  sidebarFiltersToParams,
  type AccommodationValue,
  type DateValue,
  type SidebarFilters,
  type SortValue,
} from '@/components/public/job-filters';
import type { JobFilterFacets } from '@/types/job-filter-facets';

/**
 * Panel filtrów listy ofert (wg makiety 02-jobs-list).
 *
 * `FilterFields` to KONTROLOWANY zestaw pól (kategoria, lokalizacja, wynagrodzenie, rodzaj
 * umowy, zakwaterowanie, dodatkowe, data) — współdzielony przez wariant desktopowy
 * (`FilterSidebar`) i mobilny bottom-sheet (`FilterSheet`). Liczniki przy pozycjach są
 * niezależne (liczone dokładnie po stronie bazy), a przycisk „Pokaż N ofert” pokazuje
 * liczbę pasującą do BIEŻĄCEGO (edytowanego) wyboru — na żywo.
 *
 * Model: zmiany są PENDING (lokalny stan), zatwierdzane dopiero przyciskiem „Pokaż N ofert”,
 * który zapisuje filtry w URL (SSR renderuje wyniki). „Wyczyść wszystko” czyści filtry
 * sidebara od razu, zachowując słowo kluczowe / miasto / sortowanie z górnej wyszukiwarki.
 */

type CategoryKeyT = CategoryKey;
type ContractTypeT = ContractType;

const COLLAPSED_COUNT = 5;

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

export function useLiveFacets(
  initial: JobFilterFacets,
  initialFilters: SidebarFilters,
  filters: SidebarFilters,
  base: { keyword?: string; city?: string },
): {
  facets: JobFilterFacets;
  status: 'idle' | 'loading' | 'error';
  retry: () => void;
} {
  const locale = useLocale();
  const [retryAttempt, setRetryAttempt] = React.useState(0);
  const query = React.useMemo(() => {
    const params = new URLSearchParams(sidebarFiltersToParams(filters));
    params.set('locale', locale);
    if (base.keyword) params.set('keyword', base.keyword);
    if (base.city) params.set('city', base.city);
    return params.toString();
  }, [base.city, base.keyword, filters, locale]);
  const initialQuery = React.useMemo(() => {
    const params = new URLSearchParams(sidebarFiltersToParams(initialFilters));
    params.set('locale', locale);
    if (base.keyword) params.set('keyword', base.keyword);
    if (base.city) params.set('city', base.city);
    return params.toString();
  }, [base.city, base.keyword, initialFilters, locale]);
  const requestSequence = React.useRef(0);
  const [result, setResult] = React.useState({
    query: initialQuery,
    retryAttempt,
    facets: initial,
    error: false,
  });

  React.useEffect(() => {
    const sequence = ++requestSequence.current;
    if (query === initialQuery) {
      setResult({
        query,
        retryAttempt,
        facets: initial,
        error: false,
      });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/job-filter-facets?${query}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error('facet request failed');
          return response.json() as Promise<JobFilterFacets>;
        })
        .then((next) => {
          if (sequence === requestSequence.current)
            setResult({
              query,
              retryAttempt,
              facets: next,
              error: false,
            });
        })
        .catch((error: unknown) => {
          if (
            sequence === requestSequence.current &&
            !(error instanceof DOMException && error.name === 'AbortError')
          )
            setResult({
              query,
              retryAttempt,
              facets: initial,
              error: true,
            });
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [initial, initialQuery, query, retryAttempt]);

  const current = result.query === query && result.retryAttempt === retryAttempt;
  return {
    facets: query === initialQuery ? initial : result.facets,
    status: current ? (result.error ? 'error' : 'idle') : 'loading',
    retry: React.useCallback(() => setRetryAttempt((value) => value + 1), []),
  };
}

/* --------------------------------------------------------------- wiersz check */

function CheckRow({
  id,
  label,
  count,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  count?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex min-h-12 items-center gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <Label
        htmlFor={id}
        data-filter-target="checkbox-label"
        className="flex min-h-12 flex-1 cursor-pointer items-center font-normal text-foreground"
      >
        {label}
      </Label>
      {count !== undefined ? (
        <span
          data-filter-count={id}
          className="text-xs tabular-nums text-muted-foreground"
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}

function SectionTitle({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
      {children}
    </h3>
  );
}

/* --------------------------------------------------------------- FilterFields */

export interface FilterFieldsProps {
  facets: JobFilterFacets;
  value: SidebarFilters;
  onChange: (next: SidebarFilters) => void;
  idPrefix: string;
}

export function FilterFields({
  facets,
  value,
  onChange,
  idPrefix,
}: FilterFieldsProps): React.JSX.Element {
  const locale = useLocale();
  const t = useTranslations('filters');
  const tCat = useTranslations('categories');
  const tContract = useTranslations('contractTypes');

  const dateLabel = React.useCallback(
    (option: DateValue): string => {
      switch (option) {
        case '24h':
          return t('date24h');
        case '7d':
          return t('date7d');
        case '30d':
          return t('date30d');
        default:
          return t('any');
      }
    },
    [t],
  );

  const [showAllCategories, setShowAllCategories] = React.useState(false);
  const [showAllLocations, setShowAllLocations] = React.useState(false);
  const [locationQuery, setLocationQuery] = React.useState('');

  const currency = React.useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }),
    [locale],
  );

  const patch = React.useCallback(
    (partial: Partial<SidebarFilters>) => onChange({ ...value, ...partial }),
    [onChange, value],
  );

  const visibleCategories = showAllCategories
    ? CATEGORY_KEYS
    : CATEGORY_KEYS.slice(0, COLLAPSED_COUNT);
  const hiddenCategoryCount = CATEGORY_KEYS.length - COLLAPSED_COUNT;

  const locationOptions = [
    ...value.locations
      .filter((city) => !facets.locations.some((option) => option.city === city))
      .map((city) => ({ city, count: 0 })),
    ...facets.locations,
  ];
  const filteredLocations = locationOptions.filter((opt) =>
    opt.city.toLowerCase().includes(locationQuery.trim().toLowerCase()),
  );
  const visibleLocations =
    showAllLocations || locationQuery.length > 0
      ? filteredLocations
      : filteredLocations.slice(0, COLLAPSED_COUNT);
  const hiddenLocationCount =
    filteredLocations.length - visibleLocations.length;

  const maxLabel =
    value.salaryMax >= SALARY_MAX_BOUND
      ? t('salaryMaxCap', { value: currency.format(value.salaryMax) })
      : currency.format(value.salaryMax);

  return (
    <div className="space-y-5 [&>section+section]:border-t [&>section+section]:border-border/70 [&>section+section]:pt-5">
      {/* Kategoria */}
      <section>
        <SectionTitle>{t('category')}</SectionTitle>
        <div>
          {visibleCategories.map((key: CategoryKeyT) => (
            <CheckRow
              key={key}
              id={`${idPrefix}-cat-${key}`}
              label={tCat(key)}
              count={facets.categories[key] ?? 0}
              checked={value.categories.includes(key)}
              onChange={() =>
                patch({ categories: toggle(value.categories, key) })
              }
            />
          ))}
        </div>
        {hiddenCategoryCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAllCategories((prev) => !prev)}
            data-filter-target="show-more"
            className="mt-1 inline-flex min-h-12 items-center rounded-sm text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {showAllCategories
              ? t('showLess')
              : t('showMore', { count: hiddenCategoryCount })}
          </button>
        ) : null}
      </section>

      {/* Lokalizacja */}
      <section>
        <SectionTitle>{t('location')}</SectionTitle>
        <Input
          value={locationQuery}
          onChange={(event) => setLocationQuery(event.target.value)}
          placeholder={t('chooseLocation')}
          data-filter-target="location"
          className="mb-2 h-12"
          aria-label={t('chooseLocation')}
        />
        <div>
          {visibleLocations.map((opt) => (
            <CheckRow
              key={opt.city}
              id={`${idPrefix}-loc-${opt.city}`}
              label={opt.city}
              count={opt.count}
              checked={value.locations.includes(opt.city)}
              onChange={() =>
                patch({ locations: toggle(value.locations, opt.city) })
              }
            />
          ))}
          {visibleLocations.length === 0 ? (
            <p className="py-1 text-sm text-muted-foreground">
              {t('noLocations')}
            </p>
          ) : null}
        </div>
        {hiddenLocationCount > 0 && locationQuery.length === 0 ? (
          <button
            type="button"
            onClick={() => setShowAllLocations(true)}
            data-filter-target="show-more"
            className="mt-1 inline-flex min-h-12 items-center rounded-sm text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('showMore', { count: hiddenLocationCount })}
          </button>
        ) : null}
      </section>

      {/* Wynagrodzenie */}
      <section>
        <SectionTitle>{t('salary')}</SectionTitle>
        <p className="mb-2 text-sm font-medium text-foreground">
          {currency.format(value.salaryMin)}{' '}
          <span className="text-muted-foreground">–</span> {maxLabel}
        </p>
        <div className="space-y-2">
          <input
            type="range"
            min={SALARY_MIN_BOUND}
            max={SALARY_MAX_BOUND}
            step={SALARY_STEP}
            value={value.salaryMin}
            onChange={(event) =>
              patch({
                salaryMin: Math.min(
                  Number(event.target.value),
                  value.salaryMax,
                ),
              })
            }
            aria-label={t('salaryMin')}
            data-filter-target="range"
            className="h-12 w-full accent-accent"
          />
          <input
            type="range"
            min={SALARY_MIN_BOUND}
            max={SALARY_MAX_BOUND}
            step={SALARY_STEP}
            value={value.salaryMax}
            onChange={(event) =>
              patch({
                salaryMax: Math.max(
                  Number(event.target.value),
                  value.salaryMin,
                ),
              })
            }
            aria-label={t('salaryMax')}
            data-filter-target="range"
            className="h-12 w-full accent-accent"
          />
        </div>
      </section>

      {/* Rodzaj umowy */}
      <section>
        <SectionTitle>{t('contractType')}</SectionTitle>
        <div>
          {CONTRACT_TYPES.map((key: ContractTypeT) => (
            <CheckRow
              key={key}
              id={`${idPrefix}-ct-${key}`}
              label={tContract(key)}
              count={facets.contracts[key] ?? 0}
              checked={value.contractTypes.includes(key)}
              onChange={() =>
                patch({ contractTypes: toggle(value.contractTypes, key) })
              }
            />
          ))}
        </div>
      </section>

      {/* Zakwaterowanie */}
      <section>
        <SectionTitle>{t('accommodation')}</SectionTitle>
        <CheckRow
          id={`${idPrefix}-acc-provided`}
          label={t('provided')}
          count={facets.accommodation.provided}
          checked={value.accommodation.includes('provided')}
          onChange={() =>
            patch({
              accommodation: toggle<AccommodationValue>(
                value.accommodation,
                'provided',
              ),
            })
          }
        />
        <CheckRow
          id={`${idPrefix}-acc-unavailable`}
          label={t('unavailable')}
          count={facets.accommodation.unavailable}
          checked={value.accommodation.includes('unavailable')}
          onChange={() =>
            patch({
              accommodation: toggle<AccommodationValue>(
                value.accommodation,
                'unavailable',
              ),
            })
          }
        />
      </section>

      {/* Dodatkowe filtry */}
      <section>
        <SectionTitle>{t('additional')}</SectionTitle>
        <CheckRow
          id={`${idPrefix}-immediate`}
          label={t('immediate')}
          count={facets.immediate}
          checked={value.immediate}
          onChange={(checked) => patch({ immediate: checked })}
        />
        <CheckRow
          id={`${idPrefix}-nolang`}
          label={t('noLanguageRequired')}
          count={facets.noLanguage}
          checked={value.noLanguageRequired}
          onChange={(checked) => patch({ noLanguageRequired: checked })}
        />
      </section>

      {/* Data dodania */}
      <section>
        <SectionTitle>{t('datePosted')}</SectionTitle>
        <Select
          value={value.date}
          onValueChange={(next) => patch({ date: next as DateValue })}
        >
          <SelectTrigger
            aria-label={t('datePosted')}
            data-filter-target="select"
            className="h-12"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_VALUES.map((option) => (
              <SelectItem key={option} value={option}>
                {dateLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------- FilterSidebar */

export interface FilterSidebarProps {
  facets: JobFilterFacets;
  initial: SidebarFilters;
  keyword?: string;
  city?: string;
  sort: SortValue;
  className?: string;
}

/** Buduje ścieżkę wyników z filtrów sidebara + zachowanych parametrów górnej wyszukiwarki. */
function buildHref(
  pathname: string,
  filters: SidebarFilters,
  base: { keyword?: string; city?: string; sort: SortValue },
): string {
  const params = new URLSearchParams(sidebarFiltersToParams(filters));
  if (base.keyword) params.set('keyword', base.keyword);
  if (base.city) params.set('city', base.city);
  if (base.sort !== 'newest') params.set('sort', base.sort);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function FilterSidebar({
  facets: initialFacets,
  initial,
  keyword,
  city,
  sort,
  className,
}: FilterSidebarProps): React.JSX.Element {
  const t = useTranslations('filters');
  const router = useRouter();
  const pathname = usePathname();

  const initialKey = JSON.stringify(initial);
  const [pending, setPending] = React.useState<SidebarFilters>(initial);
  React.useEffect(() => setPending(initial), [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveFacets = useLiveFacets(initialFacets, initial, pending, {
    keyword,
    city,
  });

  const apply = () =>
    router.push(buildHref(pathname, pending, { keyword, city, sort }));
  const clearAll = () => {
    const cleared = emptySidebarFilters();
    setPending(cleared);
    router.push(buildHref(pathname, cleared, { keyword, city, sort }));
  };

  return (
    <div
      data-filter-passport="desktop"
      className={cn('min-w-0 border-r border-border pr-5', className)}
    >
      <div className="mb-5 flex items-center justify-between gap-3 border-b border-border pb-4">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-foreground before:h-2 before:w-2 before:shrink-0 before:rounded-full before:bg-primary">
          {t('title')}
        </h2>
        <button
          type="button"
          onClick={clearAll}
          data-filter-target="clear"
          className="min-h-12 rounded-sm px-1 text-right text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('clearAll')}
        </button>
      </div>

      <FilterFields
        facets={liveFacets.facets}
        value={pending}
        onChange={setPending}
        idPrefix="d"
      />

      {liveFacets.status === 'error' ? (
        <div className="mt-6 space-y-2" role="alert">
          <p className="text-sm text-destructive">{t('countError')}</p>
          <Button type="button" variant="outline" onClick={liveFacets.retry} className="w-full">
            {t('retryCount')}
          </Button>
        </div>
      ) : null}
      <Button
        type="button"
        onClick={apply}
        disabled={liveFacets.status !== 'idle'}
        aria-busy={liveFacets.status === 'loading'}
        className="mt-6 w-full rounded-xl"
      >
        {liveFacets.status === 'idle'
          ? t('showResults', { count: liveFacets.facets.total })
          : liveFacets.status === 'loading'
            ? t('countLoading')
            : t('countUnavailable')}
      </Button>
    </div>
  );
}
