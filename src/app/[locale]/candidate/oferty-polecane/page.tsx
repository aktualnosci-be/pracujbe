import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { MatchBar } from '@/components/ui/match-bar';
import { SaveJobButton } from '@/components/candidate/SaveJobButton';
import { getRecommendedJobs } from '@/lib/data/candidate';

/**
 * Panel kandydata — Polecane oferty (pełna lista; makieta 04, sekcja „Polecane oferty pracy").
 *
 * Dane realne pod sesją (RLS) z `getRecommendedJobs` (matching + dane publiczne); bez env dane DEMO.
 * NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Kompaktowy wiersz z paskiem dopasowania
 * i zapisem oferty (spójny z podsumowaniem panelu); teksty z i18n (`dashboard`).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navRecommended'),
    robots: { index: false, follow: false },
  };
}

/** Inicjały firmy (placeholder logo). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export default async function CandidateRecommendedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const recommended = await getRecommendedJobs(locale);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('navRecommended')}</h1>

      <section className="rounded-lg border border-border bg-card">
        {recommended.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground sm:px-5">{t('emptyState')}</p>
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
                          className="truncate text-sm font-semibold text-foreground hover:text-accent hover:underline"
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
    </div>
  );
}
