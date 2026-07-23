'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

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
 */

export interface NotificationItem {
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
  /** Wywoływane przez „oznacz wszystkie jako przeczytane" (rodzic robi zapis + refresh). */
  onMarkAllRead?: () => void;
  /** Docelowa trasa „zobacz wszystkie" (bez prefiksu locale). Bez niej — zwykły przycisk. */
  seeAllHref?: string;
}

export function NotificationsDropdown({
  items,
  count,
  onMarkAllRead,
  seeAllHref,
}: NotificationsDropdownProps): React.JSX.Element {
  const t = useTranslations('notifications');
  const unread = count ?? items.filter((item) => item.unread).length;

  return (
    <div
      role="menu"
      aria-label={t('title')}
      className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-background text-left shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
          {unread > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-foreground">
              {unread}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={unread === 0}
          className="rounded text-xs font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        >
          {t('markAllRead')}
        </button>
      </div>

      {items.length > 0 ? (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {items.map((item, index) => (
            <li key={`${item.title}-${index}`}>
              <div className="flex gap-3 px-4 py-3 transition-colors hover:bg-soft">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    item.unread ? 'bg-accent' : 'bg-transparent',
                  )}
                />
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-sm leading-snug',
                      item.unread
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.meta}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      )}

      <div className="border-t border-border px-4 py-2.5 text-center">
        {seeAllHref ? (
          <Link
            href={seeAllHref}
            className="rounded text-sm font-medium text-accent hover:underline"
          >
            {t('seeAll')}
          </Link>
        ) : (
          <button
            type="button"
            className="rounded text-sm font-medium text-accent hover:underline"
          >
            {t('seeAll')}
          </button>
        )}
      </div>
    </div>
  );
}
