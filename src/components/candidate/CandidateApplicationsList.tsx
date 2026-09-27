'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import { ApplicationScreeningAnswers } from '@/components/candidate/ApplicationScreeningAnswers';
import { StatusPill } from '@/components/ui/status-pill';
import { loadMoreApplications } from '@/lib/actions/candidate-applications';
import type { MyApplication, MyApplicationsPage } from '@/lib/data/candidate';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EYEBROW,
  H2_EXTENDED,
  P_EXTENDED,
  PAPER,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { APP_STEP, APP_STEP_DONE, APP_STEPS } from '@/components/candidate/candidate-styles';
import { cn } from '@/lib/utils';

/** Etapy `.application-steps` z prototypu (klucze `dashboard.*`). */
const APPLICATION_STEPS = [
  'applicationStepSent',
  'applicationStepReview',
  'applicationStepInterview',
  'applicationStepDecision',
] as const;

/** Ostatni osiągnięty etap dla statusu aplikacji (wycofana/szkic = tylko wysłanie). */
function applicationStepIndex(status: string): number {
  switch (status) {
    case 'viewed':
    case 'shortlisted':
      return 1;
    case 'interview':
      return 2;
    case 'offer_sent':
    case 'offer_accepted':
    case 'offer_declined':
    case 'rejected':
    case 'hired':
      return 3;
    default:
      return 0;
  }
}

function formatDate(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts)
    ? ''
    : new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts);
}

export function CandidateApplicationsList({
  locale,
  initialPage,
}: {
  locale: string;
  initialPage: MyApplicationsPage;
}) {
  const t = useTranslations('dashboard');
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);

  // Po zmianie statusu ApplicationActions odświeża trasę; zsynchronizuj karty z nowym SSR.
  useEffect(() => {
    generation.current += 1;
    setItems(initialPage.items);
    setCursor(initialPage.nextCursor);
    setFailed(false);
  }, [initialPage]);

  const loadMore = () => {
    if (!cursor || pending) return;
    const startedAt = generation.current;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await loadMoreApplications(locale, cursor);
        if (generation.current !== startedAt) return;
        if (result.status === 'error') {
          setFailed(true);
          return;
        }
        // A status change or refresh may have returned an already visible record.
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
    return (
      <section className={cn(PAPER, 'px-[25px] py-[45px] text-center')}>
        <h2 className={H2_EXTENDED}>{t('applicationsEmptyTitle')}</h2>
        <p className={cn(P_EXTENDED, 'mt-2')}>{t('applicationsEmptyBody')}</p>
        <Link href="/oferty-pracy" className={cn(BTN_PRIMARY, 'mt-5')}>
          {t('applicationsFindJobs')}
        </Link>
      </section>
    );
  }

  return (
    <div className="min-w-0">
      <ul className="min-w-0">
        {items.map((app: MyApplication) => {
          const date = formatDate(app.date, locale);
          return (
            <li key={app.id} className={PAPER}>
              <article className="min-w-0">
                {/* `.section-head`: `.eyebrow` firma, h2 stanowisko, data; `.status` po prawej. */}
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-5 max-[600px]:gap-2.5">
                  <div className="min-w-0 flex-1">
                    {app.companyName ? <p className={cn(EYEBROW, 'normal-case')}>{app.companyName}</p> : null}
                    <h2 className={cn(H2_EXTENDED, 'mt-0.5')}>
                      {app.jobTitle || t('applicationUnknownJob')}
                    </h2>
                    {date ? <p className={cn(P_EXTENDED, 'mt-1')}>{t('applicationSentOn', { date })}</p> : null}
                  </div>
                  <StatusPill status={app.status} className="rounded-[8px] px-3 py-2" />
                </div>
                {/* `.application-steps` — etapy; aktualny status niesie odznaka powyżej. */}
                <div className={APP_STEPS} aria-hidden="true">
                  {APPLICATION_STEPS.map((step, index) => (
                    <span
                      key={step}
                      className={index <= applicationStepIndex(app.status) ? APP_STEP_DONE : APP_STEP}
                    >
                      {t(step)}
                    </span>
                  ))}
                </div>
                {/* #101: pytania screeningowe i odpowiedzi — snapshot z chwili wysłania. */}
                {app.screeningCount > 0 ? (
                  <ApplicationScreeningAnswers applicationId={app.id} count={app.screeningCount} locale={locale} />
                ) : null}
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                    {/* Demo bez bazy: szczegół też działa (dane przykładowe), więc link zawsze jest. */}
                    <Link
                      href={`/candidate/aplikacje/${encodeURIComponent(app.id)}`}
                      className={TEXT_LINK}
                      aria-label={t('candidateApplicationDetailsLinkLabel', { job: app.jobTitle || t('applicationUnknownJob') })}
                    >
                      {t('candidateApplicationDetailsLink')}
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                    {app.slug ? (
                      <Link href={`/oferty-pracy/${app.slug}`} className={TEXT_LINK}>
                        {t('actionView')}
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                  <ApplicationActions applicationId={app.id} status={app.status} slug={app.slug} jobTitle={app.jobTitle || undefined} />
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {failed ? <p role="alert" className="mb-3 text-[15px] text-error">{t('applicationsMoreError')}</p> : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          aria-busy={pending}
          className={BTN_SECONDARY}
        >
          {pending ? t('applicationsLoading') : failed ? t('candidateListRetry') : t('applicationsMore')}
        </button>
      ) : <p className="text-[13px] text-muted-foreground">{t('applicationsEnd')}</p>}
    </div>
  );
}
