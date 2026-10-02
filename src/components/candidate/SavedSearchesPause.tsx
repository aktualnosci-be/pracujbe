'use client';

import * as React from 'react';
import { Loader2, PauseCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { setAlertsPauseAction, type SavedSearchMutationResult } from '@/lib/actions/saved-searches';
import { toUserMessageKey } from '@/lib/errors';
import { BTN_PRIMARY, BTN_SECONDARY, FORM_CONTROL, H2_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Czasowa pauza alertów o nowych ofertach (#810): jedna data wznowienia dla całego konta, bez
 * zmiany ustawień pojedynczych wyszukiwań. Zapis przez RPC (walidacja zakresu dat w bazie);
 * jedna operacja naraz, wynik w regionie `status`/`alert` (Invariant #11). Po wznowieniu
 * (w wybranym dniu albo przyciskiem) alerty wracają zgodnie z ustawieniami wyszukiwań; oferty
 * z okresu pauzy nie wracają w zaległym digeście.
 */
export interface SavedSearchesPauseProps {
  /** Koniec trwającej pauzy (ISO) albo null. */
  pausedUntil: string | null;
  /** Ten koniec w języku panelu (serwer, Europe/Brussels). */
  pausedUntilLabel: string | null;
  /** Najwcześniejszy i najpóźniejszy dzień wznowienia (`YYYY-MM-DD`, Europe/Brussels). */
  minDate: string;
  maxDate: string;
  /** Odczyt stanu pauzy nie powiódł się — stan nieznany, formularz zablokowany. */
  loadError?: boolean;
}

export function SavedSearchesPause({
  pausedUntil,
  pausedUntilLabel,
  minDate,
  maxDate,
  loadError = false,
}: SavedSearchesPauseProps): React.JSX.Element {
  const t = useTranslations('savedSearches');
  const tRoot = useTranslations();
  const router = useRouter();
  const [date, setDate] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const dateId = React.useId();
  const paused = pausedUntil !== null;

  const run = async (action: () => Promise<SavedSearchMutationResult>, okText: string) => {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    try {
      const res = await action();
      if (res.ok) {
        setFeedback({ tone: 'ok', text: okText });
        setDate('');
        router.refresh();
      } else {
        setFeedback({ tone: 'error', text: tRoot(toUserMessageKey(res.error)) });
      }
    } catch {
      setFeedback({ tone: 'error', text: t('errorNetwork') });
    } finally {
      setPending(false);
      statusRef.current?.focus();
    }
  };

  return (
    <section className={cn(PAPER, 'mb-[25px] space-y-3')} aria-labelledby={`${dateId}-title`} aria-busy={pending || undefined}>
      <h2 id={`${dateId}-title`} className={cn(H2_EXTENDED, 'flex items-center gap-2')}>
        <PauseCircle className="h-5 w-5 text-primary" aria-hidden="true" />
        {t('pauseTitle')}
      </h2>
      {loadError ? (
        <p role="alert" className="text-sm text-error-text">{t('pauseLoadError')}</p>
      ) : paused ? (
        <>
          <p className="text-[15px] leading-[1.7] text-foreground">{t('pauseActive', { date: pausedUntilLabel ?? '' })}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(() => setAlertsPauseAction(null), t('pauseResumed'))}
            className={cn(BTN_SECONDARY, 'min-h-11 px-[17px] py-[11px] text-xs')}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('pauseResume')}
          </button>
        </>
      ) : (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (!date) return;
            void run(() => setAlertsPauseAction(date), t('pauseSet'));
          }}
        >
          <div className="min-w-0">
            <label htmlFor={dateId} className="text-sm text-foreground">{t('pauseDateLabel')}</label>
            <input
              id={dateId}
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              required
              disabled={pending}
              aria-describedby={`${dateId}-hint`}
              onChange={(event) => setDate(event.target.value)}
              className={cn(FORM_CONTROL, 'mt-1 w-auto')}
            />
          </div>
          <button type="submit" disabled={pending || !date} className={cn(BTN_PRIMARY, 'min-h-11 px-[17px] py-[11px] text-xs')}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('pauseSubmit')}
          </button>
          <p id={`${dateId}-hint`} className="text-xs text-muted-foreground sm:basis-full">{t('pauseHint')}</p>
        </form>
      )}
      <p
        ref={statusRef}
        tabIndex={-1}
        role={feedback?.tone === 'error' ? 'alert' : 'status'}
        className={feedback?.tone === 'error' ? 'text-sm text-error-text' : 'text-sm text-foreground'}
      >
        {feedback?.text ?? ''}
      </p>
    </section>
  );
}
