import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { ApplicationHistoryList } from '@/components/employer/ApplicationHistoryList';
import { StatusPill } from '@/components/ui/status-pill';
import { loadMoreMyApplicationHistory } from '@/lib/actions/candidate-applications';
import { getMyApplicationDetail } from '@/lib/data/candidate';
import { screeningAnswerText } from '@/lib/screening/answer-text';
import { localizedText } from '@/lib/screening/questions';
import {
  BTN_SECONDARY,
  INFO_LABEL,
  INFO_VALUE,
  PANEL,
  PANEL_H2,
  PANEL_P,
  TAG,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';

/**
 * Szczegół WŁASNEGO zgłoszenia w panelu kandydata (P1-05/P1-06, strona kandydata): dane wysłane
 * do firmy, odpowiedzi na pytania (snapshot #101), historia statusów (stronicowana, #604) i
 * rozmowa. Odczyt pod sesją i RLS (`getMyApplicationDetail`). Stany: błąd odczytu (role="alert"
 * + ponowienie), brak / cudze / usunięte zgłoszenie (notFound — bez ujawniania istnienia), dane.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('employerApplicationDetailTitle'), robots: { index: false, follow: false } };
}

/** Wartości `applications.availability` (0074) → etykiety kreatora (`onboarding.*`). */
const AVAILABILITY_KEYS: Record<string, string> = {
  immediate: 'availImmediate',
  within_two_weeks: 'availWithinTwoWeeks',
  within_month: 'availWithinMonth',
  within_three_months: 'availWithinThreeMonths',
  flexible: 'availFlexible',
};

export default async function CandidateApplicationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const to = await getTranslations({ locale, namespace: 'onboarding' });
  const format = await getFormatter({ locale });

  const result = await getMyApplicationDetail(locale, id);
  if (result.status === 'not_found') notFound();

  const back = (
    <Link href="/candidate/aplikacje" className={TEXT_LINK}>
      {t('candidateApplicationBack')}
    </Link>
  );

  if (result.status === 'error') {
    return (
      <div className="min-w-0 space-y-7">
        {back}
        <section role="alert" className={PANEL}>
          <h1 className={PANEL_H2}>{t('employerApplicationLoadError')}</h1>
          <p className={`mt-2 ${PANEL_P}`}>{t('candidateApplicationLoadErrorHint')}</p>
          <a href={`/${locale}/candidate/aplikacje/${encodeURIComponent(id)}`} className={`mt-5 ${BTN_SECONDARY}`}>
            {t('employerApplicationsRetry')}
          </a>
        </section>
      </div>
    );
  }

  const { application, isDemo } = result;
  const jobTitle = application.jobTitle || t('applicationUnknownJob');
  const notProvided = t('employerApplicationNotProvided');
  const availabilityKey = AVAILABILITY_KEYS[application.availability];
  const submittedAt = application.submittedAt
    ? format.dateTime(new Date(application.submittedAt), { dateStyle: 'medium', timeStyle: 'short' })
    : notProvided;
  const answerLabels = {
    yes: t('employerApplicationYes'),
    no: t('employerApplicationNo'),
    noAnswer: t('employerApplicationScreeningNoAnswer'),
  };

  const field = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className={INFO_LABEL}>{label}</dt>
      <dd className={INFO_VALUE}>{value}</dd>
    </div>
  );

  return (
    <div className="min-w-0 space-y-7">
      {back}
      <div className="min-w-0">
        <CandidatePageHeader
          eyebrow={application.companyName || t('candidatePlaceEyebrow')}
          title={jobTitle}
          intro={application.submittedAt ? t('applicationSentOn', { date: submittedAt }) : undefined}
        />
        {isDemo ? <p className={`mb-4 ${TAG}`}>{t('candidateApplicationDemo')}</p> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <StatusPill status={application.status} className="rounded-[8px] px-3 py-2" />
          <ApplicationActions
            applicationId={application.id}
            status={application.status}
            slug={application.slug}
            jobTitle={application.jobTitle || undefined}
          />
          {application.slug ? (
            <Link href={`/oferty-pracy/${application.slug}`} className={TEXT_LINK}>
              {t('actionView')}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
          {application.conversationId ? (
            <Link href={`/candidate/wiadomosci?c=${application.conversationId}`} className={TEXT_LINK}>
              {t('candidateApplicationConversation')}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="application-submission" className={PANEL}>
        <h2 id="application-submission" className={PANEL_H2}>{t('employerApplicationSubmission')}</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          {field(t('employerApplicationSubmittedAt'), submittedAt)}
          {field(t('employerApplicationCity'), application.city || notProvided)}
          {field(t('employerApplicationPhone'), application.phone || notProvided)}
          {field(t('employerApplicationAvailability'), availabilityKey ? to(availabilityKey) : notProvided)}
        </dl>
        <div className="mt-6 border-t border-border pt-5">
          <h3 className={INFO_LABEL}>{t('candidateApplicationMessageHeading')}</h3>
          {application.message ? (
            <p className="mt-2 whitespace-pre-line break-words text-base text-foreground">{application.message}</p>
          ) : (
            <p className={`mt-2 ${PANEL_P}`}>{t('candidateApplicationNoMessage')}</p>
          )}
        </div>
      </section>

      {application.screeningAnswers.length > 0 ? (
        <section aria-labelledby="application-screening" className={PANEL}>
          <h2 id="application-screening" className={PANEL_H2}>{t('applicationAnswersHeading')}</h2>
          <p className={`mt-1 ${PANEL_P}`}>{t('applicationAnswersHint')}</p>
          <dl className="mt-5 grid gap-5">
            {application.screeningAnswers.map((answer) => (
              <div key={answer.position} className="min-w-0">
                <dt className={INFO_LABEL}>
                  {localizedText(answer.prompt, locale)}
                  {answer.required ? ` (${t('employerApplicationScreeningRequired')})` : ''}
                </dt>
                <dd className={`${INFO_VALUE} whitespace-pre-line`}>{screeningAnswerText(answer, locale, answerLabels)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="application-history" className={PANEL}>
        <h2 id="application-history" className={PANEL_H2}>{t('employerApplicationHistory')}</h2>
        <ApplicationHistoryList
          applicationId={application.id}
          initialItems={application.history}
          initialNextCursor={application.historyNextCursor}
          loadMore={loadMoreMyApplicationHistory}
        />
      </section>
    </div>
  );
}
