import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { SendOfferButton } from '@/components/employer/SendOfferButton';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import type { TopMatchedCandidatesLoad } from '@/lib/data/employer';
import {
  BTN_SECONDARY,
  EMPTY,
  ICON_BOX,
  PANEL,
  PANEL_H2,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  STATUS_GOOD,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * „Top dopasowani” na pulpicie pracodawcy (wysyłka propozycji → `sendOffer`). Wydzielone z
 * `employer/page.tsx` (#1133), żeby trasy aktywne w trybie ogłoszeniowym nie importowały
 * `SendOfferButton`; w trybie ogłoszeniowym (`status: 'disabled'`) komponent nic nie renderuje,
 * a pulpit nie ma kolumny bocznej.
 */

/** Inicjały (placeholder avatara). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export async function EmployerTopMatched({
  locale,
  topMatched,
}: {
  locale: string;
  topMatched: TopMatchedCandidatesLoad;
}) {
  if (topMatched.status === 'disabled') return null;
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  return (
    <section className={PANEL}>
      <div className={SECTION_HEAD}>
        <h2 className={PANEL_H2}>{td('topMatched')}</h2>
        <Link href="/employer/kandydaci" className={TEXT_LINK}>
          {td('seeAllCandidates')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      {/* Błąd, brak uprawnień i firma przed weryfikacją ≠ pusta lista (P1-14). */}
      {topMatched.status === 'error' ? (
        <EmployerStatsError message={td('topMatchedLoadError')} retryLabel={tc('retry')} />
      ) : topMatched.status === 'denied' ? (
        <p className={EMPTY}>{td('topMatchedDenied')}</p>
      ) : topMatched.status === 'unverified' ? (
        <p className={EMPTY}>{td('topMatchedUnverified')}</p>
      ) : topMatched.candidates.length === 0 ? (
        <p className={EMPTY}>{td('emptyState')}</p>
      ) : (
        <ul>
          {topMatched.candidates.map((candidate) => (
            <li key={candidate.candidateId} className={cn(ROW, 'flex-wrap items-center')}>
              <span className={ICON_BOX} aria-hidden="true">
                {initials(candidate.name || td('candidateFallback'))}
              </span>
              <div className="min-w-0 flex-1 basis-32">
                <p className={ROW_TITLE}>{candidate.name || td('candidateFallback')}</p>
                {candidate.role ? <p className={ROW_META}>{candidate.role}</p> : null}
                {candidate.city ? <p className={ROW_META}>{candidate.city}</p> : null}
                {candidate.jobTitle ? (
                  <p className={ROW_META}>{td('offerForJob', { job: candidate.jobTitle })}</p>
                ) : null}
                <span className={cn(STATUS_GOOD, 'mt-1.5 font-semibold tabular-nums')}>
                  {candidate.match}%
                </span>
              </div>
              <SendOfferButton
                jobId={candidate.jobId}
                candidateId={candidate.candidateId}
                candidateName={candidate.name || td('candidateFallback')}
                jobTitle={candidate.jobTitle}
                jobSlug={candidate.jobSlug}
                offerSentAt={candidate.offerSentAt}
                className="w-full whitespace-normal text-center sm:w-auto"
              />
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-border pt-[19px]">
        <Link href="/employer/kandydaci" className={cn(BTN_SECONDARY, 'w-full')}>
          {td('goToCandidates')}
        </Link>
      </div>
    </section>
  );
}
