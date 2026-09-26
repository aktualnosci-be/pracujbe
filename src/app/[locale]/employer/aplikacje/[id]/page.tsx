import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getEmployerApplicationDetail } from '@/lib/data/employer';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationHistoryList } from '@/components/employer/ApplicationHistoryList';
import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';
import { MessageCandidateButton } from '@/components/employer/MessageCandidateButton';
import { AVAILABILITY_KEYS, LEVEL_KEYS } from '@/components/employer/candidate-labels';
import { localizedText, type ScreeningAnswer } from '@/lib/screening/questions';
import {
  EYEBROW,
  H1_EXTENDED,
  INFO_LABEL,
  INFO_VALUE,
  INTRO,
  PANEL,
  PANEL_H2,
  PANEL_P,
  TAG,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';

/**
 * Szczegół zgłoszenia w panelu pracodawcy (#300). Odczyt pod sesją i RLS (recruiter+ firmy —
 * 0039), zawężony do aktywnej firmy. Stany: błąd odczytu (role="alert" + ponowienie),
 * brak dostępu / nie znaleziono (notFound — bez ujawniania istnienia cudzych zgłoszeń), dane.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('employerApplicationDetailTitle'), robots: { index: false, follow: false } };
}

const LINK_CLASS =
  'inline-flex min-h-12 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export default async function EmployerApplicationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const to = await getTranslations({ locale, namespace: 'onboarding' });
  const format = await getFormatter({ locale });

  const result = await getEmployerApplicationDetail(id);
  if (result.status === 'not_found') notFound();

  const back = (
    <Link href="/employer/aplikacje" className={TEXT_LINK}>
      {t('employerApplicationBack')}
    </Link>
  );

  if (result.status === 'error') {
    return (
      <div className="space-y-7">
        {back}
        <section role="alert" className={PANEL}>
          <h1 className={PANEL_H2}>{t('employerApplicationLoadError')}</h1>
          <p className={`mt-2 ${PANEL_P}`}>{t('employerApplicationsLoadErrorHint')}</p>
          <a href={`/${locale}/employer/aplikacje/${encodeURIComponent(id)}`} className={`mt-5 ${LINK_CLASS}`}>
            {t('employerApplicationsRetry')}
          </a>
        </section>
      </div>
    );
  }

  const { application, isDemo } = result;
  const name = application.candidateName || t('candidateFallback');
  const jobTitle = application.jobTitle || t('applicationUnknownJob');
  const notProvided = t('employerApplicationNotProvided');
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : notProvided;
  const availabilityKey = AVAILABILITY_KEYS[application.availability];
  const profile = application.profile;

  // #101: odpowiedź ze snapshotu (treść opcji z chwili aplikowania, nie z bieżącej oferty).
  const screeningAnswerText = (answer: ScreeningAnswer): string => {
    if (answer.type === 'yes_no' && answer.answerBoolean !== null) {
      return answer.answerBoolean ? t('employerApplicationYes') : t('employerApplicationNo');
    }
    if (answer.type === 'date' && answer.answerDate) {
      return format.dateTime(new Date(`${answer.answerDate}T12:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' });
    }
    if (answer.type === 'single_choice' && answer.answerText) {
      const option = answer.options.find((o) => o.id === answer.answerText);
      return option ? localizedText(option.label, locale) : answer.answerText;
    }
    if (answer.type === 'short_text' && answer.answerText) return answer.answerText;
    return t('employerApplicationScreeningNoAnswer');
  };

  const field = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className={INFO_LABEL}>{label}</dt>
      <dd className={INFO_VALUE}>{value}</dd>
    </div>
  );

  return (
    <div className="space-y-7">
      {back}
      <header>
        <p className={EYEBROW}>{t('employerApplicationsCandidateLabel')}</p>
        <h1 className={H1_EXTENDED}>{name}</h1>
        <p className={INTRO}>
          {t('employerApplicationsJobLabel')}:{' '}
          <span className="font-semibold text-foreground">{jobTitle}</span>
        </p>
        {isDemo ? (
          <p className={`mt-3 ${TAG}`}>{t('employerApplicationsDemo')}</p>
        ) : null}
        {application.isGuest ? (
          <div className="mt-3 space-y-2">
            <p className="inline-flex rounded-full bg-soft px-3 py-1 text-xs font-semibold text-foreground">{t('employerApplicationGuestBadge')}</p>
            <p className="text-sm text-muted-foreground">{t('employerApplicationGuestHint')}</p>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StatusPill status={application.status} />
          <ApplicationStatusMenu applicationId={application.id} status={application.status} candidateName={name} jobTitle={application.jobTitle} />
          {/* #98: rozmowa wymaga konta kandydata — gość dostaje kontakt e-mailowy niżej. */}
          {application.isGuest ? null : <MessageCandidateButton applicationId={application.id} candidateName={name} />}
          {/* P1-06: profil kandydata z kontekstem firmy (dopasowania, inne zgłoszenia). */}
          {application.isGuest || !application.candidateId || isDemo ? null : (
            <Link href={`/employer/kandydaci/${encodeURIComponent(application.candidateId)}`} className={TEXT_LINK}>
              {t('employerApplicationViewCandidate')}
            </Link>
          )}
        </div>
      </header>

      <section aria-labelledby="application-submission" className={PANEL}>
        <h2 id="application-submission" className={PANEL_H2}>{t('employerApplicationSubmission')}</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          {field(t('employerApplicationSubmittedAt'), date(application.submittedAt))}
          {field(t('employerApplicationPhone'), application.phone ? (
            <a href={`tel:${application.phone.replace(/[^\d+]/g, '')}`} className="underline-offset-4 hover:underline">{application.phone}</a>
          ) : notProvided)}
          {application.isGuest ? field(t('employerApplicationEmail'), application.guestEmail ? (
            <a href={`mailto:${application.guestEmail}`} className="underline-offset-4 hover:underline">{application.guestEmail}</a>
          ) : notProvided) : null}
          {field(t('employerApplicationAvailability'), availabilityKey ? to(availabilityKey) : notProvided)}
          {field(t('employerApplicationMatch'), application.matchScore === null ? notProvided : t('employerApplicationMatchValue', { score: application.matchScore }))}
        </dl>
        <div className="mt-6 border-t border-border pt-5">
          <h3 className={INFO_LABEL}>{t('employerApplicationMessageHeading')}</h3>
          {application.message ? (
            <p className="mt-2 whitespace-pre-line break-words text-base text-foreground">{application.message}</p>
          ) : (
            <p className={`mt-2 ${PANEL_P}`}>{t('employerApplicationNoMessage')}</p>
          )}
        </div>
      </section>

      {application.screeningAnswers.length > 0 ? (
        <section aria-labelledby="application-screening" className={PANEL}>
          <h2 id="application-screening" className={PANEL_H2}>{t('employerApplicationScreening')}</h2>
          <p className={`mt-1 ${PANEL_P}`}>{t('employerApplicationScreeningHint')}</p>
          <dl className="mt-5 grid gap-5">
            {application.screeningAnswers.map((answer) => (
              <div key={answer.position} className="min-w-0">
                <dt className={INFO_LABEL}>
                  {localizedText(answer.prompt, locale)}
                  {answer.required ? ` (${t('employerApplicationScreeningRequired')})` : ''}
                </dt>
                <dd className={INFO_VALUE}>
                  {screeningAnswerText(answer)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="application-profile" className={PANEL}>
        <h2 id="application-profile" className={PANEL_H2}>{t('employerApplicationProfile')}</h2>
        {profile ? (
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            {field(t('employerApplicationHeadline'), profile.headline || notProvided)}
            {field(t('employerApplicationCity'), profile.city || notProvided)}
            {field(t('employerApplicationExperience'), profile.experienceYears === null ? notProvided : t('employerApplicationExperienceYears', { years: profile.experienceYears }))}
            {field(t('employerApplicationDrivingLicense'), profile.hasDrivingLicense ? t('employerApplicationYes') : t('employerApplicationNo'))}
            {field(to('skillsLabel'), profile.skills.length ? profile.skills.join(', ') : notProvided)}
            {field(to('languagesLabel'), profile.languages.length
              ? profile.languages.map((l) => {
                  const levelKey = LEVEL_KEYS[l.level];
                  return levelKey ? `${l.label} (${to(levelKey)})` : l.label;
                }).join(', ')
              : notProvided)}
            {field(to('certificatesLabel'), profile.certificates.length ? profile.certificates.join(', ') : notProvided)}
          </dl>
        ) : (
          <p className={`mt-3 ${PANEL_P}`}>{t('employerApplicationNoProfile')}</p>
        )}
      </section>

      <section aria-labelledby="application-history" className={PANEL}>
        <h2 id="application-history" className={PANEL_H2}>{t('employerApplicationHistory')}</h2>
        <ApplicationHistoryList
          applicationId={application.id}
          initialItems={application.history}
          initialNextCursor={application.historyNextCursor}
        />
      </section>
    </div>
  );
}
