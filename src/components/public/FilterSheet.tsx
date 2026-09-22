'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { FilterFields } from '@/components/public/FilterSidebar';
import {
  CATEGORY_KEYS,
  CONTRACT_TYPES,
  DATE_VALUES,
  SALARY_MAX_BOUND,
  SALARY_MIN_BOUND,
  SALARY_STEP,
  countActiveSidebar,
  countMatches,
  emptySidebarFilters,
  sidebarFiltersToParams,
  type FacetItem,
  type SidebarFilters,
  type SortValue,
} from '@/components/public/job-filters';

/**
 * Mobilny panel filtrów (bottom-sheet na Radix Dialog) wg makiety 02-jobs-list.
 *
 * Wyzwalacz „Filtry (n)” pokazuje liczbę aktywnych filtrów (z URL). Wysuwany od dołu arkusz
 * zawiera te same pola co desktopowy `FilterSidebar` (współdzielony `FilterFields`), a przycisk
 * „Pokaż N ofert” zatwierdza wybór (zapis w URL) i zamyka arkusz. Zmiany są PENDING do
 * momentu zatwierdzenia; przy każdym otwarciu stan jest resetowany do bieżących filtrów z URL.
 */

export interface FilterSheetProps {
  items: FacetItem[];
  initial: SidebarFilters;
  keyword?: string;
  city?: string;
  sort: SortValue;
  className?: string;
}

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

function NoScriptFilterForm({
  items,
  initial,
  keyword,
  city,
  sort,
  pathname,
}: Omit<FilterSheetProps, 'className'> & {
  pathname: string;
}): React.JSX.Element {
  const t = useTranslations('filters');
  const tCat = useTranslations('categories');
  const tContract = useTranslations('contractTypes');
  const locations = [...new Set(items.map((item) => item.city))].sort((a, b) =>
    a.localeCompare(b),
  );
  const clearHref = buildHref(pathname, emptySidebarFilters(), {
    keyword,
    city,
    sort,
  });
  const controlClass =
    'min-h-12 w-full rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  const optionClass = 'flex min-h-12 items-center gap-3';

  const dateLabel = (option: (typeof DATE_VALUES)[number]): string => {
    if (option === '24h') return t('date24h');
    if (option === '7d') return t('date7d');
    if (option === '30d') return t('date30d');
    return t('any');
  };

  return (
    <form
      method="get"
      action={pathname}
      data-filter-passport="no-js"
      className="space-y-5 rounded-xl border border-border bg-background p-4"
    >
      {keyword ? <input type="hidden" name="keyword" value={keyword} /> : null}
      {city ? <input type="hidden" name="city" value={city} /> : null}
      {sort !== 'newest' ? (
        <input type="hidden" name="sort" value={sort} />
      ) : null}

      <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <h2 className="text-base font-semibold text-foreground">
          {t('title')}
        </h2>
        <a
          href={clearHref}
          className="inline-flex min-h-12 items-center rounded-sm text-sm font-medium text-accent"
        >
          {t('clearAll')}
        </a>
      </div>

      <label className="block space-y-2 text-sm font-semibold text-foreground">
        <span>{t('category')}</span>
        <select
          name="category"
          defaultValue={initial.categories[0] ?? ''}
          className={controlClass}
        >
          <option value="">{t('any')}</option>
          {CATEGORY_KEYS.map((key) => (
            <option key={key} value={key}>
              {tCat(key)}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-2 text-sm font-semibold text-foreground">
        <span>{t('location')}</span>
        <select
          name="location"
          defaultValue={initial.locations[0] ?? ''}
          className={controlClass}
        >
          <option value="">{t('any')}</option>
          {locations.map((location) => (
            <option key={location} value={location}>
              {location}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="space-y-3 border-t border-border pt-5">
        <legend className="text-sm font-semibold text-foreground">
          {t('salary')}
        </legend>
        <label className="block space-y-2 text-sm text-foreground">
          <span>{t('salaryMin')}</span>
          <input
            type="number"
            name="salaryMin"
            min={SALARY_MIN_BOUND}
            max={SALARY_MAX_BOUND}
            step={SALARY_STEP}
            defaultValue={initial.salaryMin}
            className={controlClass}
          />
        </label>
        <label className="block space-y-2 text-sm text-foreground">
          <span>{t('salaryMax')}</span>
          <input
            type="number"
            name="salaryMax"
            min={SALARY_MIN_BOUND}
            max={SALARY_MAX_BOUND}
            step={SALARY_STEP}
            defaultValue={initial.salaryMax}
            className={controlClass}
          />
        </label>
      </fieldset>

      <label className="block space-y-2 text-sm font-semibold text-foreground">
        <span>{t('contractType')}</span>
        <select
          name="contractType"
          defaultValue={initial.contractTypes[0] ?? ''}
          className={controlClass}
        >
          <option value="">{t('any')}</option>
          {CONTRACT_TYPES.map((key) => (
            <option key={key} value={key}>
              {tContract(key)}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-2 text-sm font-semibold text-foreground">
        <span>{t('accommodation')}</span>
        <select
          name="accommodation"
          defaultValue={initial.accommodation[0] ?? ''}
          className={controlClass}
        >
          <option value="">{t('any')}</option>
          <option value="provided">{t('provided')}</option>
          <option value="unavailable">{t('unavailable')}</option>
        </select>
      </label>

      <fieldset className="space-y-1 border-t border-border pt-5">
        <legend className="mb-2 text-sm font-semibold text-foreground">
          {t('additional')}
        </legend>
        <label className={optionClass}>
          <input
            type="checkbox"
            name="immediate"
            value="1"
            defaultChecked={initial.immediate}
          />
          <span>{t('immediate')}</span>
        </label>
        <label className={optionClass}>
          <input
            type="checkbox"
            name="noLang"
            value="1"
            defaultChecked={initial.noLanguageRequired}
          />
          <span>{t('noLanguageRequired')}</span>
        </label>
      </fieldset>

      <label className="block space-y-2 text-sm font-semibold text-foreground">
        <span>{t('datePosted')}</span>
        <select
          name="date"
          defaultValue={initial.date}
          className={controlClass}
        >
          {DATE_VALUES.map((option) => (
            <option key={option} value={option}>
              {dateLabel(option)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground"
      >
        {t('showResults', { count: countMatches(items, initial) })}
      </button>
    </form>
  );
}

export function FilterSheet({
  items,
  initial,
  keyword,
  city,
  sort,
  className,
}: FilterSheetProps): React.JSX.Element {
  const t = useTranslations('filters');
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<SidebarFilters>(initial);

  // Reset stanu do bieżących filtrów przy każdym otwarciu arkusza.
  const handleOpenChange = (next: boolean) => {
    if (next) setPending(initial);
    setOpen(next);
  };

  const activeCount = countActiveSidebar(initial);
  const total = countMatches(items, pending);

  const apply = () => {
    router.push(buildHref(pathname, pending, { keyword, city, sort }));
    setOpen(false);
  };
  const clearAll = () => setPending(emptySidebarFilters());

  return (
    <>
      <noscript>
        <style>
          {'[data-filter-passport="mobile-trigger"]{display:none!important}'}
        </style>
        <NoScriptFilterForm
          items={items}
          initial={initial}
          keyword={keyword}
          city={city}
          sort={sort}
          pathname={pathname}
        />
      </noscript>
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Trigger
          data-filter-passport="mobile-trigger"
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'min-h-12 gap-2 rounded-xl border-border bg-background',
            className,
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span>{t('title')}</span>
          {activeCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content
            aria-describedby={undefined}
            data-filter-passport="mobile-sheet"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] min-w-0 flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
          >
            <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-2 border-b border-border bg-background px-4 py-2">
              <Dialog.Title className="flex items-center gap-2.5 text-base font-semibold text-foreground before:h-2 before:w-2 before:shrink-0 before:rounded-full before:bg-primary">
                {t('title')}
              </Dialog.Title>
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={clearAll}
                  data-filter-target="clear"
                  className="min-h-12 rounded-md px-2 text-sm font-medium text-accent hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {t('clearAll')}
                </button>
                <Dialog.Close
                  aria-label={t('close')}
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'icon' }),
                    'h-12 w-12 shrink-0 rounded-xl',
                  )}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </Dialog.Close>
              </div>
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5">
              <FilterFields
                items={items}
                value={pending}
                onChange={setPending}
                idPrefix="m"
              />
            </div>

            <div className="sticky bottom-0 z-10 border-t border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button
                type="button"
                onClick={apply}
                className="min-h-12 w-full rounded-xl"
              >
                {t('showResults', { count: total })}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
