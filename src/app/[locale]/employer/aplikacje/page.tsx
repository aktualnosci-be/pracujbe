import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getEmployerApplicationsPage } from '@/lib/data/employer';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('navEmployerApplications'), robots: { index: false, follow: false } };
}

function pageNumber(value: string | undefined): number {
  if (!value || !/^[1-9]\d{0,3}$/.test(value)) return 1;
  return Math.min(Number(value), 1000);
}

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export default async function EmployerApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  const { page: pageParam } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const page = pageNumber(pageParam);
  const result = await getEmployerApplicationsPage(page);
  const pageHref = (number: number) => `/employer/aplikacje?page=${number}`;

  return (
    <div className="space-y-7">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t('employerRole')}</p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('navEmployerApplications')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('employerApplicationsIntro')}</p>
        {result.status === 'ok' && result.isDemo ? (
          <p className="mt-3 inline-flex rounded-full bg-soft px-3 py-1 text-xs font-semibold text-muted-foreground">{t('employerApplicationsDemo')}</p>
        ) : null}
      </header>

      {result.status === 'error' ? (
        <section role="alert" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-foreground">{t('employerApplicationsLoadError')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('employerApplicationsLoadErrorHint')}</p>
          <a href={`/${locale}${pageHref(page)}`} className="mt-5 inline-flex min-h-12 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            {t('employerApplicationsRetry')}
          </a>
        </section>
      ) : result.applications.length === 0 ? (
        <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-foreground">{t('employerApplicationsEmptyTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('employerApplicationsEmptyHint')}</p>
          {page > 1 ? <Link href={pageHref(page - 1)} className="mt-5 inline-flex min-h-12 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{t('employerApplicationsNewer')}</Link> : null}
        </section>
      ) : (
        <>
          <ul className="grid min-w-0 gap-4 xl:grid-cols-2" aria-label={t('navEmployerApplications')}>
            {result.applications.map((application) => {
              const name = application.candidateName || t('candidateFallback');
              return (
                <li key={application.id} className="min-w-0">
                  <article className="flex h-full min-w-0 flex-col rounded-3xl border border-border bg-card p-5 sm:p-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-soft text-sm font-semibold text-foreground" aria-hidden="true">{initials(name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('employerApplicationsCandidateLabel')}</p>
                        <h2 className="mt-1 break-words text-xl font-bold leading-tight text-foreground">{name}</h2>
                        {application.isGuest ? (
                          <p className="mt-2 inline-flex rounded-full bg-soft px-3 py-1 text-xs font-semibold text-foreground">{t('employerApplicationGuestBadge')}</p>
                        ) : null}
                      </div>
                    </div>
                    <dl className="mt-6 border-y border-border py-5">
                      <div className="min-w-0">
                        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('employerApplicationsJobLabel')}</dt>
                        <dd className="mt-1 break-words text-base font-semibold text-foreground">{application.jobTitle || '—'}</dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                      <StatusPill status={application.status} />
                      <Link
                        href={`/employer/aplikacje/${encodeURIComponent(application.id)}`}
                        aria-label={t('employerApplicationViewLabel', { name, job: application.jobTitle || t('applicationUnknownJob') })}
                        className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {t('employerApplicationView')}
                      </Link>
                      <ApplicationStatusMenu applicationId={application.id} status={application.status} candidateName={name} jobTitle={application.jobTitle} />
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
          <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={t('employerApplicationsPagination')}>
            <span className="text-sm text-muted-foreground">{t('employerApplicationsPage', { page })}</span>
            <div className="flex flex-wrap gap-2">
              {page > 1 ? <Link href={pageHref(page - 1)} className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{t('employerApplicationsNewer')}</Link> : null}
              {result.hasMore ? <Link href={pageHref(page + 1)} className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{t('employerApplicationsOlder')}</Link> : null}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
