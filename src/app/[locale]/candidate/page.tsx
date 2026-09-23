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
import { ProfileSummaryError } from '@/components/candidate/ProfileSummaryError';
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
 * Panel kandydata — Podsumowanie w stylu Paszportu pracy.
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
  const tp = await getTranslations({ locale, namespace: 'candidatePassport' });
  const tc = await getTranslations({ locale, namespace: 'common' });

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
    <div className="min-w-0 space-y-6">
      {/* Powitanie */}
      <header className="min-w-0 rounded-[1.75rem] border border-border bg-card p-5 sm:p-8">
        <h1 className="break-words text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {td('greeting', { name: profile.firstName ?? '' })}
        </h1>
      </header>

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
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        {profile.loadFailed ? (
          <StatCard label={td('profileCompleteness')} value="—" sub={tp('loadError')} />
        ) : (
          <StatCard label={td('profileCompleteness')} value={`${profile.completionPct}%`} tone="accent" progress={profile.completionPct} />
        )}
      </div>

      {/* Główna siatka: lewa (2/3) + prawa (1/3) */}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="min-w-0 space-y-6">
          {/* Polecane oferty pracy */}
          <section className="min-w-0 rounded-[1.75rem] border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-[1.75rem] border-b border-border bg-soft p-5 sm:px-7">
              <h2 className="text-xl font-bold text-foreground">{td('recommendedJobs')}</h2>
              <Link
                href="/candidate/oferty-polecane"
                className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {td('seeAll')}
              </Link>
            </div>
            {recommended.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground sm:px-5">{tj('empty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {recommended.map((job) => (
                  <li key={job.id} className="flex min-w-0 items-start gap-3 p-5 sm:px-7">
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                      aria-hidden="true"
                    >
                      {initials(job.companyName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          {job.slug ? (
                            <Link
                              href={`/oferty-pracy/${job.slug}`}
                              className="block max-w-full break-words text-base font-semibold text-foreground hover:text-accent hover:underline"
                            >
                              {job.title}
                            </Link>
                          ) : (
                            <p className="break-words text-base font-semibold text-foreground">{job.title}</p>
                          )}
                          <p className="break-words text-sm text-muted-foreground">{job.companyName}</p>
                        </div>
                        <SaveJobButton jobId={job.id} initialSaved={job.saved} className="-mt-1" />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="inline-flex min-w-0 items-center gap-1 break-words text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {job.city}
                        </span>
                        {job.match !== null ? (
                          <span className="flex min-w-[7rem] max-w-[11rem] flex-1 items-center gap-2">
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
          <section className="min-w-0 rounded-[1.75rem] border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-[1.75rem] border-b border-border bg-soft p-5 sm:px-7">
              <h2 className="text-xl font-bold text-foreground">{td('myApplications')}</h2>
              <Link
                href="/candidate/aplikacje"
                className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                    <li key={app.id} className="flex min-w-0 flex-wrap items-start gap-3 p-5 sm:px-7">
                      <div className="min-w-0 flex-1">
                        {app.slug ? (
                          <Link
                            href={`/oferty-pracy/${app.slug}`}
                            className="block max-w-full break-words text-base font-semibold text-foreground hover:text-accent hover:underline"
                          >
                            {app.jobTitle || '—'}
                          </Link>
                        ) : (
                          <p className="break-words text-base font-semibold text-foreground">
                            {app.jobTitle || '—'}
                          </p>
                        )}
                        <p className="mt-1 break-words text-sm text-muted-foreground">
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
        <div className="min-w-0 space-y-6">
          {/* Kompletność profilu */}
          {profile.loadFailed ? <ProfileSummaryError message={tp('loadError')} retry={tc('retry')} /> : <section className="min-w-0 rounded-[1.75rem] border border-border bg-card p-5 sm:p-6">
            <h2 className="text-xl font-bold text-foreground">{td('profileCompleteness')}</h2>
            <ProfileCompleteness
              className="mt-4"
              value={profile.completionPct}
              title={td('goodLevel')}
              hint={td('completenessHint')}
            />
            <ProfileChecklist className="mt-5" items={checklist} />
            <Button asChild className="mt-5 min-h-12 w-full whitespace-normal rounded-xl text-center">
              <Link href="/candidate/profil">{td('completeProfile')}</Link>
            </Button>
          </section>}

          {/* Dokumenty / CV (prywatny bucket + signed URLs) */}
          <CvUpload items={files} />

          {/* Najnowsze wiadomości */}
          <section className="min-w-0 rounded-[1.75rem] border border-border bg-card">
            <div className="rounded-t-[1.75rem] border-b border-border bg-soft p-5 sm:px-6">
              <h2 className="text-xl font-bold text-foreground">{td('latestMessages')}</h2>
            </div>
            {messages.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground sm:px-5">{td('noMessages')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {messages.map((msg) => (
                  <li key={msg.id} className="flex min-w-0 gap-3 p-5 sm:px-6">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-soft text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                      aria-hidden="true"
                    >
                      {initials(msg.title)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-sm font-semibold text-foreground">{msg.title}</p>
                        <span className="text-xs text-muted-foreground">
                          {formatShort(msg.time, locale)}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-sm text-muted-foreground">{msg.preview}</p>
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
              <Button asChild variant="outline" className="min-h-12 w-full whitespace-normal rounded-xl text-center">
                <Link href="/candidate/wiadomosci">{td('seeAllMessages')}</Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
