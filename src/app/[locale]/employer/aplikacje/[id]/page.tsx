import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getEmployerApplicationDetail } from '@/lib/data/employer';
import { StatusPill, toCamel } from '@/components/ui/status-pill';
import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';
import { MessageCandidateButton } from '@/components/employer/MessageCandidateButton';
import { localizedText, type ScreeningAnswer } from '@/lib/screening/questions';

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

const AVAILABILITY_KEYS: Record<string, string> = {
  immediate: 'availImmediate',
  within_two_weeks: 'availWithinTwoWeeks',
  within_month: 'availWithinMonth',
  within_three_months: 'availWithinThreeMonths',
  flexible: 'availFlexible',
};

const LEVEL_KEYS: Record<string, string> = {
  basic: 'levelBasic',
  intermediate: 'levelIntermediate',
  fluent: 'levelFluent',
  native: 'levelNative',
};

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
  const ts = await getTranslations({ locale, namespace: 'status' });
  const format = await getFormatter({ locale });

  const result = await getEmployerApplicationDetail(id);
  if (result.status === 'not_found') notFound();

  const back = (
    <Link href="/employer/aplikacje" className="text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      {t('employerApplicationBack')}
    </Link>
  );

  if (result.status === 'error') {
    return (
      <div className="space-y-7">
        {back}
        <section role="alert" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-foreground">{t('employerApplicationLoadError')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('employerApplicationsLoadErrorHint')}</p>
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
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold text-foreground">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-7">
      {back}
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t('employerApplicationsCandidateLabel')}</p>
        <h1 className="break-words text-3xl font-bold tracking-tight text-foreground">{name}</h1>
        <p className="mt-2 break-words text-sm text-muted-foreground">
          {t('employerApplicationsJobLabel')}:{' '}
          <span className="font-semibold text-foreground">{jobTitle}</span>
        </p>
        {isDemo ? (
          <p className="mt-3 inline-flex rounded-full bg-soft px-3 py-1 text-xs font-semibold text-muted-foreground">{t('employerApplicationsDemo')}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StatusPill status={application.status} />
          <ApplicationStatusMenu applicationId={application.id} status={application.status} candidateName={name} jobTitle={application.jobTitle} />
          <MessageCandidateButton applicationId={application.id} candidateName={name} />
        </div>
      </header>

      <section aria-labelledby="application-submission" className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <h2 id="application-submission" className="text-xl font-bold text-foreground">{t('employerApplicationSubmission')}</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          {field(t('employerApplicationSubmittedAt'), date(application.submittedAt))}
          {field(t('employerApplicationPhone'), application.phone ? (
            <a href={`tel:${application.phone.replace(/[^\d+]/g, '')}`} className="underline-offset-4 hover:underline">{application.phone}</a>
          ) : notProvided)}
          {field(t('employerApplicationAvailability'), availabilityKey ? to(availabilityKey) : notProvided)}
          {field(t('employerApplicationMatch'), application.matchScore === null ? notProvided : t('employerApplicationMatchValue', { score: application.matchScore }))}
        </dl>
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('employerApplicationMessageHeading')}</h3>
          {application.message ? (
            <p className="mt-2 whitespace-pre-line break-words text-base text-foreground">{application.message}</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('employerApplicationNoMessage')}</p>
          )}
        </div>
      </section>

      {application.screeningAnswers.length > 0 ? (
        <section aria-labelledby="application-screening" className="rounded-3xl border border-border bg-card p-5 sm:p-6">
          <h2 id="application-screening" className="text-xl font-bold text-foreground">{t('employerApplicationScreening')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('employerApplicationScreeningHint')}</p>
          <dl className="mt-5 grid gap-5">
            {application.screeningAnswers.map((answer) => (
              <div key={answer.position} className="min-w-0">
                <dt className="break-words text-sm font-medium text-muted-foreground">
                  {localizedText(answer.prompt, locale)}
                  {answer.required ? ` (${t('employerApplicationScreeningRequired')})` : ''}
                </dt>
                <dd className="mt-1 break-words text-base font-semibold text-foreground">
                  {screeningAnswerText(answer)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="application-profile" className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <h2 id="application-profile" className="text-xl font-bold text-foreground">{t('employerApplicationProfile')}</h2>
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
          <p className="mt-3 text-sm text-muted-foreground">{t('employerApplicationNoProfile')}</p>
        )}
      </section>

      <section aria-labelledby="application-history" className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <h2 id="application-history" className="text-xl font-bold text-foreground">{t('employerApplicationHistory')}</h2>
        {application.history.length ? (
          <ol className="mt-4 space-y-3">
            {application.history.map((entry, index) => (
              <li key={`${entry.toStatus}-${entry.at}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
                <span className="font-semibold text-foreground">{ts(toCamel(entry.toStatus))}</span>
                <time dateTime={entry.at} className="text-sm text-muted-foreground">{date(entry.at)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t('employerApplicationNoHistory')}</p>
        )}
      </section>
    </div>
  );
}
