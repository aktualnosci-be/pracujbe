import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getEmployerCandidateDetail } from '@/lib/data/employer';
import { StatusPill } from '@/components/ui/status-pill';
import { MatchBar } from '@/components/ui/match-bar';
import { SendOfferButton } from '@/components/employer/SendOfferButton';
import { AVAILABILITY_KEYS, LEVEL_KEYS } from '@/components/employer/candidate-labels';
import {
  BTN_SECONDARY,
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
 * Szczegół kandydata w panelu pracodawcy (audyt P1-06). Odczyt pod sesją i RLS, zawężony do
 * aktywnej firmy: profil zawodowy, dopasowania do ofert firmy (z wysyłką propozycji) i
 * zgłoszenia kandydata do tych ofert. Brak relacji z firmą / brak dostępu = notFound (bez
 * ujawniania istnienia cudzych danych). NOINDEX dziedziczone z layoutu panelu.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('employerCandidateDetailTitle'), robots: { index: false, follow: false } };
}

export default async function EmployerCandidateDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const to = await getTranslations({ locale, namespace: 'onboarding' });
  const format = await getFormatter({ locale });

  const result = await getEmployerCandidateDetail(id);
  if (result.status === 'not_found') notFound();

  const back = (
    <Link href="/employer/kandydaci" className={TEXT_LINK}>
      {t('employerCandidateBack')}
    </Link>
  );

  if (result.status === 'error') {
    return (
      <div className="space-y-7">
        {back}
        <section role="alert" className={PANEL}>
          <h1 className={PANEL_H2}>{t('employerCandidateLoadError')}</h1>
          <p className={`mt-2 ${PANEL_P}`}>{t('employerApplicationsLoadErrorHint')}</p>
          <a href={`/${locale}/employer/kandydaci/${encodeURIComponent(id)}`} className={`mt-5 ${BTN_SECONDARY}`}>
            {t('employerApplicationsRetry')}
          </a>
        </section>
      </div>
    );
  }

  const { candidate, isDemo } = result;
  const name = candidate.name || t('candidateFallback');
  const profile = candidate.profile;
  const notProvided = t('employerApplicationNotProvided');
  const availabilityKey = profile ? AVAILABILITY_KEYS[profile.availability] : undefined;
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeZone: 'Europe/Brussels' }) : notProvided;

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
        {profile?.headline ? <p className={INTRO}>{profile.headline}</p> : null}
        {isDemo ? <p className={`mt-3 ${TAG}`}>{t('employerApplicationsDemo')}</p> : null}
      </header>

      <section aria-labelledby="candidate-profile" className={PANEL}>
        <h2 id="candidate-profile" className={PANEL_H2}>{t('employerApplicationProfile')}</h2>
        {profile ? (
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            {field(t('employerCandidateOccupations'), profile.occupations.length ? profile.occupations.join(', ') : notProvided)}
            {field(t('employerApplicationCity'), profile.city || notProvided)}
            {field(t('employerApplicationExperience'), profile.experienceYears === null ? notProvided : t('employerApplicationExperienceYears', { years: profile.experienceYears }))}
            {field(t('employerApplicationAvailability'), availabilityKey ? to(availabilityKey) : notProvided)}
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

      <section aria-labelledby="candidate-matches" className={PANEL}>
        <h2 id="candidate-matches" className={PANEL_H2}>{t('employerCandidateMatches')}</h2>
        {candidate.matches.length ? (
          <ul className="mt-4 space-y-4">
            {candidate.matches.map((match) => (
              <li key={match.jobId} className="flex min-w-0 flex-col gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-foreground">{match.jobTitle || t('applicationUnknownJob')}</p>
                  <div className="mt-2"><MatchBar value={match.score} showLabel /></div>
                </div>
                {match.canOffer ? (
                  <SendOfferButton
                    jobId={match.jobId}
                    candidateId={candidate.candidateId}
                    candidateName={name}
                    jobTitle={match.jobTitle}
                    jobSlug={match.jobSlug}
                    offerSentAt={match.offerSentAt}
                    className="min-h-11 w-full sm:w-auto sm:self-start"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-3 ${PANEL_P}`}>{t('employerCandidateNoMatches')}</p>
        )}
      </section>

      <section aria-labelledby="candidate-applications" className={PANEL}>
        <h2 id="candidate-applications" className={PANEL_H2}>{t('employerCandidateApplications')}</h2>
        {candidate.applications.length ? (
          <ul className="mt-4 space-y-3">
            {candidate.applications.map((application) => {
              const jobTitle = application.jobTitle || t('applicationUnknownJob');
              return (
                <li key={application.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-foreground">{jobTitle}</p>
                    <p className="text-xs text-muted-foreground">{t('employerApplicationSubmittedAt')}: {date(application.submittedAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusPill status={application.status} />
                    <Link
                      href={`/employer/aplikacje/${encodeURIComponent(application.id)}`}
                      aria-label={t('employerApplicationViewLabel', { name, job: jobTitle })}
                      className={TEXT_LINK}
                    >
                      {t('employerApplicationView')}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={`mt-3 ${PANEL_P}`}>{t('employerCandidateNoApplications')}</p>
        )}
      </section>
    </div>
  );
}
