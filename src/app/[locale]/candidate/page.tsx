import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { PanelStats } from '@/components/dashboard/PanelStats';
import {
  BTN_PRIMARY,
  EYEBROW,
  H1,
  INTRO,
  PANEL,
  PANEL_H2,
} from '@/components/dashboard/panel-styles';
import { DASH_GRID, DASH_GRID_MAIN, DASH_GRID_SIDE } from '@/components/candidate/candidate-styles';
import { cn } from '@/lib/utils';
import { CandidateRecommendedPreview } from '@/components/candidate/CandidateRecommendedPreview';
import { CandidateSavedSearchJobs } from '@/components/candidate/CandidateSavedSearchJobs';
import { isRecruitmentEnabled } from '@/lib/portal-mode';
import { NewProposalBanner } from '@/components/candidate/NewProposalBanner';
import { ProfileCompleteness } from '@/components/candidate/ProfileCompleteness';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';
import { ProfileSummaryError } from '@/components/candidate/ProfileSummaryError';
import { CvUpload } from '@/components/candidate/CvUpload';
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
import { loadSavedSearchJobs } from '@/lib/data/candidate-saved-search-jobs';
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

export default async function CandidateDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tp = await getTranslations({ locale, namespace: 'candidatePassport' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  const to = await getTranslations({ locale, namespace: 'onboarding' });
  const tm = await getTranslations({ locale, namespace: 'messages' });

  // #1141/#1144 — decyzja produktowa: portal ogłoszeniowy. Bez trybu RECRUITMENT pulpit nie
  // czyta zgłoszeń ani propozycji (loadery niewołane) i nie pokazuje ich sekcji.
  const recruitment = isRecruitmentEnabled();
  const matching = isRecruitmentEnabled('matching');
  const [overview, profile, recommended, savedSearchJobs, applications, messages, files, newProposal] = await Promise.all([
    getCandidateOverview(),
    getCandidateProfileSummary(),
    // #1139: tryb ogłoszeniowy — bez rekomendacji (loader niewywoływany).
    matching ? getRecommendedJobs(locale) : Promise.resolve(null),
    // Tryb ogłoszeniowy: w miejscu polecanych najnowsze oferty z zapisanych wyszukiwań kandydata
    // (filtry użytkownika, bez dopasowania); w trybie RECRUITMENT loader niewywoływany.
    matching ? Promise.resolve(null) : loadSavedSearchJobs(),
    recruitment ? getMyApplicationsPreview(locale) : null,
    getLatestMessages(),
    loadCandidateFiles(),
    recruitment ? getLatestActiveOffer(locale) : null,
  ]);

  const overviewFailed =
    overview.newJobsCount === null ||
    (recruitment && overview.activeApplicationsCount === null) ||
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
        <p className={cn(INTRO, 'mb-[25px] mt-2')}>
          {td(recruitment ? 'candidateIntro' : 'candidateIntroListing')}
        </p>
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
            sub:
              overview.newJobsCount === null
                ? td('candidateStatLoadError')
                : td(matching ? 'newJobsSub' : 'newJobsSubListing'),
          },
          ...(recruitment
            ? [
                {
                  label: td('activeApplications'),
                  value: overview.activeApplicationsCount ?? '—',
                  sub:
                    overview.activeApplicationsCount === null
                      ? td('candidateStatLoadError')
                      : td('activeApplicationsSub'),
                },
              ]
            : []),
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
          {/* Polecane oferty pracy — `.panel` z wierszami `.job`. #1139: w trybie ogłoszeniowym
              portal nie wybiera ofert na podstawie profilu — w tym miejscu oferty z zapisanych
              wyszukiwań kandydata (jego własne filtry, bez wyniku). */}
          <CandidateRecommendedPreview locale={locale} recommended={recommended} />
          <CandidateSavedSearchJobs locale={locale} result={savedSearchJobs} />

          {/* Moje ostatnie aplikacje (tylko tryb RECRUITMENT, #1144) */}
          {applications ? (
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
          ) : null}
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
