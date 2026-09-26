import * as React from 'react';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { ADMIN_PAGE_HEADING_FOCUS } from '@/lib/admin/focus';
import { ADMIN_SEARCH_MAX } from '@/lib/admin/list-params';
import { cn } from '@/lib/utils';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EMPTY,
  EYEBROW,
  FIELD,
  FIELD_LABEL,
  H1,
  H1_EXTENDED,
  INTRO,
  SEARCH_BOX,
} from '@/components/admin/admin-styles';

/**
 * Wspólne elementy list panelu admina (#418, #415) — komponenty serwerowe.
 *
 *   - `AdminPageHeader` — nagłówek strony, cel fokusu po akcji, gdy pozycja zniknęła z listy.
 *   - `AdminSearchForm` — wyszukiwanie po stronie serwera (GET, parametry w URL, `<label>`).
 *   - `AdminPager`      — licznik wyników (`role="status"`) + stronicowanie kursorem.
 *   - `AdminEmptyState` — pusty stan. Klasy wizualne: `admin-styles.ts` (kalka prototypu, #5).
 */

type Query = Record<string, string>;

/** Usuwa puste wartości (czysty URL). */
function compact(query: Record<string, string | null | undefined>): Query {
  const out: Query = {};
  for (const [key, value] of Object.entries(query)) {
    if (value) out[key] = value;
  }
  return out;
}

export function AdminPageHeader({
  title,
  subtitle,
  eyebrow,
  extended = false,
}: {
  title: string;
  subtitle: string;
  /** `.eyebrow` nad tytułem (jak w panelach prototypu). */
  eyebrow?: string;
  /** Podstrona szczegółu = `.people .extended h1` (40/30 px) zamiast `.dash-content h1` (#7, Z6). */
  extended?: boolean;
}): React.JSX.Element {
  return (
    <header className="min-w-0">
      {eyebrow ? <p className={EYEBROW}>{eyebrow}</p> : null}
      <h1
        tabIndex={-1}
        data-admin-focus={ADMIN_PAGE_HEADING_FOCUS}
        className={cn(
          extended ? H1_EXTENDED : H1,
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
      >
        {title}
      </h1>
      <p className={INTRO}>{subtitle}</p>
    </header>
  );
}

/** Pusty stan listy (`.empty`) — tylko po udanym odczycie bez wyników. */
export function AdminEmptyState({ message }: { message: string }): React.JSX.Element {
  return <p className={EMPTY}>{message}</p>;
}

export interface AdminSearchFormProps {
  /** Pełna ścieżka z prefiksem locale (zwykły formularz GET). */
  action: string;
  /** Bieżąca fraza (z URL). */
  q: string | null;
  /** Etykieta pola (np. „Szukaj firmy”). */
  label: string;
  /** Podpowiedź, po czym szukamy (opis pola). */
  hint: string;
  /** Parametry do zachowania (np. filtr statusu) — ukryte pola. */
  keep?: Record<string, string | null | undefined>;
  /** Dodatkowe pola (np. filtr roli). */
  children?: React.ReactNode;
  /** Link „Wyczyść” (ścieżka bez locale + zachowane parametry). */
  clearHref: { pathname: string; query?: Query };
}

export function AdminSearchForm({
  action,
  q,
  label,
  hint,
  keep = {},
  children,
  clearHref,
}: AdminSearchFormProps): React.JSX.Element {
  const t = useTranslations('admin');
  const id = 'admin-search';
  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label={label}
      className={SEARCH_BOX}
    >
      {Object.entries(compact(keep)).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <div className="min-w-0 flex-1 basis-60 p-1">
        <label htmlFor={id} className={FIELD_LABEL}>
          {label}
        </label>
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
        <input
          id={id}
          type="search"
          name="q"
          defaultValue={q ?? ''}
          maxLength={ADMIN_SEARCH_MAX}
          aria-describedby={`${id}-hint`}
          className={FIELD}
        />
      </div>
      {children}
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <button
          type="submit"
          className={BTN_PRIMARY}
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          {t('searchSubmit')}
        </button>
        {q ? (
          <Link
            href={clearHref}
            className={BTN_SECONDARY}
          >
            {t('searchClear')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export interface AdminPagerProps {
  /** Ścieżka listy bez prefiksu locale. */
  pathname: string;
  /** Bieżące parametry listy (bez kursora). */
  query: Record<string, string | null | undefined>;
  /** Kursor następnej strony albo null. */
  nextCursor: string | null;
  /** Czy bieżąca strona jest dalszą stroną (URL ma kursor). */
  hasCursor: boolean;
  /** Liczba pozycji na bieżącej stronie. */
  count: number;
  /** Fraza wyszukiwania (do komunikatu wyniku). */
  q?: string | null;
}

export function AdminPager({
  pathname,
  query,
  nextCursor,
  hasCursor,
  count,
  q,
}: AdminPagerProps): React.JSX.Element {
  const t = useTranslations('admin');
  const base = compact(query);
  const linkClass = BTN_SECONDARY;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Wynik ogłaszany czytnikom ekranu po zmianie filtra/strony (#418). */}
      <p role="status" className="text-[13px] text-muted-foreground">
        {q ? t('resultsForQuery', { count, q }) : t('resultsOnPage', { count })}
      </p>
      {hasCursor || nextCursor ? (
        <Pagination aria-label={t('paginationLabel')}>
          <PaginationContent>
            {hasCursor ? (
              <PaginationItem>
                <Link href={{ pathname, query: base }} className={linkClass}>
                  {t('pageFirst')}
                </Link>
              </PaginationItem>
            ) : null}
            {nextCursor ? (
              <PaginationItem>
                <Link href={{ pathname, query: { ...base, cursor: nextCursor } }} className={linkClass}>
                  {t('pageNext')}
                </Link>
              </PaginationItem>
            ) : null}
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}
