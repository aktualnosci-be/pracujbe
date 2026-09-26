'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { toCamel } from '@/components/ui/status-pill';
import { loadMoreApplicationHistory } from '@/lib/actions/employer-application-history';
import type { ApplicationHistoryCursor, ApplicationHistoryEntry } from '@/lib/data/employer';
import { BTN_SECONDARY } from '@/components/dashboard/panel-styles';

/**
 * Pełna historia statusów zgłoszenia w panelu pracodawcy (#604): pierwsza strona z SSR
 * (`getEmployerApplicationDetail`), kolejne przez Server Action `loadMoreApplicationHistory`
 * (kursor `created_at` + UUID, jak `CandidateProposalsList` dla #245). Błąd kolejnej strony nie
 * usuwa już wczytanych wpisów.
 */
export function ApplicationHistoryList({
  applicationId,
  initialItems,
  initialNextCursor,
}: {
  applicationId: string;
  initialItems: ApplicationHistoryEntry[];
  initialNextCursor: ApplicationHistoryCursor | null;
}) {
  const t = useTranslations('dashboard');
  const ts = useTranslations('status');
  const format = useFormatter();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialNextCursor);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setItems(initialItems);
    setCursor(initialNextCursor);
    setFailed(false);
  }, [initialItems, initialNextCursor]);

  const loadMore = () => {
    if (!cursor || pending) return;
    const startedAt = generation.current;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await loadMoreApplicationHistory(applicationId, cursor);
        if (generation.current !== startedAt) return;
        if (result.status === 'error') {
          setFailed(true);
          return;
        }
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...result.page.items.filter((item) => !seen.has(item.id))];
        });
        setCursor(result.page.nextCursor);
      } catch {
        if (generation.current === startedAt) setFailed(true);
      }
    });
  };

  if (items.length === 0) {
    return <p className="mt-3 text-[15px] text-muted-foreground">{t('employerApplicationNoHistory')}</p>;
  }

  return (
    <div className="mt-4">
      <ol className="space-y-3">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0"
          >
            <span className="font-semibold text-foreground">{ts(toCamel(entry.toStatus))}</span>
            <time dateTime={entry.at} className="text-xs text-muted-foreground">
              {format.dateTime(new Date(entry.at), { dateStyle: 'medium', timeStyle: 'short' })}
            </time>
          </li>
        ))}
      </ol>
      {failed ? (
        <p role="alert" className="mt-3 text-[13px] text-error">
          {t('employerApplicationHistoryMoreError')}
        </p>
      ) : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          aria-busy={pending}
          className={`${BTN_SECONDARY} mt-4`}
        >
          {pending
            ? t('employerApplicationHistoryLoading')
            : failed
              ? t('employerApplicationHistoryRetry')
              : t('employerApplicationHistoryMore')}
        </button>
      ) : null}
    </div>
  );
}
