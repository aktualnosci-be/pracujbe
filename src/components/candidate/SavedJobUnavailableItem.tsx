'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { toggleSavedJob } from '@/lib/actions/candidate';
import { SAVED_JOB_STATE_KEYS, type SavedJob } from '@/lib/saved-job-availability';
import { P_EXTENDED, PAPER, TAG, TEXT_LINK } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Karta zapisanej oferty, która nie ma już strony publicznej (0215: zamknięta, wygasła,
 * wstrzymana, usunięta albo firma bez weryfikacji). Ta sama kalka `.pp-passport` co
 * `CandidateJobPassport`, ale BEZ linku (strona odpowiedziałaby 404) i bez zakładki zapisu:
 * etykieta stanu, tytuł i firma (jeśli są) oraz przycisk „Usuń z zapisanych”.
 *
 * Usunięcie: `toggleSavedJob(id, false)` (DELETE pod RLS, idempotentne). Przycisk zablokowany
 * w trakcie (Invariant #11); po sukcesie karta zamienia się w komunikat `role="status"`, który
 * dostaje fokus (fokus nie ginie razem z przyciskiem); błąd = komunikat przy przycisku, karta zostaje.
 */
export function SavedJobUnavailableItem({
  job,
  locationLabel,
}: {
  job: SavedJob;
  locationLabel: string;
}): React.JSX.Element | null {
  const t = useTranslations('dashboard');
  const [state, setState] = React.useState<'idle' | 'pending' | 'error' | 'removed'>('idle');
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (state === 'removed') statusRef.current?.focus();
  }, [state]);

  if (job.availability === 'available') return null;

  const title = job.title || t('applicationUnknownJob');

  const remove = async () => {
    if (state === 'pending') return;
    setState('pending');
    try {
      const res = await toggleSavedJob(job.id, false);
      setState(res.ok ? 'removed' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'removed') {
    return (
      <li>
        <p
          ref={statusRef}
          role="status"
          tabIndex={-1}
          className={cn(PAPER, P_EXTENDED, 'text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
        >
          {t('savedRemoved', { title })}
        </p>
      </li>
    );
  }

  return (
    <li>
      <article className="pp-passport h-full" aria-labelledby={titleId} data-availability={job.availability}>
        <header>
          <p className="pp-passport-category break-words">{job.companyName}</p>
          <span className={TAG}>{t(SAVED_JOB_STATE_KEYS[job.availability])}</span>
        </header>
        <h3 id={titleId}>{title}</h3>
        {job.city ? (
          <dl className="pp-passport-data mt-[19px] grid-cols-1">
            <div>
              <dt>{locationLabel}</dt>
              <dd>{job.city}</dd>
            </div>
          </dl>
        ) : null}
        <p className={cn(P_EXTENDED, 'mt-3 text-sm')}>{t('savedUnavailableHint')}</p>
        {state === 'error' ? (
          <p role="alert" className="mt-2 text-[15px] text-error">{t('savedRemoveError')}</p>
        ) : null}
        <footer>
          <span className="pp-passport-brand" aria-hidden="true">
            pracuj<span className="pp-passport-dot">.be</span>
          </span>
          <button
            type="button"
            onClick={remove}
            disabled={state === 'pending'}
            aria-busy={state === 'pending'}
            aria-label={state === 'pending' ? undefined : t('savedRemoveLabel', { title })}
            className={cn(TEXT_LINK, 'disabled:opacity-60')}
          >
            {state === 'pending' ? t('savedRemoving') : t('savedRemove')}
          </button>
        </footer>
      </article>
    </li>
  );
}
