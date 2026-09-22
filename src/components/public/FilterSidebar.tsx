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
  countMatches,
  emptySidebarFilters,
  sidebarFiltersToParams,
  type AccommodationValue,
  type DateValue,
  type FacetItem,
  type SidebarFilters,
  type SortValue,
} from '@/components/public/job-filters';

/**
 * Panel filtrów listy ofert (wg makiety 02-jobs-list).
 *
 * `FilterFields` to KONTROLOWANY zestaw pól (kategoria, lokalizacja, wynagrodzenie, rodzaj
 * umowy, zakwaterowanie, dodatkowe, data) — współdzielony przez wariant desktopowy
 * (`FilterSidebar`) i mobilny bottom-sheet (`FilterSheet`). Liczniki przy pozycjach są
 * niezależne (liczone z przekazanego zbioru `items`), a przycisk „Pokaż N ofert” pokazuje
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

/* ------------------------------------------------------------------ liczniki */

function useFacetCounts(items: readonly FacetItem[]) {
  return React.useMemo(() => {
    const category = new Map<string, number>();
    const location = new Map<string, number>();
    const contract = new Map<string, number>();
    let accommodationProvided = 0;
    let immediate = 0;
    let noLanguage = 0;

    for (const item of items) {
      category.set(item.category, (category.get(item.category) ?? 0) + 1);
      location.set(item.city, (location.get(item.city) ?? 0) + 1);
      contract.set(
        item.contractType,
        (contract.get(item.contractType) ?? 0) + 1,
      );
      if (item.accommodation) accommodationProvided += 1;
      if (item.immediate) immediate += 1;
      if (item.noLanguageRequired) noLanguage += 1;
    }

    const locationOptions = [...location.entries()]
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));

    return {
      category,
      contract,
      locationOptions,
      accommodationProvided,
      accommodationUnavailable: items.length - accommodationProvided,
      immediate,
      noLanguage,
    };
  }, [items]);
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
    <div className="flex min-h-9 items-center gap-2.5 py-1">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <Label
        htmlFor={id}
        className="flex-1 cursor-pointer font-normal text-foreground"
      >
        {label}
      </Label>
      {count !== undefined ? (
        <span className="text-xs tabular-nums text-muted-foreground">
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
  items: readonly FacetItem[];
  value: SidebarFilters;
  onChange: (next: SidebarFilters) => void;
  idPrefix: string;
}

export function FilterFields({
  items,
  value,
  onChange,
  idPrefix,
}: FilterFieldsProps): React.JSX.Element {
  const locale = useLocale();
  const t = useTranslations('filters');
  const tCat = useTranslations('categories');
  const tContract = useTranslations('contractTypes');

  const counts = useFacetCounts(items);

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

  const filteredLocations = counts.locationOptions.filter((opt) =>
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
              count={counts.category.get(key) ?? 0}
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
            className="mt-1 rounded-sm text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
          className="mb-2 h-10"
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
            className="mt-1 rounded-sm text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            className="w-full accent-accent"
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
            className="w-full accent-accent"
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
              count={counts.contract.get(key) ?? 0}
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
          count={counts.accommodationProvided}
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
          count={counts.accommodationUnavailable}
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
          count={counts.immediate}
          checked={value.immediate}
          onChange={(checked) => patch({ immediate: checked })}
        />
        <CheckRow
          id={`${idPrefix}-nolang`}
          label={t('noLanguageRequired')}
          count={counts.noLanguage}
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
          <SelectTrigger aria-label={t('datePosted')}>
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
  items: FacetItem[];
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
  items,
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

  const total = countMatches(items, pending);

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
      className={cn('min-w-0 border-l border-border pl-5', className)}
    >
      <div className="mb-5 flex items-center justify-between gap-3 border-b border-border pb-4">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-foreground before:h-2 before:w-2 before:shrink-0 before:rounded-full before:bg-primary">
          {t('title')}
        </h2>
        <button
          type="button"
          onClick={clearAll}
          className="min-h-11 rounded-sm px-1 text-right text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('clearAll')}
        </button>
      </div>

      <FilterFields
        items={items}
        value={pending}
        onChange={setPending}
        idPrefix="d"
      />

      <Button type="button" onClick={apply} className="mt-6 w-full rounded-xl">
        {t('showResults', { count: total })}
      </Button>
    </div>
  );
}
