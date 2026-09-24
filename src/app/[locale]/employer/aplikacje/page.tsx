import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getEmployerApplicationsPage } from '@/lib/data/employer';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';
import {
  BTN_SECONDARY,
  EYEBROW,
  H1,
  ICON_BOX,
  INFO_LABEL,
  INFO_VALUE,
  INTRO,
  JOB_CARD,
  JOB_CARD_TITLE,
  PANEL,
  PANEL_H2,
  PANEL_P,
  TAG,
} from '@/components/dashboard/panel-styles';

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
        <p className={EYEBROW}>{t('employerRole')}</p>
        <h1 className={H1}>{t('navEmployerApplications')}</h1>
        <p className={INTRO}>{t('employerApplicationsIntro')}</p>
        {result.status === 'ok' && result.isDemo ? (
          <p className={`mt-3 ${TAG}`}>{t('employerApplicationsDemo')}</p>
        ) : null}
      </header>

      {result.status === 'error' ? (
        <section role="alert" className={PANEL}>
          <h2 className={PANEL_H2}>{t('employerApplicationsLoadError')}</h2>
          <p className={`mt-2 ${PANEL_P}`}>{t('employerApplicationsLoadErrorHint')}</p>
          <a href={`/${locale}${pageHref(page)}`} className={`mt-5 ${BTN_SECONDARY}`}>
            {t('employerApplicationsRetry')}
          </a>
        </section>
      ) : result.applications.length === 0 ? (
        <section className={PANEL}>
          <h2 className={PANEL_H2}>{t('employerApplicationsEmptyTitle')}</h2>
          <p className={`mt-2 ${PANEL_P}`}>{t('employerApplicationsEmptyHint')}</p>
          {page > 1 ? <Link href={pageHref(page - 1)} className={`mt-5 ${BTN_SECONDARY}`}>{t('employerApplicationsNewer')}</Link> : null}
        </section>
      ) : (
        <>
          <ul className="grid min-w-0 gap-5 xl:grid-cols-2" aria-label={t('navEmployerApplications')}>
            {result.applications.map((application) => {
              const name = application.candidateName || t('candidateFallback');
              return (
                <li key={application.id} className="min-w-0">
                  <article className={JOB_CARD}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={ICON_BOX} aria-hidden="true">{initials(name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className={INFO_LABEL}>{t('employerApplicationsCandidateLabel')}</p>
                        <h2 className={`mt-1 ${JOB_CARD_TITLE}`}>{name}</h2>
                      </div>
                    </div>
                    <dl className="mt-6 border-y border-border py-5">
                      <div className="min-w-0">
                        <dt className={INFO_LABEL}>{t('employerApplicationsJobLabel')}</dt>
                        <dd className={INFO_VALUE}>{application.jobTitle || '—'}</dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                      <StatusPill status={application.status} />
                      <Link
                        href={`/employer/aplikacje/${encodeURIComponent(application.id)}`}
                        aria-label={t('employerApplicationViewLabel', { name, job: application.jobTitle || t('applicationUnknownJob') })}
                        className={BTN_SECONDARY}
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
            <span className={`text-xs text-muted-foreground`}>{t('employerApplicationsPage', { page })}</span>
            <div className="flex flex-wrap gap-2">
              {page > 1 ? <Link href={pageHref(page - 1)} className={BTN_SECONDARY}>{t('employerApplicationsNewer')}</Link> : null}
              {result.hasMore ? <Link href={pageHref(page + 1)} className={BTN_SECONDARY}>{t('employerApplicationsOlder')}</Link> : null}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
