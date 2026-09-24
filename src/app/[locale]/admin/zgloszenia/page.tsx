import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { reportFocusKey } from '@/lib/admin/focus';
import {
  parseReportFilter,
  parseReportKindFilter,
  REPORT_ACTIVE_FILTER,
  REPORT_FILTERS,
  REPORT_KIND_FILTERS,
  reportReasonView,
} from '@/lib/admin/list-params';
import { listReports, type AdminReportRow } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader, AdminPager } from '@/components/admin/AdminListControls';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { ReportActions } from '@/components/admin/ReportActions';

/**
 * Panel administratora — Zgłoszenia (Etap 7g).
 *
 * Lista zgłoszeń z filtrem statusu (domyślnie otwarte + w analizie, chipy → `?status=`, #416),
 * celem zgłoszenia (nazwa/tytuł + link albo podgląd wiadomości; usunięty cel ma jawny stan),
 * powodem ze słownika i18n (bez surowych kodów — Invariant #2), stronicowaniem kursorem (#418)
 * i datami w Europe/Brussels (#421). Rozstrzygnięcie przez ReportActions (dialog potwierdzenia
 * #422 → RPC `admin_resolve_report` z macierzą przejść i audytem po stronie DB). Odczyt
 * service-rolem po potwierdzeniu roli admina. NOINDEX + `force-dynamic` (z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/zgloszenia';

/** Etykieta typu celu zgłoszenia (klucz i18n w namespace `admin`). */
const TARGET_LABEL: Record<string, string> = {
  job: 'targetJob',
  company: 'targetCompany',
  user: 'targetUser',
  message: 'targetMessage',
};

/** Etykieta chipa filtra statusu. */
const FILTER_LABEL: Record<string, string> = {
  [REPORT_ACTIVE_FILTER]: 'filterReportsActive',
  open: 'statusOpen',
  reviewing: 'statusReviewing',
  resolved: 'statusResolved',
  dismissed: 'statusDismissed',
  all: 'filterAll',
};

/** Etykieta chipa filtra rodzaju zgłoszenia (#41). */
const KIND_LABEL: Record<string, string> = {
  all: 'filterKindAll',
  dsa_notice: 'kindDsa',
  quality: 'kindQuality',
};

/** Etykieta statusu w historii sprawy. */
const STATUS_LABEL: Record<string, string> = {
  open: 'statusOpen',
  reviewing: 'statusReviewing',
  resolved: 'statusResolved',
  dismissed: 'statusDismissed',
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
  return {
    title: t('reportsTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function AdminReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const sp = await searchParams;
  const filter = parseReportFilter(firstValue(sp['status']));
  const kind = parseReportKindFilter(firstValue(sp['kind']));
  const cursor = firstValue(sp['cursor']) ?? null;
  const statusQuery = filter === REPORT_ACTIVE_FILTER ? null : filter;
  const kindQuery = kind === 'all' ? null : kind;

  const result = await listReports({ status: filter, kind, cursor });
  // Termin sprawy liczony w chwili renderu (strona force-dynamic).
  const now = Date.now();
  const reports = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale, { withTime: true });

  const retryParams = new URLSearchParams(
    Object.entries({ status: statusQuery, kind: kindQuery, cursor }).filter((e): e is [string, string] =>
      Boolean(e[1]),
    ),
  ).toString();

  /** Tekst celu do dialogu potwierdzenia. */
  const targetText = (report: AdminReportRow): string => {
    if (report.target.deleted) return t('targetDeleted');
    return report.target.label ?? report.target.preview ?? t('targetUnnamed');
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('reportsTitle')} subtitle={t('reportsSubtitle')} />

      {/* Filtry statusu */}
      <nav aria-label={t('filterReportsLabel')} className="flex flex-wrap gap-2">
        {REPORT_FILTERS.map((value) => {
          const isActive = value === filter;
          return (
            <Link
              key={value}
              href={{
                pathname: BASE_PATH,
                query: {
                  ...(value === REPORT_ACTIVE_FILTER ? {} : { status: value }),
                  ...(kindQuery ? { kind: kindQuery } : {}),
                },
              }}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-soft hover:text-foreground',
              )}
            >
              {t(FILTER_LABEL[value] ?? 'filterAll')}
            </Link>
          );
        })}
      </nav>

      {/* Rodzaj zgłoszenia (#41): sprawy DSA to osobna kolejka. */}
      <nav aria-label={t('filterKindLabel')} className="flex flex-wrap gap-2">
        {REPORT_KIND_FILTERS.map((value) => {
          const isActive = value === kind;
          return (
            <Link
              key={value}
              href={{
                pathname: BASE_PATH,
                query: {
                  ...(statusQuery ? { status: statusQuery } : {}),
                  ...(value === 'all' ? {} : { kind: value }),
                },
              }}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-soft hover:text-foreground',
              )}
            >
              {t(KIND_LABEL[value] ?? 'filterKindAll')}
            </Link>
          );
        })}
      </nav>

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section className="rounded-lg border border-border bg-card">
          {reports.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('reportsEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {reports.map((report) => {
                const typeLabel = t(TARGET_LABEL[report.targetType] ?? 'targetUnknown');
                const reason = reportReasonView(report.reason);
                const reasonLabel = t(reason.key);
                const { target } = report;
                return (
                  <li key={report.id} className="space-y-3 p-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-md bg-soft px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {typeLabel}
                          </span>
                          <AdminStatusBadge kind="report" status={report.status} />
                          {report.dsa ? (
                            <span className="inline-flex items-center rounded-md border border-primary px-2 py-0.5 text-xs font-medium text-foreground">
                              {t('kindDsa')}
                            </span>
                          ) : null}
                        </div>
                        {report.dsa ? (
                          <p className="text-xs text-muted-foreground">
                            {t('caseNumber')}:{' '}
                            <span className="font-mono font-medium text-foreground">{report.dsa.caseNumber}</span>
                            {report.dsa.dueAt ? (
                              <>
                                {' '}
                                <span aria-hidden="true">·</span>{' '}
                                {t('caseDue', { date: formatDate(report.dsa.dueAt) })}
                                {['open', 'reviewing'].includes(report.status) &&
                                new Date(report.dsa.dueAt).getTime() < now ? (
                                  <span className="ml-1 font-medium text-error">{t('caseOverdue')}</span>
                                ) : null}
                              </>
                            ) : null}
                          </p>
                        ) : null}
                        <h2
                          tabIndex={-1}
                          data-admin-focus={reportFocusKey(report.id)}
                          className="break-words text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {reasonLabel}
                        </h2>
                        {/* Czego dotyczy zgłoszenie (#416). */}
                        <p className="break-words text-sm text-foreground">
                          <span className="text-muted-foreground">{t('reportTarget')}: </span>
                          {target.deleted ? (
                            <span className="italic text-muted-foreground">
                              {t('targetDeleted')}
                            </span>
                          ) : target.href ? (
                            <Link
                              href={target.href}
                              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                            >
                              {target.label ?? t('targetUnnamed')}
                            </Link>
                          ) : (
                            <span className="font-medium">
                              {target.label ??
                                (target.preview !== null ? t('targetMessagePreview') : t('targetUnnamed'))}
                            </span>
                          )}
                        </p>
                        {target.preview ? (
                          <blockquote className="break-words rounded-md border-l-2 border-border bg-soft px-3 py-2 text-sm text-foreground">
                            {target.preview}
                          </blockquote>
                        ) : null}
                        {reason.freeText ? (
                          <p className="break-words text-sm text-muted-foreground">
                            {t('reasonFreeText', { text: reason.freeText })}
                          </p>
                        ) : null}
                        {report.details ? (
                          <p className="break-words text-sm text-muted-foreground">
                            {report.details}
                          </p>
                        ) : null}
                        {report.dsa ? (
                          <div className="space-y-1 rounded-md border border-border p-3 text-sm">
                            <p className="font-medium text-foreground">{t('caseSnapshotTitle')}</p>
                            {report.dsa.snapshotJobTitle ? (
                              <p className="break-words text-foreground">
                                {t('caseSnapshotJob', { title: report.dsa.snapshotJobTitle })}
                              </p>
                            ) : null}
                            {report.dsa.snapshotCompanyName ? (
                              <p className="break-words text-foreground">
                                {t('caseSnapshotCompany', { name: report.dsa.snapshotCompanyName })}
                              </p>
                            ) : null}
                            {report.dsa.contentUrl ? (
                              <p className="break-all text-muted-foreground">
                                {t('caseContentUrl', { url: report.dsa.contentUrl })}
                              </p>
                            ) : null}
                            {report.dsa.reporterEmail ? (
                              <p className="break-all text-muted-foreground">
                                {t('caseReporterContact', { email: report.dsa.reporterEmail })}
                              </p>
                            ) : null}
                            {report.dsa.events.length > 0 ? (
                              <div>
                                <p className="font-medium text-foreground">{t('caseHistoryTitle')}</p>
                                <ol className="text-muted-foreground">
                                  {report.dsa.events.map((event, index) => (
                                    <li key={`${event.at}-${index}`}>
                                      <time dateTime={event.at}>{formatDate(event.at)}</time>{' '}
                                      {event.type === 'submitted'
                                        ? t('caseEventSubmitted')
                                        : t('caseEventStatus', {
                                            status: t(STATUS_LABEL[event.toStatus ?? ''] ?? 'statusUnknown'),
                                          })}
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {t('reportedBy', {
                            name: report.reporterName ?? t('reporterFallback'),
                          })}{' '}
                          <span aria-hidden="true">·</span>{' '}
                          <time dateTime={report.createdAt ?? undefined}>
                            {formatDate(report.createdAt)}
                          </time>
                        </p>
                      </div>
                      <ReportActions
                        reportId={report.id}
                        status={report.status}
                        targetTypeLabel={typeLabel}
                        targetLabel={targetText(report)}
                        reasonLabel={reasonLabel}
                      />
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
          query={{ status: statusQuery, kind: kindQuery }}
          nextCursor={result.nextCursor}
          hasCursor={Boolean(cursor)}
          count={reports.length}
        />
      ) : null}
    </div>
  );
}
