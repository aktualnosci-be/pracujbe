import type { Metadata } from 'next';
import { Bookmark, MapPin, MoreHorizontal } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { StatusPill } from '@/components/ui/status-pill';
import { MatchBar } from '@/components/ui/match-bar';
import { NewProposalBanner } from '@/components/candidate/NewProposalBanner';
import { ProfileCompleteness } from '@/components/candidate/ProfileCompleteness';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';

/**
 * Panel kandydata — Podsumowanie (makieta 04).
 *
 * Struktura: powitanie + baner nowej propozycji, rząd 4 kafelków statystyk (StatCard),
 * kolumna główna z „Polecanymi ofertami" (MatchBar) i „Moimi aplikacjami" (StatusPill)
 * oraz kolumna boczna z kompletnością profilu (pierścień + checklista) i najnowszymi
 * wiadomościami. NOINDEX (panel). Wszystkie dane są DEMO — backend niepodpięty (TODO(data)).
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

// TODO(data): dane demonstracyjne — zastąpić realnymi z backendu (matching + aplikacje).
const RECOMMENDED = [
  { company: 'AG Logistics', title: 'Specjalista ds. logistyki', city: 'Antwerpia', match: 92 },
  { company: 'MetalCraft', title: 'Operator maszyn CNC', city: 'Genk', match: 89 },
  { company: 'DHL Supply Chain', title: 'Magazynier', city: 'Bruksela', match: 87 },
  { company: 'TransMove', title: 'Koordynator transportu', city: 'Charleroi', match: 84 },
  { company: 'Daoust', title: 'Pracownik produkcji', city: 'Liège', match: 82 },
] as const;

const APPLICATIONS = [
  { title: 'Specjalista ds. logistyki', company: 'AG Logistics', date: '12.05.2024', status: 'submitted' },
  { title: 'Operator wózka widłowego', company: 'Start People', date: '10.05.2024', status: 'viewed' },
  { title: 'Pracownik magazynu', company: 'Randstad', date: '08.05.2024', status: 'interview' },
  { title: 'Asystent działu obsługi klienta', company: 'Manpower', date: '01.05.2024', status: 'rejected' },
] as const;

const MESSAGES = [
  { company: 'AG Logistics', preview: 'Nowa oferta pracy dopasowana do Twojego profilu', time: '10:24', unread: true },
  { company: 'Randstad', preview: 'Zaproszenie do rozmowy kwalifikacyjnej', time: 'Wczoraj', unread: false },
  { company: 'Start People', preview: 'Dziękujemy za Twoją aplikację', time: '2 dni temu', unread: false },
] as const;

export default async function CandidateDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tj = await getTranslations({ locale, namespace: 'jobs' });

  const checklist = [
    { label: td('checkBasicInfo'), done: true },
    { label: td('checkExperience'), done: true },
    { label: td('checkEducation'), done: true },
    { label: td('checkSkills'), done: true },
    { label: td('checkLanguages'), action: td('add') },
    { label: td('checkPhoto'), action: td('add') },
  ];

  return (
    <div className="space-y-6">
      {/* Powitanie */}
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {td('greeting', { name: 'Adam' })} <span aria-hidden="true">👋</span>
      </h1>

      {/* Baner nowej propozycji (zamykany) */}
      <NewProposalBanner />

      {/* Statystyki */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={td('newJobs')} value={24} sub={td('newJobsSub')} />
        <StatCard label={td('activeApplications')} value={5} sub={td('activeApplicationsSub')} />
        <StatCard label={td('unreadMessages')} value={2} sub={td('unreadMessagesSub')} tone="error" />
        <StatCard label={td('profileCompleteness')} value="78%" tone="accent" progress={78} />
      </div>

      {/* Główna siatka: lewa (2/3) + prawa (1/3) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
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
            <ul className="divide-y divide-border">
              {RECOMMENDED.map((job) => (
                <li key={job.title} className="flex items-start gap-3 p-4 sm:px-5">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                    aria-hidden="true"
                  >
                    {initials(job.company)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {/* TODO(data): link do szczegółów oferty. */}
                        <p className="truncate text-sm font-semibold text-foreground">{job.title}</p>
                        <p className="truncate text-sm text-muted-foreground">{job.company}</p>
                      </div>
                      {/* TODO(data): zapis oferty — podpiąć akcję serwerową. */}
                      <button
                        type="button"
                        aria-label={tj('save')}
                        title={tj('save')}
                        className="-mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-soft hover:text-accent"
                      >
                        <Bookmark className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        {job.city}
                      </span>
                      <span className="ml-auto flex min-w-0 max-w-[11rem] flex-1 items-center gap-2">
                        <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-success">
                          {job.match}%
                        </span>
                        <MatchBar value={job.match} className="flex-1" />
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
            <ul className="divide-y divide-border">
              {APPLICATIONS.map((app) => (
                <li key={app.title} className="flex items-center gap-3 p-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{app.title}</p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {app.company} <span className="text-border">·</span> {app.date}
                    </p>
                  </div>
                  <StatusPill status={app.status} className="shrink-0" />
                  {/* TODO(data): menu działań aplikacji. */}
                  <button
                    type="button"
                    aria-label={td('rowActions')}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-soft hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Kolumna boczna */}
        <div className="space-y-6">
          {/* Kompletność profilu */}
          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">{td('profileCompleteness')}</h2>
            <ProfileCompleteness
              className="mt-4"
              value={78}
              title={td('goodLevel')}
              hint={td('completenessHint')}
            />
            <ProfileChecklist className="mt-5" items={checklist} />
            <Button asChild className="mt-5 w-full">
              <Link href="/candidate/profil">{td('completeProfile')}</Link>
            </Button>
          </section>

          {/* Najnowsze wiadomości */}
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border p-4 sm:px-5">
              <h2 className="text-base font-semibold text-foreground">{td('latestMessages')}</h2>
            </div>
            <ul className="divide-y divide-border">
              {MESSAGES.map((msg) => (
                <li key={msg.preview} className="flex gap-3 p-4 sm:px-5">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-soft text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                    aria-hidden="true"
                  >
                    {initials(msg.company)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{msg.company}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">{msg.time}</span>
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
