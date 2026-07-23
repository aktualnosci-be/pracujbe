import { getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * Paginacja listy ofert (server component). Linki oparte są o query param `page`
 * i zachowują pozostałe filtry (`filters`). Strona 1 nie zawiera parametru `page`
 * (kanoniczny adres bazowy). Renderuje `nav` z linkami — działa bez JS.
 */

export interface PaginationProps {
  /** Ścieżka bazowa listy (bez prefiksu języka), np. `/oferty-pracy`. */
  basePath: string;
  /** Aktualna strona (1-indeksowana). */
  page: number;
  /** Łączna liczba wyników. */
  total: number;
  /** Rozmiar strony. */
  pageSize: number;
  /** Aktywne filtry do zachowania w linkach (bez `page`). */
  filters?: Record<string, string | undefined>;
}

/** Buduje listę pozycji do wyświetlenia (numery stron + wielokropki). */
function buildPages(current: number, totalPages: number): Array<number | 'ellipsis'> {
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const sorted = [...pages]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  const result: Array<number | 'ellipsis'> = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous !== 0 && p - previous > 1) {
      result.push('ellipsis');
    }
    result.push(p);
    previous = p;
  }
  return result;
}

export async function Pagination({
  basePath,
  page,
  total,
  pageSize,
  filters = {},
}: PaginationProps): Promise<React.JSX.Element | null> {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const t = await getTranslations('jobs');
  const current = Math.min(Math.max(1, page), totalPages);

  const hrefFor = (target: number): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    if (target > 1) params.set('page', String(target));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const items = buildPages(current, totalPages);
  const hasPrev = current > 1;
  const hasNext = current < totalPages;

  const arrowClass = cn(buttonVariants({ variant: 'outline', size: 'icon' }));
  const disabledArrowClass = cn(
    buttonVariants({ variant: 'outline', size: 'icon' }),
    'pointer-events-none opacity-50',
  );

  return (
    <nav
      aria-label={t('paginationLabel')}
      className="mt-8 flex items-center justify-center gap-1"
    >
      {hasPrev ? (
        <Link
          href={hrefFor(current - 1)}
          className={arrowClass}
          aria-label={t('paginationPrevious')}
          rel="prev"
        >
          <ChevronLeft aria-hidden="true" />
        </Link>
      ) : (
        <span className={disabledArrowClass} aria-hidden="true">
          <ChevronLeft aria-hidden="true" />
        </span>
      )}

      <ul className="flex items-center gap-1">
        {items.map((item, index) =>
          item === 'ellipsis' ? (
            <li key={`ellipsis-${index}`} className="px-2 text-muted-foreground" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={hrefFor(item)}
                aria-current={item === current ? 'page' : undefined}
                className={cn(
                  buttonVariants({
                    variant: item === current ? 'default' : 'outline',
                    size: 'icon',
                  }),
                )}
              >
                {item}
              </Link>
            </li>
          ),
        )}
      </ul>

      {hasNext ? (
        <Link
          href={hrefFor(current + 1)}
          className={arrowClass}
          aria-label={t('paginationNext')}
          rel="next"
        >
          <ChevronRight aria-hidden="true" />
        </Link>
      ) : (
        <span className={disabledArrowClass} aria-hidden="true">
          <ChevronRight aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
