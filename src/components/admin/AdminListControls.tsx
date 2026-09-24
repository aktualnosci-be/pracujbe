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
 *   - klasy i `AdminEmptyState`/`adminChipClass` — styl „paszport pracy” (#5): karty
 *     `rounded-3xl`, zaokrąglone pola i przyciski, wyłącznie tokeny kolorów.
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

/** Klasy przycisku/linku drugorzędnego w stylu paszportu (#5) — obramowany, zaokrąglony. */
export const ADMIN_OUTLINE_LINK =
  'inline-flex min-h-11 max-w-full items-center justify-center rounded-xl border border-input bg-card px-4 text-center text-sm font-semibold [overflow-wrap:anywhere] text-foreground transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** Pole formularza (input/select) w stylu paszportu. */
export const ADMIN_FIELD =
  'mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Główna akcja formularza (czarna, tekst tła — kontrast AA). */
export const ADMIN_PRIMARY_BUTTON =
  'inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-center text-sm font-semibold [overflow-wrap:anywhere] text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** Karta sekcji panelu w stylu paszportu (#5). */
export const ADMIN_CARD = 'min-w-0 rounded-3xl border border-border bg-card';

export function AdminPageHeader({
  title,
  subtitle,
  eyebrow,
}: {
  title: string;
  subtitle: string;
  /** Mała etykieta nad tytułem (uppercase, kolor marki) — jak w panelach kandydata/pracodawcy. */
  eyebrow?: string;
}): React.JSX.Element {
  return (
    <header className="min-w-0">
      {eyebrow ? (
        <p className="mb-2 break-words text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </p>
      ) : null}
      <h1
        tabIndex={-1}
        data-admin-focus={ADMIN_PAGE_HEADING_FOCUS}
        className="break-words text-3xl font-bold tracking-tight text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {title}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
    </header>
  );
}

/** Pusty stan listy — w karcie, wyśrodkowany (po udanym odczycie bez wyników). */
export function AdminEmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="px-5 py-10 text-center sm:px-7">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Chip filtra (link) — cel dotyku 44 px, aktywny = pełne tło marki (biały tekst na czerwieni, AA).
 */
export function adminChipClass(isActive: boolean): string {
  return cn(
    'inline-flex min-h-11 max-w-full items-center break-words rounded-full border px-3 py-1 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isActive
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-input bg-card text-foreground hover:bg-soft',
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
      className={cn(ADMIN_CARD, 'flex flex-wrap items-end gap-3 p-4 sm:p-6')}
    >
      {Object.entries(compact(keep)).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <div className="min-w-0 flex-1 basis-60">
        <label htmlFor={id} className="block text-sm font-semibold text-foreground">
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
          className={ADMIN_FIELD}
        />
      </div>
      {children}
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <button
          type="submit"
          className={ADMIN_PRIMARY_BUTTON}
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          {t('searchSubmit')}
        </button>
        {q ? (
          <Link
            href={clearHref}
            className={ADMIN_OUTLINE_LINK}
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
  const linkClass = ADMIN_OUTLINE_LINK;
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
