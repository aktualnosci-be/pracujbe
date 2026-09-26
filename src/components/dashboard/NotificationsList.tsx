'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { loadMoreNotifications, markNotificationsRead } from '@/lib/actions/notifications';
import type { NotificationListItem, NotificationsPage } from '@/lib/data/notifications';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  BTN_SECONDARY,
  BTN_SMALL,
  EMPTY,
  PAPER,
  ROW_META,
  ROW_TITLE,
  STATUS,
} from '@/components/dashboard/panel-styles';

/**
 * Pełna lista powiadomień (#148) — `/candidate/powiadomienia`, `/employer/powiadomienia`.
 *
 * Pierwsza strona z SSR, kolejne przez Server Action `loadMoreNotifications` (kursor
 * `created_at` + UUID, jak historia aplikacji). Filtr „nieprzeczytane” w URL (`?nieprzeczytane=1`)
 * — zmiana filtra to nawigacja, strona montuje listę od nowa (`key`). Oznaczenie pojedynczo
 * i wszystkich przez to samo RPC co dropdown (`mark_notifications_read`, tylko własne);
 * otwarcie linku oznacza jedną pozycję. Błąd zapisu = komunikat `role="alert"` z kodu
 * (Invariant #8), wczytane strony zostają. Po oznaczeniu `router.refresh()` odświeża licznik
 * dzwonka; lokalny stan listy się nie resetuje (wczytane strony nie znikają).
 */

export interface NotificationsListProps {
  locale: string;
  /** Ścieżka listy bez prefiksu locale (`/candidate/powiadomienia`). */
  basePath: string;
  initialPage: NotificationsPage;
  unreadOnly: boolean;
}

export function NotificationsList({
  locale,
  basePath,
  initialPage,
  unreadOnly,
}: NotificationsListProps): React.JSX.Element {
  const t = useTranslations('notifications');
  const tRoot = useTranslations();
  const router = useRouter();

  const [items, setItems] = React.useState<NotificationListItem[]>(initialPage.items);
  const [cursor, setCursor] = React.useState(initialPage.nextCursor);
  const [moreFailed, setMoreFailed] = React.useState(false);
  const [loadingMore, startLoadMore] = React.useTransition();
  const [markPending, startMark] = React.useTransition();
  const markInFlight = React.useRef(false);
  const [markError, setMarkError] = React.useState<ErrorCode | null>(null);
  const [markStatus, setMarkStatus] = React.useState<'one' | 'all' | null>(null);
  const titleRefs = React.useRef(new Map<string, HTMLAnchorElement>());
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Licznik z serwera; lokalnie odejmujemy dopiero co oznaczone pozycje, aż odświeżenie
  // trasy przyniesie nową wartość (wtedy zerujemy różnicę).
  const [readDelta, setReadDelta] = React.useState(0);
  React.useEffect(() => setReadDelta(0), [initialPage.unread]);
  const unreadCount = Math.max(0, initialPage.unread - readDelta);

  function markLocal(ids: string[] | null): void {
    const newlyRead = items.filter((item) => item.unread && (ids === null || ids.includes(item.id))).length;
    setItems((current) =>
      current.map((item) => (ids === null || ids.includes(item.id) ? { ...item, unread: false } : item)),
    );
    setReadDelta((delta) => (ids === null ? initialPage.unread : delta + newlyRead));
  }

  function mark(ids: string[] | null): void {
    if (markInFlight.current) return;
    markInFlight.current = true;
    setMarkError(null);
    setMarkStatus(null);
    startMark(async () => {
      try {
        const res = await markNotificationsRead(ids ?? undefined);
        if (!res.ok) {
          setMarkError(res.error);
          return;
        }
        markLocal(ids);
        setMarkStatus(ids === null ? 'all' : 'one');
        router.refresh();
        // Przycisk pozycji znika — fokus na jej tytuł; „wszystkie” → nagłówek listy.
        const target = ids?.[0];
        if (target) titleRefs.current.get(target)?.focus();
        else headingRef.current?.focus();
      } catch {
        setMarkError('INTERNAL');
      } finally {
        markInFlight.current = false;
      }
    });
  }

  // Otwarcie pozycji: nawigacja Linkiem nie czeka na zapis; już przeczytana = brak zapisu.
  function handleOpen(item: NotificationListItem): void {
    if (!item.unread) return;
    void markNotificationsRead([item.id]).then((res) => {
      if (res.ok) router.refresh();
    });
  }

  function loadMore(): void {
    if (!cursor || loadingMore) return;
    setMoreFailed(false);
    startLoadMore(async () => {
      try {
        const result = await loadMoreNotifications(locale, cursor, unreadOnly);
        if (result.status === 'error') {
          setMoreFailed(true);
          return;
        }
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...result.page.items.filter((item) => !seen.has(item.id))];
        });
        setCursor(result.page.nextCursor);
      } catch {
        setMoreFailed(true);
      }
    });
  }

  const allHref = basePath;
  const unreadHref = `${basePath}?nieprzeczytane=1`;
  const listTitleId = React.useId();

  return (
    <section aria-labelledby={listTitleId} className="min-w-0">
      <div className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-[13px]">
        <nav aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
          <Link
            href={allHref}
            aria-current={!unreadOnly ? 'page' : undefined}
            className={cn(BTN_SMALL, !unreadOnly ? 'border-primary text-primary' : 'border-[color:var(--pp-line-btn)] text-foreground')}
          >
            {t('filterAll')}
          </Link>
          <Link
            href={unreadHref}
            aria-current={unreadOnly ? 'page' : undefined}
            className={cn(BTN_SMALL, unreadOnly ? 'border-primary text-primary' : 'border-[color:var(--pp-line-btn)] text-foreground')}
          >
            {t('filterUnread')}
          </Link>
        </nav>
        <button
          type="button"
          onClick={() => {
            if (!markPending) mark(null);
          }}
          disabled={unreadCount === 0 && !items.some((item) => item.unread) && !markPending}
          aria-disabled={markPending || undefined}
          aria-busy={markPending || undefined}
          className={cn(BTN_SECONDARY, 'disabled:cursor-not-allowed disabled:opacity-50')}
        >
          {markPending ? t('markingAllRead') : t('markAllRead')}
        </button>
      </div>

      <h2 id={listTitleId} ref={headingRef} tabIndex={-1} className="sr-only focus:outline-none">
        {unreadOnly ? t('filterUnread') : t('filterAll')}
      </h2>
      <p className={cn(ROW_META, 'mb-3')}>{t('unreadCount', { count: unreadCount })}</p>

      {markError ? (
        <p role="alert" className="mb-3 text-[15px] text-error">{tRoot(toUserMessageKey(markError))}</p>
      ) : null}
      <p role="status" className="sr-only">
        {markStatus === 'all' ? t('markedAllRead') : markStatus === 'one' ? t('markedRead') : ''}
      </p>

      {items.length === 0 ? (
        <div className={PAPER}>
          <p className={EMPTY}>{unreadOnly ? t('emptyUnread') : t('empty')}</p>
        </div>
      ) : (
        <ul className={cn(PAPER, 'divide-y divide-[color:var(--pp-line)] py-0 max-[600px]:py-0')}>
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-wrap items-start justify-between gap-[13px] py-[19px]">
              <div className="flex min-w-0 flex-1 gap-3">
                <span
                  aria-hidden="true"
                  className={cn('mt-2 size-2 shrink-0 rounded-full', item.unread ? 'bg-primary' : 'bg-transparent')}
                />
                <div className="min-w-0">
                  <Link
                    href={item.href}
                    ref={(el: HTMLAnchorElement | null) => {
                      if (el) titleRefs.current.set(item.id, el);
                      else titleRefs.current.delete(item.id);
                    }}
                    onClick={() => handleOpen(item)}
                    className={cn(
                      ROW_TITLE,
                      'inline-flex min-h-11 items-center hover:text-primary hover:underline',
                      !item.unread && 'font-normal text-muted-foreground',
                    )}
                  >
                    {item.unread ? <span className="sr-only">{`${t('unreadItem')}: `}</span> : null}
                    {item.title}
                  </Link>
                  <p className={ROW_META}>
                    <time dateTime={item.createdAt}>{item.dateLabel}</time>
                    {item.meta ? ` · ${item.meta}` : null}
                  </p>
                </div>
              </div>
              {item.unread ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span aria-hidden="true" className={STATUS}>{t('unreadItem')}</span>
                  <button
                    type="button"
                    onClick={() => mark([item.id])}
                    disabled={markPending}
                    aria-label={t('markReadItem', { title: item.title })}
                    className={cn(BTN_SMALL, 'border-[color:var(--pp-line-btn)] text-foreground hover:bg-soft')}
                  >
                    {t('markRead')}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {moreFailed ? <p role="alert" className="mb-3 text-[15px] text-error">{t('moreError')}</p> : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          aria-busy={loadingMore || undefined}
          className={BTN_SECONDARY}
        >
          {loadingMore ? t('loadingMore') : moreFailed ? t('retry') : t('loadMore')}
        </button>
      ) : items.length > 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('listEnd')}</p>
      ) : null}
    </section>
  );
}
