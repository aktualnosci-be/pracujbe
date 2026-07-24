import type { Metadata } from 'next';
import { Plus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { JobLifecycleActions } from '@/components/employer/JobLifecycleActions';
import { getCompanyJobs } from '@/lib/data/employer';

/**
 * Lista ofert firmy (`/employer/oferty`) — cel linku „Zobacz wszystkie oferty" i pozycji nawigacji
 * `navOffers` (P1-13: wcześniej 404, istniała tylko podtrasa `oferty/nowa`).
 *
 * Realne dane pod sesją/RLS (getCompanyJobs — recruiter+). Panel = noindex, force-dynamic.
 * Świadomie BEZ nieaktywnych checkboxów/menu akcji z dashboardu (P1-14).
 *
 * P1-04 (cykl życia): szkic ma link „Dokończ szkic" (wznowienie kreatora — koniec osieroconych
 * draftów), a oferta opublikowana/wstrzymana/zamknięta realne akcje statusu (wstrzymaj/wznów/
 * zamknij/otwórz ponownie) egzekwowane w RPC `set_job_status`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('navOffers'), robots: { index: false, follow: false } };
}

export default async function EmployerOffersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const td = await getTranslations('dashboard');
  const jobs = await getCompanyJobs();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{td('navOffers')}</h1>
        <Button asChild size="sm">
          <Link href="/employer/oferty/nowa">
            <Plus className="size-4" aria-hidden="true" />
            {td('addJob')}
          </Link>
        </Button>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {td('emptyState')}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {jobs.map((offer) => (
            <li
              key={offer.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{offer.title}</p>
                <p className="truncate text-xs text-muted-foreground">{offer.city}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-4 text-sm">
                <span className="text-muted-foreground">
                  {td('offersApplications', { count: offer.newApplications })}
                </span>
                <span className="text-muted-foreground">
                  {td('colMatched')}: {offer.matched}
                </span>
                <StatusPill status={offer.status} />
                {offer.status === 'draft' ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/employer/oferty/${offer.id}/edycja`}>{td('resumeDraft')}</Link>
                  </Button>
                ) : (
                  <JobLifecycleActions jobId={offer.id} status={offer.status} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
