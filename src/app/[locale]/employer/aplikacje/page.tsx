import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { notFound } from 'next/navigation';

import { Link } from '@/i18n/navigation';
import { getEmployerApplicationsPage } from '@/lib/data/employer';
import { decodeTimeCursor, encodeTimeCursor, listPageHref, listPageRequest, listRequestHref } from '@/lib/employer/list-cursor';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';
import { ApplicationsBulkSelection, BulkSelectCheckbox } from '@/components/employer/ApplicationsBulkSelection';
import { toCamel } from '@/components/ui/status-pill';
import { APPLICATION_FILTER_STATUSES, parseApplicationStatusFilter } from '@/lib/applications/bulk';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EYEBROW,
  FORM_LABEL_TEXT,
  FORM_SELECT,
  H1_EXTENDED,
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
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { notFoundUnlessRecruitment } from '@/lib/portal-mode';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('navEmployerApplications'), robots: { index: false, follow: false } };
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
  searchParams: Promise<{
    po?: string | string[];
    przed?: string | string[];
    oferta?: string | string[];
    status?: string | string[];
  }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  // Decyzja produktowa: portal ogłoszeniowy — trasa tylko w trybie RECRUITMENT.
  notFoundUnlessRecruitment('applications');

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const ts = await getTranslations({ locale, namespace: 'status' });
  // P1-05: kursor (submitted_at, id) w adresie — `?po=` starsze, `?przed=` nowsze.
  const request = listPageRequest(query, decodeTimeCursor);
  // Pusta wartość z formularza filtra (GET) = brak filtra.
  const jobId = typeof query.oferta === 'string' && query.oferta !== '' ? query.oferta : null;
  const statusFilter = parseApplicationStatusFilter(query.status);
  const result = await getEmployerApplicationsPage(request, jobId, statusFilter);
  if (result.status === 'not_found') notFound();
  const filter: Record<string, string> = {
    ...(jobId ? { oferta: jobId } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  };
  const filtered = Object.keys(filter).length > 0;
  const jobOptions = result.status === 'ok' ? result.jobOptions : [];
  const selectedJobListed = jobId === null || jobOptions.some((job) => job.id === jobId);
  const bulkCompanyId = result.status === 'ok' && !result.isDemo ? result.companyId : null;
  const base = '/employer/aplikacje';
  const firstHref = listPageHref(base, 'po', null, filter);
  const currentHref = listRequestHref(base, request, encodeTimeCursor, filter);

  const applicationList = result.status === 'ok' ? (
    <ul className="grid min-w-0 gap-5 xl:grid-cols-2" aria-label={t('navEmployerApplications')}>
      {result.applications.map((application) => {
        const name = application.candidateName || t('candidateFallback');
        return (
          <li key={application.id} className="min-w-0">
            <article className={JOB_CARD}>
              <div className="flex min-w-0 items-center gap-3">
                {bulkCompanyId ? (
                  <BulkSelectCheckbox
                    applicationId={application.id}
                    label={t('bulkSelectApplication', { name, job: application.jobTitle || t('applicationUnknownJob') })}
                  />
                ) : null}
                <span className={ICON_BOX} aria-hidden="true">{initials(name)}</span>
                <div className="min-w-0 flex-1">
                  <p className={INFO_LABEL}>{t('employerApplicationsCandidateLabel')}</p>
                  <h2 className={`mt-1 ${JOB_CARD_TITLE}`}>{name}</h2>
                  {application.isGuest ? (
                    <p className={cn(TAG, "mt-2 font-semibold text-foreground")}>{t('employerApplicationGuestBadge')}</p>
                  ) : null}
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
  ) : null;

  return (
    <div className="space-y-7">
      <header>
        <p className={EYEBROW}>{t('employerRole')}</p>
        <h1 className={H1_EXTENDED}>{t('navEmployerApplications')}</h1>
        <p className={INTRO}>{t('employerApplicationsIntro')}</p>
        {result.status === 'ok' && result.job ? (
          <p className={`mt-3 ${PANEL_P}`}>
            {t('employerApplicationsForJob', { title: result.job.title || t('applicationUnknownJob') })}{' '}
            <Link href={base} className={TEXT_LINK}>{t('employerApplicationsAllJobs')}</Link>
          </p>
        ) : null}
        {result.status === 'ok' && result.isDemo ? (
          <p className={`mt-3 ${TAG}`}>{t('employerApplicationsDemo')}</p>
        ) : null}
      </header>

      {/* Filtry w adresie (GET, działa bez JS); zmiana filtra zaczyna od pierwszej strony. */}
      <form method="get" action={`/${locale}${base}`} className={`${PANEL} flex min-w-0 flex-wrap items-end gap-4`}
        aria-label={t('employerApplicationsFilterLabel')}>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-2">
          <span className={FORM_LABEL_TEXT}>{t('employerApplicationsFilterJob')}</span>
          <select name="oferta" defaultValue={jobId ?? ''} className={FORM_SELECT}>
            <option value="">{t('employerApplicationsFilterAllJobs')}</option>
            {!selectedJobListed && result.status === 'ok' && result.job ? (
              <option value={result.job.id}>{result.job.title || t('applicationUnknownJob')}</option>
            ) : null}
            {jobOptions.map((job) => (
              <option key={job.id} value={job.id}>{job.title || t('applicationUnknownJob')}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[12rem] flex-col gap-2">
          <span className={FORM_LABEL_TEXT}>{t('employerApplicationsFilterStatus')}</span>
          <select name="status" defaultValue={statusFilter ?? ''} className={FORM_SELECT}>
            <option value="">{t('employerApplicationsFilterAllStatuses')}</option>
            {APPLICATION_FILTER_STATUSES.map((status) => (
              <option key={status} value={status}>{ts(toCamel(status))}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={BTN_PRIMARY}>{t('employerApplicationsFilterApply')}</button>
        {filtered ? (
          <Link href={base} className={BTN_SECONDARY}>{t('employerApplicationsFilterClear')}</Link>
        ) : null}
      </form>

      {result.status === 'error' ? (
        <section role="alert" className={PANEL}>
          <h2 className={PANEL_H2}>{t('employerApplicationsLoadError')}</h2>
          <p className={`mt-2 ${PANEL_P}`}>{t('employerApplicationsLoadErrorHint')}</p>
          <a href={`/${locale}${currentHref}`} className={`mt-5 ${BTN_SECONDARY}`}>
            {t('employerApplicationsRetry')}
          </a>
        </section>
      ) : result.applications.length === 0 ? (
        <section className={PANEL}>
          <h2 className={PANEL_H2}>{filtered ? t('employerApplicationsFilterEmptyTitle') : t('employerApplicationsEmptyTitle')}</h2>
          <p className={`mt-2 ${PANEL_P}`}>{filtered ? t('employerApplicationsFilterEmptyHint') : t('employerApplicationsEmptyHint')}</p>
          {request.cursor ? <Link href={firstHref} className={`mt-5 ${BTN_SECONDARY}`}>{t('employerApplicationsFirstPage')}</Link> : null}
        </section>
      ) : (
        <>
          {bulkCompanyId ? (
            <ApplicationsBulkSelection
              companyId={bulkCompanyId}
              applications={result.applications.map((application) => ({ id: application.id }))}
            >
              {applicationList}
            </ApplicationsBulkSelection>
          ) : applicationList}
          {result.prevCursor || result.nextCursor ? (
            <nav className="flex flex-wrap items-center justify-end gap-2" aria-label={t('employerApplicationsPagination')}>
              {result.prevCursor ? (
                <Link href={listPageHref(base, 'przed', result.prevCursor, filter)} rel="prev" className={BTN_SECONDARY}>
                  {t('employerApplicationsNewer')}
                </Link>
              ) : null}
              {result.nextCursor ? (
                <Link href={listPageHref(base, 'po', result.nextCursor, filter)} rel="next" className={BTN_SECONDARY}>
                  {t('employerApplicationsOlder')}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
