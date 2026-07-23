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
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger
        className={cn(buttonVariants({ variant: 'outline' }), 'gap-2', className)}
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
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl border-t border-border bg-background shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {t('title')}
            </Dialog.Title>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={clearAll}
                className="text-sm font-medium text-accent hover:text-accent-dark"
              >
                {t('clearAll')}
              </button>
              <Dialog.Close
                aria-label={t('close')}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-9 w-9')}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <FilterFields items={items} value={pending} onChange={setPending} idPrefix="m" />
          </div>

          <div className="border-t border-border p-4">
            <Button type="button" onClick={apply} className="w-full">
              {t('showResults', { count: total })}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
