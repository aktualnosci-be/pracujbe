import type { Metadata } from 'next';
import { Bookmark, MapPin } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { SaveJobButton } from '@/components/candidate/SaveJobButton';
import { Button } from '@/components/ui/button';
import { getSavedJobs } from '@/lib/data/candidate';

/**
 * Panel kandydata — Zapisane oferty (makieta 04, nawigacja „Zapisane oferty").
 *
 * Dane realne pod sesją (RLS: własne `saved_jobs`) z `getSavedJobs`, wzbogacone o dane publiczne
 * oferty; bez env dane DEMO. NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Zapis oferty
 * przez `SaveJobButton` (odznaczenie usuwa z listy po odświeżeniu); teksty z i18n (`dashboard`).
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
    title: t('navSaved'),
    robots: { index: false, follow: false },
  };
}

/** Inicjały firmy (placeholder logo). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export default async function CandidateSavedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const saved = await getSavedJobs(locale);

  return (
    <div className="min-w-0 space-y-6">
      <header className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-8">
        <h1 className="break-words text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t('navSaved')}</h1>
        <p className="mt-2 break-words text-base text-muted-foreground">{t('savedIntro')}</p>
      </header>

      <section className="min-w-0 overflow-hidden rounded-[1.75rem] border border-border bg-card">
        {saved.status === 'error' ? (
          <div role="alert" className="space-y-4 p-5 sm:p-7">
            <p className="break-words text-base text-foreground">{t('savedError')}</p>
            <Button asChild variant="outline" className="min-h-12 rounded-xl">
              <Link href="/candidate/zapisane">{t('savedRetry')}</Link>
            </Button>
          </div>
        ) : saved.jobs.length === 0 ? (
          <div className="space-y-4 p-5 sm:p-7">
            <Bookmark className="h-8 w-8 text-accent" aria-hidden="true" />
            <p className="break-words text-base text-foreground">{t('savedEmpty')}</p>
            <Button asChild className="min-h-12 whitespace-normal rounded-xl text-center">
              <Link href="/oferty-pracy">{t('savedBrowse')}</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {saved.jobs.map((job) => (
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
