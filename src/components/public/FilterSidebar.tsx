'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Link, useRouter, usePathname } from '@/i18n/navigation';
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

/* ------------------------------------------------ fokus po zatwierdzeniu (#224) */

/**
 * Po zatwierdzeniu filtrów lista wyników renderuje się od nowa (panel filtrów jest montowany
 * ponownie), więc fokus klawiatury trafiał na `<body>`. Flaga modułu przetrwa ponowny montaż
 * i przenosi fokus na widoczny nagłówek wyników (`[data-results-heading]`).
 */
let focusResultsAfterNavigation = false;

export function requestResultsFocus(): void {
  focusResultsAfterNavigation = true;
}

export function useFocusResultsAfterNavigation(filtersKey: string): void {
  React.useEffect(() => {
    if (!focusResultsAfterNavigation) return;
    const heading = Array.from(
      document.querySelectorAll<HTMLElement>('[data-results-heading]'),
    ).find((element) => element.offsetParent !== null);
    if (!heading) return;
    focusResultsAfterNavigation = false;
    heading.focus();
  }, [filtersKey]);
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

/**
 * Nawigacja do wyników filtrów jako przejście Reacta (#222): `isNavigating` trwa, dopóki
 * nowe wyniki (RSC) nie zostaną wyrenderowane. W tym czasie kolejne zatwierdzenia są
 * ignorowane — ref blokuje też dwa kliknięcia w tej samej klatce, zanim stan się odświeży.
 */
export function useFilterNavigation(): {
  isNavigating: boolean;
  navigate: (href: string) => boolean;
} {
  const router = useRouter();
  const [isNavigating, startTransition] = React.useTransition();
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (!isNavigating) inFlight.current = false;
  }, [isNavigating]);

  const navigate = React.useCallback(
    (href: string) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      startTransition(() => router.push(href));
      return true;
    },
    [router],
  );

  return { isNavigating, navigate };
}

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
  const tJobs = useTranslations('jobs');
  const pathname = usePathname();
  const { isNavigating, navigate } = useFilterNavigation();

  const initialKey = JSON.stringify(initial);
  const [pending, setPending] = React.useState<SidebarFilters>(initial);
  React.useEffect(() => setPending(initial), [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveFacets = useLiveFacets(initialFacets, initial, pending, {
    keyword,
    city,
  });

  useFocusResultsAfterNavigation(initialKey);

  const apply = () => {
    if (navigate(buildHref(pathname, pending, { keyword, city, sort }))) {
      requestResultsFocus();
    }
  };
  const clearAll = () => {
    if (isNavigating) return;
    const cleared = emptySidebarFilters();
    setPending(cleared);
    if (navigate(buildHref(pathname, cleared, { keyword, city, sort }))) {
      requestResultsFocus();
    }
  };

  return (
    <div
      data-filter-passport="desktop"
      className={cn(
        'flex min-h-0 min-w-0 flex-col border-r border-border pr-5',
        className,
      )}
    >
      <div className="mb-5 flex shrink-0 items-center justify-between gap-3 border-b border-border pb-4">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-foreground before:h-2 before:w-2 before:shrink-0 before:rounded-full before:bg-primary">
          {t('title')}
        </h2>
        <button
          type="button"
          onClick={clearAll}
          aria-disabled={isNavigating}
          data-filter-target="clear"
          className="min-h-12 rounded-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60 px-1 text-right text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('clearAll')}
        </button>
      </div>

      {/* Pola przewijają się wewnątrz panelu; zatwierdzenie zostaje widoczne pod nimi (#216). */}
      <div
        data-filter-scroll="desktop"
        className="-mx-1 min-h-0 flex-1 overflow-y-auto border-b border-border px-1 pb-5 pt-1"
      >
        <FilterFields
          facets={liveFacets.facets}
          value={pending}
          onChange={setPending}
          idPrefix="d"
        />
      </div>

      {liveFacets.status === 'error' ? (
        <div className="mt-6 space-y-2" role="alert">
          <p className="text-sm text-destructive">{t('countError')}</p>
          <Button type="button" variant="outline" onClick={liveFacets.retry} className="w-full">
            {t('retryCount')}
          </Button>
        </div>
      ) : null}
      {/* `aria-disabled` zamiast `disabled`: fokus zostaje na przycisku w trakcie nawigacji (#222). */}
      <Button
        type="button"
        onClick={apply}
        aria-busy={isNavigating || liveFacets.status === 'loading'}
        aria-disabled={isNavigating}
        data-filter-apply="desktop"
        className="mt-6 w-full rounded-xl aria-disabled:cursor-not-allowed aria-disabled:opacity-70"
      >
        {/* Licznik to tylko podpowiedź: bez aktualnej liczby zatwierdzenie nadal działa (#220). */}
        {isNavigating
          ? t('resultsLoading')
          : liveFacets.status === 'idle'
            ? t('showResults', { count: liveFacets.facets.total })
            : tJobs('filterButton')}
      </Button>
      {/* Region stale w DOM, żeby czytnik ekranu ogłosił ładowanie wyników. */}
      <p
        role="status"
        data-filter-status="desktop"
        className="mt-2 min-h-4 text-center text-xs text-muted-foreground"
      >
        {isNavigating
          ? t('resultsLoading')
          : liveFacets.status === 'loading'
            ? t('countLoading')
            : null}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ SortMenu */

export interface SortMenuOption {
  value: SortValue;
  label: string;
  href: string;
}

export interface SortMenuProps {
  sortByLabel: string;
  current: SortValue;
  options: readonly SortMenuOption[];
}

/**
 * Menu sortowania listy ofert. `<details>` działa bez JS; po hydratacji Escape i kliknięcie poza
 * menu je zamykają (Escape zwraca fokus na przycisk), a bieżąca opcja ma `aria-current` (#233).
 */
export function SortMenu({
  sortByLabel,
  current,
  options,
}: SortMenuProps): React.JSX.Element {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const currentLabel =
    options.find((option) => option.value === current)?.label ?? '';

  React.useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.open) return;
      event.preventDefault();
      details.open = false;
      details.querySelector('summary')?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) {
        details.open = false;
      }
    };
    details.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      details.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  return (
    <details ref={ref} data-sort-menu className="group relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <span className="text-muted-foreground">{sortByLabel}:</span>
        <span className="font-medium">{currentLabel}</span>
        <ChevronDown
          className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-60 rounded-md border border-border bg-background p-1 shadow-md">
        {options.map((option) => (
          <Link
            key={option.value}
            href={option.href}
            aria-current={option.value === current ? 'true' : undefined}
            className={cn(
              'flex min-h-11 items-center rounded-sm px-3 py-2 text-sm transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              option.value === current
                ? 'font-medium text-accent'
                : 'text-foreground',
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
