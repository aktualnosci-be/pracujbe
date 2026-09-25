'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { BTN_SECONDARY } from '@/components/dashboard/panel-styles';

/**
 * NotificationsDropdown — panel powiadomień (state-showcase §5).
 *
 * Komponent PREZENTACYJNY: renderuje samą kartę z listą powiadomień. Pozycjonowanie
 * (np. pod dzwonkiem w topbarze) należy do rodzica — tu tylko wygląd i zawartość.
 * Używany m.in. przez DashboardShell, ale eksportowany osobno, by ekrany mogły
 * umieszczać go z realnymi danymi w innym miejscu.
 *
 * Teksty chrome (tytuł / „oznacz jako przeczytane" / „zobacz wszystkie") z i18n
 * (namespace `notifications`). Treść pozycji (`items`) to dane wejściowe.
 *
 * #148: pozycja z `href` (cel wyznaczony serwerowo, bez prefiksu locale) jest lokalizowanym
 * linkiem — klik/Enter prowadzi do obiektu, a nieprzeczytana pozycja zgłasza `onItemOpen`
 * (rodzic oznacza JEDNO powiadomienie, bez blokowania nawigacji). „Zobacz wszystkie" pojawia
 * się tylko z dedykowaną listą (`seeAllHref`) — nie kierujemy wszystkiego do wiadomości.
 *
 * #353: kontener to nazwany region (`aria-labelledby` → tytuł), nieprzeczytana pozycja ma
 * tekst tylko dla czytnika. #354: „oznacz wszystkie" ma stan zapisu (`aria-busy`, etykieta
 * „Zapisywanie…"), błąd `role="alert"` (komunikat już przetłumaczony przez rodzica, bez
 * technikaliów) i sukces `role="status"`; po sukcesie fokus trafia na tytuł panelu, nie na `body`.
 */

export interface NotificationItem {
  /** Identyfikator powiadomienia (do oznaczenia jako przeczytane); brak w danych DEMO. */
  id?: string;
  /** Cel powiadomienia BEZ prefiksu locale; bez niego pozycja nie jest linkiem. */
  href?: string;
  /** Treść powiadomienia (już zlokalizowana przez wywołującego). */
  title: string;
  /** Meta, np. względny czas („10 min", „1 h"). Dane, nie chrome UI. */
  meta: string;
  /** Nieprzeczytane — wyróżnione kropką akcentu i pogrubieniem. */
  unread?: boolean;
}

export interface NotificationsDropdownProps {
  items: NotificationItem[];
  /** Licznik nieprzeczytanych; gdy pominięty — liczony z `items`. */
  count?: number;
  /** Odczyt nie powiódł się; nie pokazujemy wtedy pustej skrzynki ani licznika. */
  error?: boolean;
  onRetry?: () => void;
  /** Wywoływane przez „oznacz wszystkie jako przeczytane" (rodzic robi zapis + refresh). */
  onMarkAllRead?: () => void;
  /** Otwarcie pozycji (klik/Enter na linku) — rodzic oznacza ją jako przeczytaną. */
  onItemOpen?: (item: NotificationItem) => void;
  /** Dedykowana lista powiadomień (bez prefiksu locale). Bez niej akcja jest ukryta. */
  seeAllHref?: string;
  /** Klik „Zobacz wszystkie” — rodzic zamyka panel. */
  onSeeAll?: () => void;
  /** Trwa zapis „oznacz wszystkie" — przycisk zajęty (bez utraty fokusu), klik ignorowany. */
  markAllPending?: boolean;
  /** Zapis „oznacz wszystkie" udany — komunikat statusu + fokus na tytule panelu. */
  markAllDone?: boolean;
  /** Przetłumaczony komunikat błędu zapisu „oznacz wszystkie" (Invariant #8). */
  markAllError?: string | null;
}

export function NotificationsDropdown({
  items,
  count,
  error = false,
  onRetry,
  onMarkAllRead,
  onItemOpen,
  seeAllHref,
  onSeeAll,
  markAllPending = false,
  markAllDone = false,
  markAllError = null,
}: NotificationsDropdownProps): React.JSX.Element {
  const t = useTranslations('notifications');
  const unread = count ?? items.filter((item) => item.unread).length;
  const titleId = React.useId();
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  // Po sukcesie przycisk staje się nieaktywny (licznik 0) — fokus przenosimy na tytuł panelu.
  React.useEffect(() => {
    if (markAllDone) titleRef.current?.focus();
  }, [markAllDone]);

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[17px] border border-border bg-card text-left shadow-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="text-[15px] font-bold tracking-[-0.03em] text-foreground focus:outline-none"
          >
            {t('title')}
          </h2>
          {!error && unread > 0 ? (
            <span
              aria-hidden="true"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
              {unread}
            </span>
          ) : null}
        </div>
        {!error ? (
          <button
            type="button"
            onClick={() => {
              if (!markAllPending) onMarkAllRead?.();
            }}
            disabled={unread === 0 && !markAllPending}
            // `aria-disabled` zamiast `disabled` w trakcie zapisu: fokus zostaje na przycisku.
            aria-disabled={markAllPending || undefined}
            aria-busy={markAllPending || undefined}
            className="inline-flex min-h-11 items-center rounded text-xs font-bold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline aria-disabled:cursor-wait aria-disabled:opacity-60"
          >
            {markAllPending ? t('markingAllRead') : t('markAllRead')}
          </button>
        ) : null}
      </div>

      {!error && markAllError ? (
        <p role="alert" className="border-b border-border px-5 py-2 text-[13px] text-error">
          {markAllError}
        </p>
      ) : null}
      {!error && markAllDone && !markAllError ? (
        <p role="status" className="border-b border-border px-5 py-2 text-[13px] text-success-text">
          {t('markedAllRead')}
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="px-5 py-6 text-[13px] text-foreground">
          <p>{t('loadError')}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className={cn(BTN_SECONDARY, 'mt-3')}
            >
              {t('retry')}
            </button>
          ) : null}
        </div>
      ) : items.length > 0 ? (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {items.map((item, index) => {
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    item.unread ? 'bg-primary' : 'bg-transparent',
                  )}
                />
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-[13px] leading-snug',
                      item.unread
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {item.unread ? <span className="sr-only">{`${t('unreadItem')}: `}</span> : null}
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.meta}</p>
                </div>
              </>
            );
            return (
              <li key={item.id ?? `${item.title}-${index}`}>
                {item.href ? (
                  <Link
                    href={item.href}
                    onClick={() => onItemOpen?.(item)}
                    className="flex gap-3 px-5 py-3.5 transition-colors hover:bg-soft focus-visible:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex gap-3 px-5 py-3.5">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 py-[45px] text-center text-[13px] text-muted-foreground">{t('empty')}</p>
      )}

      {!error && seeAllHref ? (
        <div className="border-t border-border px-5 py-2.5 text-center">
          <Link
            href={seeAllHref}
            onClick={() => onSeeAll?.()}
            className="inline-flex min-h-11 items-center rounded text-sm font-bold text-primary hover:underline"
          >
            {t('seeAll')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
