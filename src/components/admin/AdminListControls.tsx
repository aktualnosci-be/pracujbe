import * as React from 'react';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { ADMIN_PAGE_HEADING_FOCUS } from '@/lib/admin/focus';
import { ADMIN_SEARCH_MAX } from '@/lib/admin/list-params';
import { cn } from '@/lib/utils';

/**
 * Wspólne elementy list panelu admina (#418, #415) — komponenty serwerowe.
 *
 *   - `AdminPageHeader` — nagłówek strony, cel fokusu po akcji, gdy pozycja zniknęła z listy.
 *   - `AdminSearchForm` — wyszukiwanie po stronie serwera (GET, parametry w URL, `<label>`).
 *   - `AdminPager`      — licznik wyników (`role="status"`) + stronicowanie kursorem.
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
}: {
  title: string;
  subtitle: string;
}): React.JSX.Element {
  return (
    <header>
      <h1
        tabIndex={-1}
        data-admin-focus={ADMIN_PAGE_HEADING_FOCUS}
        className="text-2xl font-bold tracking-tight text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </header>
  );
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
      className="flex flex-wrap items-end gap-3"
    >
      {Object.entries(compact(keep)).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <div className="min-w-0 flex-1 basis-60">
        <label htmlFor={id} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
        <input
          id={id}
          type="search"
          name="q"
          defaultValue={q ?? ''}
          maxLength={ADMIN_SEARCH_MAX}
          aria-describedby={`${id}-hint`}
          className="mt-1 block min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {children}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-semibold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Search className="size-4" aria-hidden="true" />
          {t('searchSubmit')}
        </button>
        {q ? (
          <Link
            href={clearHref}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
  const linkClass =
    'inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Wynik ogłaszany czytnikom ekranu po zmianie filtra/strony (#418). */}
      <p role="status" className="text-sm text-muted-foreground">
        {q ? t('resultsForQuery', { count, q }) : t('resultsOnPage', { count })}
      </p>
      {hasCursor || nextCursor ? (
        <nav aria-label={t('paginationLabel')} className={cn('flex flex-wrap gap-2')}>
          {hasCursor ? (
            <Link href={{ pathname, query: base }} className={linkClass}>
              {t('pageFirst')}
            </Link>
          ) : null}
          {nextCursor ? (
            <Link href={{ pathname, query: { ...base, cursor: nextCursor } }} className={linkClass}>
              {t('pageNext')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
