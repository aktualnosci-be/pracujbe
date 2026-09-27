import type { Metadata } from 'next';
import { ArrowRight, Plus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { isPortalDataConfigured } from '@/lib/db/portal';
import {
  getCompanyJobsLoad,
  getEmployerOverview,
  getEmployerShellData,
  getFunnelStats,
  getRecentApplications,
  getTopMatchedCandidatesLoad,
} from '@/lib/data/employer';
import { RecruiterOnlyNote } from '@/components/employer/RecruiterOnlyNote';
import { canRecruit } from '@/lib/team/permissions';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';
import { SendOfferButton } from '@/components/employer/SendOfferButton';
import { RecentApplicationsError } from '@/components/employer/RecentApplicationsError';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import { EmployerOffersPreview } from '@/components/employer/EmployerOffersPreview';
import { EmployerOverviewStats } from '@/components/employer/EmployerOverviewStats';
import { EmployerFunnelSection } from '@/components/employer/EmployerFunnelSection';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
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
  STATUS_GOOD,
  TAG,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Panel pracodawcy — Podsumowanie (makieta 05), na REALNYCH danych.
 *
 * Wygląd: kalka panelu z prototypu „04 Ludzie i praca” (`#people/employer`, klasy z
 * `panel-styles.ts`). Dane ładowane przez `@/lib/data/employer` pod sesją użytkownika (RLS); bez env — te same
 * struktury z danymi DEMO (build/preview bez konfiguracji). Układ zgodny z makietą: rząd
 * kafelków statystyk (`.stats`), karty ofert firmy, sekcja najnowszych aplikacji (menu zmiany
 * statusu → `transitionApplication`), lejek rekrutacyjny, top dopasowani kandydaci (wysyłka
 * propozycji → `sendOffer`). NOINDEX (panel, dziedziczone z layoutu).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('greetingEmployer'),
    robots: { index: false, follow: false },
  };
}

/** Inicjały (placeholder avatara / logo). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export default async function EmployerDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  const configured = isPortalDataConfigured();
  const [overview, jobsLoad, recentApplications, topMatched, funnel, shell] = await Promise.all([
    getEmployerOverview(),
    getCompanyJobsLoad(),
    getRecentApplications(),
    getTopMatchedCandidatesLoad(),
    getFunnelStats(),
    getEmployerShellData(),
  ]);
  // P1-09: realne imię pracodawcy w powitaniu (bez zmyślonego „Jan"). Brak → wariant bez imienia.
  const firstName = shell.status === 'ok' ? (shell.userName.trim().split(/\s+/)[0] ?? '') : '';
  // #403: akcje rekrutacyjne tylko dla recruiter+ (demo/błąd chrome → jak dotąd, baza i tak odmówi).
  const canAddJobs = shell.status !== 'ok' || canRecruit(shell.activeRole);

  return (
    <div className="min-w-0">
      {/* Nagłówek + CTA (`.section-head` z `.eyebrow`, `.dash-content h1`, `.dash-intro`) */}
      <div className={SECTION_HEAD}>
        <div className="min-w-0">
          {shell.status === 'ok' && shell.activeName ? (
            <p className={EYEBROW}>{shell.activeName}</p>
          ) : null}
          <h1 className={H1}>{td('greetingEmployer')}</h1>
          <p className={INTRO}>
            {firstName
              ? td('employerGreetingSub', { name: firstName })
              : td('employerGreetingSubGeneric')}
          </p>
        </div>
        {/* Kreator oferty (Etap 5) — 9 kroków z autozapisem szkicu. Rola member → wyjaśnienie (#403). */}
        {canAddJobs ? (
          <Link href="/employer/oferty/nowa" className={BTN_PRIMARY}>
            <Plus className="size-4 shrink-0" aria-hidden="true" />
            {td('addJob')}
          </Link>
        ) : (
          <RecruiterOnlyNote locale={locale} />
        )}
      </div>

      {/* #399: status weryfikacji firmy od pierwszego wejścia (verified → brak baneru). */}
      {shell.status === 'ok' ? (
        <CompanyStatusBanner status={shell.activeStatus} variant="dashboard" />
      ) : null}

      {/* Statystyki (`.stats` / `.stat`) — liczniki rekrutacyjne tylko recruiter+ (P1-14) */}
      <EmployerOverviewStats
        locale={locale}
        overview={overview}
        demo={!configured}
        className={overview.status === 'error' ? 'mb-7 mt-[22px]' : undefined}
      />

      {/* Twoje aktywne oferty (`.panel`) */}
      <EmployerOffersPreview
        result={jobsLoad}
        locale={locale}
        labels={{
          title: td('yourActiveOffers'),
          seeAll: td('seeAllOffers'),
          empty: td('emptyState'),
          loadError: td('employerOffersLoadError'),
          loadErrorHint: td('employerOffersLoadErrorHint'),
          retry: td('employerOffersRetry'),
          newApplications: td('employerOffersApplicationsLabel'),
          matched: td('colMatched'),
          noData: td('funnelNoData'),
        }}
      />

      {/* `.dash-grid` — 1.4fr / 1fr, odstęp 19 px, margines 24 px; ≤ 1050 px jedna kolumna.
          Bazy w rem zamiast stałych kolumn: przy 200% tekstu (#318) kolumna boczna przechodzi
          pod główną zamiast wystawać poza ekran. */}
      <div className="mt-6 flex min-w-0 flex-wrap gap-[19px]">
        <div className="flex min-w-0 flex-[1.4_1_36rem] flex-col gap-[19px]">
          {/* Najnowsze aplikacje — zmiana statusu (transitionApplication); wiersze `.job` */}
          <section className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 className={PANEL_H2}>{td('recentApplications')}</h2>
              <Link href="/employer/aplikacje" className={TEXT_LINK}>
                {td('seeAll')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            {recentApplications.status === 'error' ? (
              <RecentApplicationsError message={td('recentApplicationsError')} retryLabel={tc('retry')} />
            ) : recentApplications.applications.length === 0 ? (
              <p className={EMPTY}>{td('emptyState')}</p>
            ) : (
              <ul>
                {recentApplications.applications.map((application) => (
                  <li key={application.id} className={cn(ROW, 'flex-wrap items-center')}>
                    <span className={ICON_BOX} aria-hidden="true">
                      {initials(application.candidateName || td('candidateFallback'))}
                    </span>
                    <div className="min-w-0 flex-1 basis-40">
                      <p className={ROW_TITLE}>
                        {application.candidateName || td('candidateFallback')}
                      </p>
                      <p className={ROW_META}>{application.jobTitle}</p>
                      {application.isGuest ? (
                        <p className={cn(TAG, 'mt-1.5 font-semibold text-foreground')}>
                          {td('employerApplicationGuestBadge')}
                        </p>
                      ) : null}
                      <div className="mt-1.5">
                        <StatusPill status={application.status} />
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link
                        href={`/employer/aplikacje/${encodeURIComponent(application.id)}`}
                        aria-label={td('employerApplicationViewLabel', {
                          name: application.candidateName || td('candidateFallback'),
                          job: application.jobTitle || td('applicationUnknownJob'),
                        })}
                        className={cn(BTN_SMALL, 'border-border text-foreground hover:bg-soft')}
                      >
                        {td('employerApplicationView')}
                      </Link>
                      <ApplicationStatusMenu
                        applicationId={application.id}
                        status={application.status}
                        candidateName={application.candidateName || td('candidateFallback')}
                        jobTitle={application.jobTitle}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Lejek rekrutacyjny („Rekrutacja w liczbach”) */}
          <EmployerFunnelSection locale={locale} funnel={funnel} />
        </div>

        {/* Kolumna boczna */}
        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-[19px]">
          {/* Top dopasowani kandydaci — wysyłka propozycji (sendOffer) */}
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
        </div>
      </div>
    </div>
  );
}
