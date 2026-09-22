import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { StatusPill } from '@/components/ui/status-pill';
import { MatchBar } from '@/components/ui/match-bar';
import { NewProposalBanner } from '@/components/candidate/NewProposalBanner';
import { ProfileCompleteness } from '@/components/candidate/ProfileCompleteness';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';
import { CvUpload } from '@/components/candidate/CvUpload';
import { SaveJobButton } from '@/components/candidate/SaveJobButton';
import { ApplicationActions } from '@/components/candidate/ApplicationActions';
import {
  getCandidateOverview,
  getCandidateProfileSummary,
  getCandidateFiles,
  getLatestMessages,
  getMyApplications,
  getLatestActiveOffer,
  getRecommendedJobs,
} from '@/lib/data/candidate';

/**
 * Panel kandydata — Podsumowanie (makieta 04).
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

/** Formatuje datę ISO do krótkiej postaci wg locale (bez rzucania na złej wartości). */
function formatDate(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(ts);
}

/** Formatuje czas ostatniej wiadomości do krótkiej postaci wg locale. */
function formatShort(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(ts);
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

  const [overview, profile, recommended, applications, messages, files, newProposal] = await Promise.all([
    getCandidateOverview(),
    getCandidateProfileSummary(),
    getRecommendedJobs(locale),
    getMyApplications(locale),
    getLatestMessages(),
    getCandidateFiles(),
    getLatestActiveOffer(locale),
  ]);

  const checklist = [
    { label: td('checkBasicInfo'), done: profile.checklist.basicInfo, action: td('add') },
    { label: td('checkExperience'), done: profile.checklist.experience, action: td('add') },
    { label: td('checkEducation'), done: profile.checklist.education, action: td('add') },
    { label: td('checkSkills'), done: profile.checklist.skills, action: td('add') },
    { label: td('checkLanguages'), done: profile.checklist.languages, action: td('add') },
    { label: td('checkPhoto'), done: profile.checklist.photo, action: td('add') },
  ];

  return (
    <div className="space-y-6">
      {/* Powitanie */}
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {td('greeting', { name: profile.firstName ?? '' })} <span aria-hidden="true">👋</span>
      </h1>

      {/* Baner wyłącznie dla rzeczywistej propozycji oczekującej na odpowiedź. */}
      {newProposal ? (
        <NewProposalBanner
          status={newProposal.status}
          href={
            newProposal.slug
              ? `/oferty-pracy/${newProposal.slug}`
              : '/candidate/propozycje'
          }
        />
      ) : null}

      {/* Statystyki */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={td('newJobs')} value={overview.newJobsCount} sub={td('newJobsSub')} />
        <StatCard
          label={td('activeApplications')}
          value={overview.activeApplicationsCount}
          sub={td('activeApplicationsSub')}
        />
        <StatCard
          label={td('unreadMessages')}
          value={overview.unreadMessagesCount}
          sub={td('unreadMessagesSub')}
          tone="error"
        />
        <StatCard
          label={td('profileCompleteness')}
          value={`${overview.profileCompletionPct}%`}
          tone="accent"
          progress={overview.profileCompletionPct}
        />
      </div>

      {/* Główna siatka: lewa (2/3) + prawa (1/3) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* Polecane oferty pracy */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
              <h2 className="text-base font-semibold text-foreground">{td('recommendedJobs')}</h2>
              <Link
                href="/candidate/oferty-polecane"
                className="shrink-0 text-sm font-medium text-accent hover:underline"
              >
                {td('seeAll')}
              </Link>
            </div>
            {recommended.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground sm:px-5">{tj('empty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {recommended.map((job) => (
                  <li key={job.id} className="flex items-start gap-3 p-4 sm:px-5">
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                      aria-hidden="true"
                    >
                      {initials(job.companyName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {job.slug ? (
                            <Link
                              href={`/oferty-pracy/${job.slug}`}
                              className="block max-w-full truncate text-sm font-semibold text-foreground hover:text-accent hover:underline"
                            >
                              {job.title}
                            </Link>
                          ) : (
                            <p className="truncate text-sm font-semibold text-foreground">{job.title}</p>
                          )}
                          <p className="truncate text-sm text-muted-foreground">{job.companyName}</p>
                        </div>
                        <SaveJobButton jobId={job.id} initialSaved={job.saved} className="-mt-1" />
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                          {job.city}
                        </span>
                        {job.match !== null ? (
                          <span className="ml-auto flex min-w-0 max-w-[11rem] flex-1 items-center gap-2">
                            <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-success-text">
                              {job.match}%
                            </span>
                            <MatchBar value={job.match} className="flex-1" />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Moje ostatnie aplikacje */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
              <h2 className="text-base font-semibold text-foreground">{td('myApplications')}</h2>
              <Link
                href="/candidate/aplikacje"
                className="shrink-0 text-sm font-medium text-accent hover:underline"
              >
                {td('seeAll')}
              </Link>
            </div>
            {applications.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground sm:px-5">{td('noApplications')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {applications.map((app) => {
                  const date = formatDate(app.date, locale);
                  return (
                    <li key={app.id} className="flex items-center gap-3 p-4 sm:px-5">
                      <div className="min-w-0 flex-1">
                        {app.slug ? (
                          <Link
                            href={`/oferty-pracy/${app.slug}`}
                            className="block max-w-full truncate text-sm font-medium text-foreground hover:text-accent hover:underline"
                          >
                            {app.jobTitle || '—'}
                          </Link>
                        ) : (
                          <p className="truncate text-sm font-medium text-foreground">
                            {app.jobTitle || '—'}
                          </p>
                        )}
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {app.companyName ? (
                            <>
                              {app.companyName} <span className="text-border">·</span> {date}
                            </>
                          ) : (
                            date
                          )}
                        </p>
                      </div>
                      <StatusPill status={app.status} className="shrink-0" />
                      <ApplicationActions
                        applicationId={app.id}
                        status={app.status}
                        slug={app.slug}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Kolumna boczna */}
        <div className="space-y-6">
          {/* Kompletność profilu */}
          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">{td('profileCompleteness')}</h2>
            <ProfileCompleteness
              className="mt-4"
              value={profile.completionPct}
              title={td('goodLevel')}
              hint={td('completenessHint')}
            />
            <ProfileChecklist className="mt-5" items={checklist} />
            <Button asChild className="mt-5 w-full">
              <Link href="/candidate/profil">{td('completeProfile')}</Link>
            </Button>
          </section>

          {/* Dokumenty / CV (prywatny bucket + signed URLs) */}
          <CvUpload items={files} />

          {/* Najnowsze wiadomości */}
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border p-4 sm:px-5">
              <h2 className="text-base font-semibold text-foreground">{td('latestMessages')}</h2>
            </div>
            {messages.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground sm:px-5">{td('noMessages')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {messages.map((msg) => (
                  <li key={msg.id} className="flex gap-3 p-4 sm:px-5">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-soft text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                      aria-hidden="true"
                    >
                      {initials(msg.title)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{msg.title}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatShort(msg.time, locale)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{msg.preview}</p>
                    </div>
                    {msg.unread ? (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent"
                        aria-hidden="true"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border p-3">
              <Button asChild variant="outline" className="w-full">
                <Link href="/candidate/wiadomosci">{td('seeAllMessages')}</Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
