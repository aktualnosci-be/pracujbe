import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { jobContentReviewFocusKey } from '@/lib/admin/focus';
import { SCREENING_REVIEW_FILTERS, parseScreeningReviewFilter } from '@/lib/admin/list-params';
import { listJobContentReviews, type AdminJobContentReviewRow } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { JOB_CONTENT_CATEGORY_KEY } from '@/lib/job-trust/review';
import { cn } from '@/lib/utils';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { filterTabClass } from '@/components/admin/admin-styles';
import { AdminPageHeader, AdminPager } from '@/components/admin/AdminListControls';
import { JobContentReviewActions } from '@/components/admin/JobContentReviewActions';

/**
 * Panel administratora — Przegląd treści ofert z sygnałem oszustwa (0167).
 *
 * Oferty, których treść dostała sygnał reguł (wzorce PL/NL/FR/EN w bazie) albo — za flagą —
 * analizy AI. Do decyzji oferta nie zostanie opublikowana ani wznowiona (strażnik w bazie).
 * Widać źródło sygnału (reguła / AI z uzasadnieniem i pewnością) i treść oferty z chwili
 * zgłoszenia. Filtr oczekujące/rozstrzygnięte/wszystkie, kursor, daty w Europe/Brussels.
 * Odczyt service-rolem po potwierdzeniu roli admina. NOINDEX + `force-dynamic` (z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/tresc-ofert';
const TEXT_PREVIEW = 12;

const FILTER_LABEL: Record<string, string> = {
  pending: 'screeningFilterPending',
  decided: 'screeningFilterDecided',
  all: 'filterAll',
};

const STATUS_LABEL: Record<AdminJobContentReviewRow['status'], string> = {
  pending: 'screeningStatusPending',
  approved: 'screeningStatusApproved',
  rejected: 'screeningStatusRejected',
};

const STATUS_CLASS: Record<AdminJobContentReviewRow['status'], string> = {
  pending: 'bg-warning/10 text-warning-text',
  approved: 'bg-success/10 text-success-text',
  rejected: 'bg-error/10 text-error-text',
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('jobContentTitle'), robots: { index: false, follow: false } };
}

export default async function AdminJobContentReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const tTrust = await getTranslations({ locale, namespace: 'jobTrust' });
  const sp = await searchParams;
  const filter = parseScreeningReviewFilter(firstValue(sp['status']));
  const cursor = firstValue(sp['cursor']) ?? null;
  const statusQuery = filter === 'pending' ? null : filter;

  const result = await listJobContentReviews({ status: filter, cursor });
  const rows = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const listQuery = { status: statusQuery };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const label = (list: AdminJobContentReviewRow['ruleCategories']) =>
    list.map((category) => tTrust(JOB_CONTENT_CATEGORY_KEY[category])).join(', ');

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('jobContentTitle')} subtitle={t('jobContentSubtitle')} />

      <nav aria-label={t('screeningFilterLabel')} className="flex flex-wrap gap-2">
        {SCREENING_REVIEW_FILTERS.map((value) => {
          const isActive = value === filter;
          const query: Record<string, string> = value === 'pending' ? {} : { status: value };
          return (
            <Link
              key={value}
              href={{ pathname: BASE_PATH, query }}
              aria-current={isActive ? 'true' : undefined}
              className={filterTabClass(isActive)}
            >
              {t(FILTER_LABEL[value] ?? 'filterAll')}
            </Link>
          );
        })}
      </nav>

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section className="rounded-lg border border-border bg-card">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('jobContentEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const rules = label(row.ruleCategories);
                const ai = label(row.aiCategories);
                const allCategories = [rules, ai].filter(Boolean).join(', ');
                const jobLabel = `${row.jobTitle || t('screeningUnknownJob')} · ${row.companyName || t('screeningUnknownCompany')}`;
                const actionable = row.status === 'pending' && row.current;
                return (
                  <li key={row.id} className="p-4 sm:px-5" data-testid="job-content-review">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                              STATUS_CLASS[row.status],
                            )}
                          >
                            {t(STATUS_LABEL[row.status])}
                          </span>
                          {!row.current ? (
                            <span className="inline-flex items-center rounded-full bg-soft px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                              {t('jobContentNotCurrent')}
                            </span>
                          ) : null}
                        </div>
                        <h2
                          tabIndex={-1}
                          data-admin-focus={jobContentReviewFocusKey(row.id)}
                          className="break-words text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row.jobTitle || t('screeningUnknownJob')}
                        </h2>
                        <p className="break-words text-xs text-muted-foreground">
                          {row.companyId ? (
                            <Link
                              href={{ pathname: `/admin/firmy/${row.companyId}` }}
                              className="font-medium text-foreground underline underline-offset-2"
                            >
                              {row.companyName || t('screeningUnknownCompany')}
                            </Link>
                          ) : (
                            t('screeningUnknownCompany')
                          )}
                        </p>
                        <dl className="space-y-1 text-sm">
                          {rules ? (
                            <div className="flex min-w-0 flex-wrap gap-x-2">
                              <dt className="text-muted-foreground">{t('jobContentSourceRules')}:</dt>
                              <dd className="min-w-0 break-words text-foreground">{rules}</dd>
                            </div>
                          ) : null}
                          {ai ? (
                            <div className="flex min-w-0 flex-wrap gap-x-2">
                              <dt className="text-muted-foreground">{t('jobContentSourceAi')}:</dt>
                              <dd className="min-w-0 break-words text-foreground">
                                {ai}
                                {row.aiConfidence !== null
                                  ? ` · ${t('jobContentAiConfidence', { value: Math.round(row.aiConfidence * 100) })}`
                                  : ''}
                              </dd>
                            </div>
                          ) : null}
                          {row.aiReason ? (
                            <div className="flex min-w-0 flex-wrap gap-x-2">
                              <dt className="text-muted-foreground">{t('jobContentAiReason')}:</dt>
                              <dd className="min-w-0 break-words text-foreground">{row.aiReason}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <details className="text-sm">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            {t('jobContentTexts')}
                          </summary>
                          <ul className="mt-2 list-inside list-disc space-y-1">
                            {row.texts.slice(0, TEXT_PREVIEW).map((text, index) => (
                              <li key={index} className="break-words text-foreground">
                                {text}
                              </li>
                            ))}
                          </ul>
                        </details>
                        <p className="text-xs text-muted-foreground">
                          {t('screeningRequestedBy', {
                            name: row.requestedByName ?? t('auditActorSystem'),
                          })}{' '}
                          <time dateTime={row.createdAt ?? undefined}>{formatDate(row.createdAt)}</time>
                        </p>
                        {row.status !== 'pending' ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              {t('screeningDecidedBy', { name: row.decidedByName ?? t('adminName') })}{' '}
                              <time dateTime={row.decidedAt ?? undefined}>{formatDate(row.decidedAt)}</time>
                            </p>
                            {row.reason ? (
                              <p className="break-words text-sm text-muted-foreground">
                                {t('screeningDecisionReason', { text: row.reason })}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      {actionable ? (
                        <JobContentReviewActions id={row.id} jobLabel={jobLabel} categoriesLabel={allCategories} />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {result.status === 'ok' ? (
        <AdminPager
          pathname={BASE_PATH}
          query={listQuery}
          nextCursor={result.nextCursor}
          hasCursor={Boolean(cursor)}
          count={rows.length}
          q={null}
        />
      ) : null}
    </div>
  );
}
