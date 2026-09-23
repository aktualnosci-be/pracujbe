import type { Metadata } from 'next';
import {
  ArrowRight,
  Briefcase,
  ClipboardList,
  MessageSquare,
  Plus,
  Star,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { isSupabaseConfigured } from '@/lib/env';
import {
  getCompanyJobsLoad,
  getEmployerOverview,
  getEmployerShellData,
  getFunnelStats,
  getRecentApplications,
  getTopMatchedCandidates,
  DEMO_OVERVIEW_DELTAS,
} from '@/lib/data/employer';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { StatusPill } from '@/components/ui/status-pill';
import { RecruitmentFunnel } from '@/components/employer/RecruitmentFunnel';
import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';
import { SendOfferButton } from '@/components/employer/SendOfferButton';
import { RecentApplicationsError } from '@/components/employer/RecentApplicationsError';
import { EmployerStatsError } from '@/components/employer/EmployerStatsError';
import { EmployerOffersPreview } from '@/components/employer/EmployerOffersPreview';

/**
 * Panel pracodawcy — Podsumowanie (makieta 05), na REALNYCH danych.
 *
 * Dane ładowane przez `@/lib/data/employer` pod sesją użytkownika (RLS); bez env — te same
 * struktury z danymi DEMO (build/preview bez konfiguracji). Układ zgodny z makietą: rząd
 * kafelków statystyk (StatCard), karty ofert firmy, sekcja najnowszych aplikacji (menu zmiany
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

/** Konwersja między etapami lejka (%), zaokrąglona do 1 miejsca. */
function conversionPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
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

  const configured = isSupabaseConfigured();
  const [overview, jobsLoad, recentApplications, candidates, funnel, shell] = await Promise.all([
    getEmployerOverview(),
    getCompanyJobsLoad(),
    getRecentApplications(),
    getTopMatchedCandidates(),
    getFunnelStats(),
    getEmployerShellData(),
  ]);
  // P1-09: realne imię pracodawcy w powitaniu (bez zmyślonego „Jan"). Brak → wariant bez imienia.
  const firstName = shell?.userName?.trim().split(/\s+/)[0] ?? '';
  const conversions: [number, number, number] =
    funnel.status === 'ok'
      ? [
          conversionPct(funnel.funnel.applications, funnel.funnel.views),
          conversionPct(funnel.funnel.interviews, funnel.funnel.applications),
          conversionPct(funnel.funnel.hired, funnel.funnel.interviews),
        ]
      : [0, 0, 0];

  return (
    <div className="space-y-6">
      {/* Nagłówek + CTA */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {td('greetingEmployer')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {firstName
              ? td('employerGreetingSub', { name: firstName })
              : td('employerGreetingSubGeneric')}
          </p>
        </div>
        {/* Kreator oferty (Etap 5) — 9 kroków z autozapisem szkicu. */}
        <Button asChild className="shrink-0 gap-2 self-start sm:self-auto">
          <Link href="/employer/oferty/nowa">
            <Plus className="size-4" aria-hidden="true" />
            {td('addJob')}
          </Link>
        </Button>
      </div>

      {/* Statystyki */}
      {overview.status === 'error' ? (
        <EmployerStatsError message={td('employerOverviewLoadError')} retryLabel={tc('retry')} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={td('activeOffers')}
            value={overview.overview.activeOffersCount}
            sub={configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.activeOffers })}
            icon={<Briefcase />}
            tone="primary"
          />
          <StatCard
            label={td('newApplications')}
            value={overview.overview.newApplicationsCount}
            sub={
              configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.newApplications })
            }
            icon={<ClipboardList />}
            tone="success"
          />
          <StatCard
            label={td('matchedCandidates')}
            value={overview.overview.matchedCandidatesCount}
            sub={configured ? undefined : td('sinceLastWeek', { count: DEMO_OVERVIEW_DELTAS.matched })}
            icon={<Star />}
            tone="warning"
          />
          <StatCard
            label={td('messagesToAnswer')}
            value={overview.overview.messagesToAnswerCount}
            sub={configured ? undefined : td('urgent', { count: DEMO_OVERVIEW_DELTAS.urgent })}
            icon={<MessageSquare />}
            tone="error"
          />
        </div>
      )}

      {/* Główna siatka: lewa (2/3) + prawa (1/3) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* Twoje aktywne oferty */}
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
            }}
          />

          {/* Najnowsze aplikacje — zmiana statusu (transitionApplication) */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
              <h2 className="text-base font-semibold text-foreground">{td('recentApplications')}</h2>
              <Link
                href="/employer/aplikacje"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                {td('seeAll')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            {recentApplications.status === 'error' ? (
              <RecentApplicationsError message={td('recentApplicationsError')} retryLabel={tc('retry')} />
            ) : recentApplications.applications.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{td('emptyState')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentApplications.applications.map((application) => (
                  <li
                    key={application.id}
                    className="flex flex-wrap items-center gap-3 p-4 sm:px-5"
                  >
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                      aria-hidden="true"
                    >
                      {initials(application.candidateName || td('candidateFallback'))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {application.candidateName || td('candidateFallback')}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">{application.jobTitle}</p>
                    </div>
                    <StatusPill status={application.status} />
                    <Link
                      href={`/employer/aplikacje/${encodeURIComponent(application.id)}`}
                      aria-label={td('employerApplicationViewLabel', {
                        name: application.candidateName || td('candidateFallback'),
                        job: application.jobTitle || td('applicationUnknownJob'),
                      })}
                      className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {td('employerApplicationView')}
                    </Link>
                    <ApplicationStatusMenu
                      applicationId={application.id}
                      status={application.status}
                      candidateName={application.candidateName || td('candidateFallback')}
                      jobTitle={application.jobTitle}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Lejek rekrutacyjny */}
          {funnel.status === 'error' ? (
            <EmployerStatsError
              title={td('funnelTitle')}
              message={td('employerFunnelLoadError')}
              retryLabel={tc('retry')}
            />
          ) : (
            <RecruitmentFunnel
              views={funnel.funnel.views}
              applications={funnel.funnel.applications}
              interviews={funnel.funnel.interviews}
              hired={funnel.funnel.hired}
              conversions={conversions}
            />
          )}
        </div>

        {/* Kolumna boczna */}
        <div className="space-y-6">
          {/* Top dopasowani kandydaci — wysyłka propozycji (sendOffer) */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
              <h2 className="text-base font-semibold text-foreground">{td('topMatched')}</h2>
              <Link
                href="/employer/kandydaci"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                {td('seeAllCandidates')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            {candidates.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{td('emptyState')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {candidates.map((candidate) => (
                  <li key={candidate.candidateId} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                      aria-hidden="true"
                    >
                      {initials(candidate.name || td('candidateFallback'))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {candidate.name || td('candidateFallback')}
                      </p>
                      {candidate.role ? (
                        <p className="truncate text-sm text-muted-foreground">{candidate.role}</p>
                      ) : null}
                      {candidate.city ? (
                        <p className="truncate text-xs text-muted-foreground">{candidate.city}</p>
                      ) : null}
                      {candidate.jobTitle ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {td('offerForJob', { job: candidate.jobTitle })}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-success-text">
                      {candidate.match}%
                    </span>
                    <SendOfferButton
                      jobId={candidate.jobId}
                      candidateId={candidate.candidateId}
                      candidateName={candidate.name || td('candidateFallback')}
                      jobTitle={candidate.jobTitle}
                      jobSlug={candidate.jobSlug}
                      offerSentAt={candidate.offerSentAt}
                      className="w-full sm:w-auto"
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border p-3">
              <Button asChild variant="outline" className="w-full">
                <Link href="/employer/kandydaci">{td('goToCandidates')}</Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
