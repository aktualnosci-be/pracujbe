import { getTranslations } from 'next-intl/server';

import type { CompanyModerationDecision } from '@/lib/data/company';
import { createAppDateFormatter } from '@/lib/datetime';

/**
 * Decyzje moderacyjne wobec firmy i jej ofert (#42) — uzasadnienie dla autora treści:
 * rodzaj i zasięg ograniczenia, fakty, podstawa, udział automatyzacji, numer decyzji
 * (do odwołania) i ewentualne cofnięcie. Droga odwołania: kontakt przez stronę Pomoc z numerem
 * decyzji; pełną procedurę uzupełnia właściciel serwisu (jawny znacznik, bez treści prawnej).
 */

const DECISION_KEY: Record<string, string> = {
  job_removed: 'moderationJobRemoved',
  company_suspended: 'moderationCompanySuspended',
};

const GROUND_KEY: Record<string, string> = {
  terms: 'moderationGroundTerms',
  law: 'moderationGroundLaw',
};

export async function CompanyModerationDecisions({
  locale,
  decisions,
  loadError,
}: {
  locale: string;
  decisions: CompanyModerationDecision[];
  loadError: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'company' });
  if (!loadError && decisions.length === 0) return null;
  const formatDate = createAppDateFormatter(locale, { withTime: true });

  return (
    <section
      aria-labelledby="company-moderation-title"
      className="rounded-3xl border border-border bg-card p-5 sm:p-7"
    >
      <h2 id="company-moderation-title" className="text-base font-semibold text-foreground">
        {t('moderationTitle')}
      </h2>
      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-error-text">
          {t('moderationLoadError')}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {decisions.map((d) => (
            <li key={d.id} className="rounded-2xl border border-border p-4 text-sm">
              <p className="font-semibold text-foreground">
                {t(DECISION_KEY[d.decision] ?? 'moderationCompanySuspended')}
                {d.jobTitle && d.decision === 'job_removed' ? (
                  <span className="font-normal text-muted-foreground"> — {d.jobTitle}</span>
                ) : null}
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
                <dt className="text-xs text-muted-foreground">{t('moderationReference')}</dt>
                <dd className="font-mono text-foreground">{d.reference}</dd>
                <dt className="text-xs text-muted-foreground">{t('moderationDecidedAt')}</dt>
                <dd className="text-foreground">
                  <time dateTime={d.decidedAt}>{formatDate(d.decidedAt)}</time>
                </dd>
                <dt className="text-xs text-muted-foreground">{t('moderationFacts')}</dt>
                <dd className="break-words text-foreground">{d.facts}</dd>
                {d.groundType ? (
                  <>
                    <dt className="text-xs text-muted-foreground">{t('moderationGround')}</dt>
                    <dd className="break-words text-foreground">
                      {t(GROUND_KEY[d.groundType] ?? 'moderationGroundTerms')}
                      {d.groundReference ? ` — ${d.groundReference}` : ''}
                    </dd>
                  </>
                ) : null}
                <dt className="text-xs text-muted-foreground">{t('moderationAutomation')}</dt>
                <dd className="text-foreground">
                  {t(d.automatedDetection ? 'moderationAutomatedYes' : 'moderationAutomatedNo')}
                </dd>
                {d.restoredAt ? (
                  <>
                    <dt className="text-xs text-muted-foreground">{t('moderationRestoredAt')}</dt>
                    <dd className="break-words text-foreground">
                      <time dateTime={d.restoredAt}>{formatDate(d.restoredAt)}</time>
                      {d.restoreReason ? ` — ${d.restoreReason}` : ''}
                    </dd>
                  </>
                ) : null}
              </dl>
              {!d.restoredAt ? (
                <p className="mt-3 text-muted-foreground">
                  {t('moderationRedress', { reference: d.reference })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 rounded-md border border-dashed border-border bg-soft p-3 text-sm text-muted-foreground">
        {t('moderationLegalPlaceholder')}
      </p>
    </section>
  );
}
