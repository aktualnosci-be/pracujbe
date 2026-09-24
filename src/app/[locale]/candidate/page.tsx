import type { Metadata } from 'next';
import { ArrowRight, MapPin } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { PanelStats } from '@/components/dashboard/PanelStats';
import {
  BTN_PRIMARY,
  EMPTY,
  EYEBROW,
  H1,
  ICON_BOX,
  INTRO,
  PANEL,
  PANEL_H2,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { DASH_GRID, DASH_GRID_MAIN, DASH_GRID_SIDE } from '@/components/candidate/candidate-styles';
import { cn } from '@/lib/utils';
import { MatchBar } from '@/components/ui/match-bar';
import { NewProposalBanner } from '@/components/candidate/NewProposalBanner';
import { ProfileCompleteness } from '@/components/candidate/ProfileCompleteness';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';
import { ProfileSummaryError } from '@/components/candidate/ProfileSummaryError';
import { CvUpload } from '@/components/candidate/CvUpload';
import { SaveJobButton } from '@/components/candidate/SaveJobButton';
import { CandidateApplicationsPreview } from '@/components/candidate/CandidateApplicationsPreview';
import { CandidateMessagesPreview } from '@/components/candidate/CandidateMessagesPreview';
import { CandidateSectionError } from '@/components/candidate/CandidateSectionError';
import { getProfileLevelTitle } from '@/lib/profile-completeness';
import { proposalAnchorHref } from '@/lib/candidate-offers';
import {
  getCandidateOverview,
  getCandidateProfileSummary,
  getLatestMessages,
  getMyApplicationsPreview,
  getLatestActiveOffer,
  getRecommendedJobs,
} from '@/lib/data/candidate';
import { loadCandidateFiles } from '@/lib/data/candidate-files';
import { profileChecklistItems } from '@/components/candidate/profile-checklist-items';

/**
 * Panel kandydata — Podsumowanie. Wygląd: kalka `#people/candidate` z prototypu „04 Ludzie
 * i praca” (klasy z `panel-styles.ts` i `candidate-styles.ts`).
 *
 * Dane realne z bazy pod sesją użytkownika (RLS) przez `@/lib/data/candidate`; bez env te same
 * struktury z danymi DEMO. NOINDEX (dziedziczone z layoutu panelu). Akcje (zapis oferty, wycofanie
 * aplikacji) w wydzielonych fragmentach klienckich; reszta renderowana serwerowo.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navSummary'),
    robots: { index: false, follow: false },
  };
}

/** Inicjały firmy (placeholder logo). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export default async function CandidateDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tj = await getTranslations({ locale, namespace: 'jobs' });
  const tp = await getTranslations({ locale, namespace: 'candidatePassport' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  const to = await getTranslations({ locale, namespace: 'onboarding' });
  const tm = await getTranslations({ locale, namespace: 'messages' });

  const [overview, profile, recommended, applications, messages, files, newProposal] = await Promise.all([
    getCandidateOverview(),
    getCandidateProfileSummary(),
    getRecommendedJobs(locale),
    getMyApplicationsPreview(locale),
    getLatestMessages(),
    loadCandidateFiles(),
    getLatestActiveOffer(locale),
  ]);

  const overviewFailed =
    overview.newJobsCount === null ||
    overview.activeApplicationsCount === null ||
    overview.unreadMessagesCount === null;

  const checklist = profileChecklistItems(profile.checklist, td('add'), to);

  return (
    <div className="min-w-0">
      {/* Powitanie — `candidate()` z prototypu: `.eyebrow`, `.dash-content h1`, `.dash-intro`. */}
      <header className="min-w-0">
        <p className={EYEBROW}>{td('candidateEyebrow')}</p>
        <h1 className={H1}>
          {profile.firstName ? td('greeting', { name: profile.firstName }) : td('greetingNoName')}
        </h1>
        <p className={cn(INTRO, 'mb-[25px] mt-2')}>{td('candidateIntro')}</p>
      </header>

      {/* Baner wyłącznie dla rzeczywistej propozycji oczekującej na odpowiedź (`.notice`). */}
      {newProposal ? (
        <NewProposalBanner
          status={newProposal.status}
          href={proposalAnchorHref(newProposal.id)}
        />
      ) : null}

      {/* Statystyki (`.stats`) — licznik bez udanego odczytu pokazuje „—", nigdy fałszywe zero (#244). */}
      {overviewFailed ? (
        <div className={cn(PANEL, 'mt-[22px]')}>
          <CandidateSectionError message={td('candidateOverviewLoadError')} retry={td('candidateListRetry')} />
        </div>
      ) : null}
      <PanelStats
        items={[
          {
            label: td('newJobs'),
            value: overview.newJobsCount ?? '—',
            sub: overview.newJobsCount === null ? td('candidateStatLoadError') : td('newJobsSub'),
          },
          {
            label: td('activeApplications'),
            value: overview.activeApplicationsCount ?? '—',
            sub:
              overview.activeApplicationsCount === null
                ? td('candidateStatLoadError')
                : td('activeApplicationsSub'),
          },
          {
            label: td('unreadMessages'),
            value: overview.unreadMessagesCount ?? '—',
            sub:
              overview.unreadMessagesCount === null
                ? td('candidateStatLoadError')
                : td('unreadMessagesSub'),
          },
          profile.loadFailed
            ? { label: td('profileCompleteness'), value: '—', sub: tp('loadError') }
            : { label: td('profileCompleteness'), value: `${profile.completionPct}%` },
        ]}
      />

      {/* `.people .dash-grid` — 1.4fr / 1fr, odstęp 19 px. */}
      <div className={DASH_GRID}>
        <div className={DASH_GRID_MAIN}>
          {/* Polecane oferty pracy — `.panel` z wierszami `.job` */}
          <section className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 className={PANEL_H2}>{td('recommendedJobs')}</h2>
              <Link href="/candidate/oferty-polecane" className={TEXT_LINK}>
                {td('seeAll')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            {recommended.length === 0 ? (
              <p className={EMPTY}>{tj('empty')}</p>
            ) : (
              <ul className="min-w-0">
                {recommended.map((job) => (
                  <li key={job.id} className={ROW}>
                    <span className={ICON_BOX} aria-hidden="true">
                      {initials(job.companyName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          {job.slug ? (
                            <h3 className={ROW_TITLE}>
                              <Link
                                href={`/oferty-pracy/${job.slug}`}
                                className="break-words hover:text-primary hover:underline"
                              >
                                {job.title}
                              </Link>
                            </h3>
                          ) : (
                            <h3 className={ROW_TITLE}>{job.title}</h3>
                          )}
                          <p className={ROW_META}>
                            {job.companyName}
                            <span aria-hidden="true"> · </span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="size-3 shrink-0" aria-hidden="true" />
                              {job.city}
                            </span>
                          </p>
                        </div>
                        <SaveJobButton jobId={job.id} initialSaved={job.saved} className="-mt-1" />
                      </div>
                      {job.match !== null ? (
                        <span className="mt-2.5 flex min-w-[7rem] max-w-[14rem] items-center gap-2">
                          <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-success-text">
                            {job.match}%
                          </span>
                          <MatchBar value={job.match} className="flex-1" />
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Moje ostatnie aplikacje */}
          <CandidateApplicationsPreview
            result={applications}
            locale={locale}
            labels={{
              title: td('myApplications'),
              seeAll: td('seeAll'),
              empty: td('noApplications'),
              loadError: td('candidateApplicationsLoadError'),
              retry: td('candidateListRetry'),
            }}
          />
        </div>

        {/* Kolumna boczna */}
        <div className={DASH_GRID_SIDE}>
          {/* Kompletność profilu — `.panel`: h2, opis, `.progress`, `.checklist`, `.btn`. */}
          {profile.loadFailed ? <ProfileSummaryError message={tp('loadError')} retry={tc('retry')} /> : <section className={PANEL}>
            <h2 className={PANEL_H2}>{td('profileCompleteness')}</h2>
            <ProfileCompleteness
              className="mt-2"
              value={profile.completionPct}
              title={getProfileLevelTitle(profile.completionPct, td('goodLevel'))}
              hint={td('completenessHint')}
            />
            <ProfileChecklist items={checklist} />
            <Link href="/candidate/profil" className={cn(BTN_PRIMARY, 'w-full')}>
              {td('completeProfile')}
            </Link>
          </section>}

          {/* Dokumenty / CV (prywatny bucket + signed URLs) */}
          <CvUpload
            items={files.status === 'ready' ? files.items : []}
            loadFailed={files.status === 'error'}
          />

          {/* Najnowsze wiadomości */}
          <CandidateMessagesPreview
            result={messages}
            locale={locale}
            labels={{
              title: td('latestMessages'),
              empty: td('noMessages'),
              loadError: td('candidateMessagesLoadError'),
              retry: td('candidateListRetry'),
              seeAll: td('seeAllMessages'),
              unread: tm('unreadBadge'),
            }}
          />
        </div>
      </div>
    </div>
  );
}
