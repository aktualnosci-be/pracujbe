import type { Metadata } from 'next';
import { Flag } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { reportFocusKey } from '@/lib/admin/focus';
import {
  parseReportFilter,
  parseReportFlagged,
  parseReportKindFilter,
  parseReportSort,
  REPORT_ACTIVE_FILTER,
  REPORT_FILTERS,
  REPORT_KIND_FILTERS,
  REPORT_SORTS,
  reportReasonView,
} from '@/lib/admin/list-params';
import { listReports, type AdminReportRow } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminPager,
} from '@/components/admin/AdminListControls';
import {
  filterTabClass,
  ICON_BOX,
  INLINE_LINK,
  PANEL,
  ROW,
  ROW_META,
  ROW_TITLE,
  TAG,
} from '@/components/admin/admin-styles';
import { cn } from '@/lib/utils';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { ModerationDecisionActions } from '@/components/admin/ModerationDecisionActions';
import { ReportActions } from '@/components/admin/ReportActions';

/**
 * Panel administratora — Zgłoszenia (Etap 7g).
 *
 * Lista zgłoszeń z filtrem statusu (domyślnie otwarte + w analizie, chipy → `?status=`, #416),
 * celem zgłoszenia (nazwa/tytuł + link albo podgląd wiadomości; usunięty cel ma jawny stan),
 * powodem ze słownika i18n (bez surowych kodów — Invariant #2), stronicowaniem kursorem (#418)
 * i datami w Europe/Brussels (#421). Rozstrzygnięcie przez ReportActions (dialog potwierdzenia
 * #422 → RPC `admin_resolve_report` z macierzą przejść i audytem po stronie DB). Sprawę DSA
 * rozstrzyga decyzja moderacyjna z uzasadnieniem i skutkiem (ModerationDecisionActions → RPC
 * `admin_decide_report`, #42); karta pokazuje decyzję, przywrócenie i priorytet przeglądu. Odczyt
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
  conversation: 'targetConversation',
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
  message_report: 'kindMessage',
  quality: 'kindQuality',
};

/** Etykieta kolejności listy (kolejka przeglądu DSA, #42). */
const SORT_LABEL: Record<string, string> = {
  newest: 'reportsSortNewest',
  priority: 'reportsSortPriority',
};

/** Rozstrzygnięcie decyzji moderacyjnej (#42). */
const DECISION_LABEL: Record<string, string> = {
  no_action: 'decisionNoAction',
  job_removed: 'decisionJobRemoved',
  company_suspended: 'decisionCompanySuspended',
};

/** Podstawa ograniczenia (#42). */
const GROUND_LABEL: Record<string, string> = {
  terms: 'decisionGroundTerms',
  law: 'decisionGroundLaw',
};

/** Zdarzenia historii sprawy poza zmianą statusu (#42). */
const EVENT_LABEL: Record<string, string> = {
  submitted: 'caseEventSubmitted',
  decision: 'caseEventDecision',
  restored: 'caseEventRestored',
  flagged: 'caseEventFlagged',
  appeal_submitted: 'caseEventAppealSubmitted',
  appeal_decided: 'caseEventAppealDecided',
  redacted: 'caseEventRedacted',
};

/** Etykieta statusu w historii sprawy. */
const STATUS_LABEL: Record<string, string> = {
  open: 'statusOpen',
  reviewing: 'statusReviewing',
  resolved: 'statusResolved',
  dismissed: 'statusDismissed',
};

/** Strona rozmowy w dowodzie zgłoszenia wiadomości (0116). */
const SIDE_LABEL: Record<string, string> = {
  company: 'messageReportSideCompany',
  candidate: 'messageReportSideCandidate',
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
  const sortParam = firstValue(sp['sort']);
  const sort = parseReportSort(sortParam, kind);
  const flagged = parseReportFlagged(firstValue(sp['flagged']));
  const statusQuery = filter === REPORT_ACTIVE_FILTER ? null : filter;
  const kindQuery = kind === 'all' ? null : kind;
  // Jawna kolejność zostaje w URL tylko, gdy użytkownik ją wybrał (domyślna zależy od rodzaju).
  const sortQuery = sortParam && sortParam === sort ? sort : null;
  const flaggedQuery = flagged ? '1' : null;
  /** Wspólne parametry linków listy (bez kursora — zmiana filtra/kolejności = pierwsza strona). */
  const listQuery = (over: Record<string, string | null> = {}): Record<string, string> =>
    Object.fromEntries(
      Object.entries({ status: statusQuery, kind: kindQuery, sort: sortQuery, flagged: flaggedQuery, ...over })
        .filter((e): e is [string, string] => Boolean(e[1])),
    );

  const result = await listReports({ status: filter, kind, cursor, sort, flagged });
  // Termin sprawy liczony w chwili renderu (strona force-dynamic).
  const now = Date.now();
  const reports = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale, { withTime: true });

  const retryParams = new URLSearchParams(
    { ...listQuery(), ...(cursor ? { cursor } : {}) },
  ).toString();

  /** Tekst celu do dialogu potwierdzenia. */
  const targetText = (report: AdminReportRow): string => {
    if (report.target.deleted) return t('targetDeleted');
    return report.target.label ?? report.target.preview ?? t('targetUnnamed');
  };

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader
        eyebrow={t('brandTag')}
        title={t('reportsTitle')}
        subtitle={t('reportsSubtitle')}
      />

      {/* Filtry statusu */}
      <nav aria-label={t('filterReportsLabel')} className="flex flex-wrap gap-2">
        {REPORT_FILTERS.map((value) => {
          const isActive = value === filter;
          return (
            <Link
              key={value}
              href={{
                pathname: BASE_PATH,
                query: listQuery({ status: value === REPORT_ACTIVE_FILTER ? null : value }),
              }}
              aria-current={isActive ? 'true' : undefined}
              className={filterTabClass(isActive)}
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
                query: listQuery({ kind: value === 'all' ? null : value }),
              }}
              aria-current={isActive ? 'true' : undefined}
              className={filterTabClass(isActive)}
            >
              {t(KIND_LABEL[value] ?? 'filterKindAll')}
            </Link>
          );
        })}
      </nav>

      {/* Kolejka przeglądu (#42): priorytet z flag_report_for_review i termin sprawy. */}
      <nav aria-label={t('reportsSortLabel')} className="flex flex-wrap gap-2">
        {REPORT_SORTS.map((value) => {
          const isActive = value === sort;
          return (
            <Link
              key={value}
              href={{ pathname: BASE_PATH, query: listQuery({ sort: value }) }}
              aria-current={isActive ? 'true' : undefined}
              className={filterTabClass(isActive)}
            >
              {t(SORT_LABEL[value] ?? 'reportsSortNewest')}
            </Link>
          );
        })}
      </nav>

      <nav aria-label={t('reportsFlaggedLabel')} className="flex flex-wrap gap-2">
        {([false, true] as const).map((value) => (
          <Link
            key={String(value)}
            href={{ pathname: BASE_PATH, query: listQuery({ flagged: value ? '1' : null }) }}
            aria-current={value === flagged ? 'true' : undefined}
            className={filterTabClass(value === flagged)}
          >
            {t(value ? 'reportsFlaggedOnly' : 'reportsFlaggedAll')}
          </Link>
        ))}
      </nav>

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section className={PANEL}>
          {reports.length === 0 ? (
            <AdminEmptyState message={t('reportsEmpty')} />
          ) : (
            <ul className="divide-y divide-border">
              {reports.map((report) => {
                const typeLabel = t(TARGET_LABEL[report.targetType] ?? 'targetUnknown');
                const reason = reportReasonView(report.reason);
                const reasonLabel = t(reason.key);
                const { target } = report;
                return (
                  <li key={report.id} className={ROW}>
                    <span className={ICON_BOX} aria-hidden="true">
                      <Flag />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                        <h2
                          tabIndex={-1}
                          data-admin-focus={reportFocusKey(report.id)}
                          className={cn(
                            ROW_TITLE,
                            'mb-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          )}
                        >
                          {reasonLabel}
                        </h2>
                        {/* Czego dotyczy zgłoszenie (#416). */}
                        <p className="break-words text-[13px] text-foreground">
                          <span className="text-muted-foreground">{t('reportTarget')}: </span>
                          {target.deleted ? (
                            <span className="italic text-muted-foreground">
                              {t('targetDeleted')}
                            </span>
                          ) : target.href ? (
                            <Link
                              href={target.href}
                              className={cn(INLINE_LINK, 'underline')}
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
                          <blockquote className="whitespace-pre-wrap break-words rounded-[14px] border border-border bg-soft px-4 py-3 text-[13px] text-foreground">
                            {target.preview}
                          </blockquote>
                        ) : null}
                        {/* Zgłoszenie wiadomości/rozmowy (0116): dowód z chwili zgłoszenia. */}
                        {report.messageReport ? (
                          <div className="space-y-1 rounded-[14px] border border-border px-4 py-3 text-[13px]">
                            <p className="font-medium text-foreground">
                              {t(
                                report.messageReport.scope === 'message'
                                  ? 'messageReportScopeMessage'
                                  : 'messageReportScopeConversation',
                              )}
                            </p>
                            {report.messageReport.senderSide ? (
                              <p className="text-muted-foreground">
                                {t('messageReportSender', {
                                  side: t(SIDE_LABEL[report.messageReport.senderSide] ?? 'messageReportSideCandidate'),
                                })}
                              </p>
                            ) : null}
                            {report.messageReport.reporterSide ? (
                              <p className="text-muted-foreground">
                                {t('messageReportReporter', {
                                  side: t(SIDE_LABEL[report.messageReport.reporterSide] ?? 'messageReportSideCandidate'),
                                })}
                              </p>
                            ) : null}
                            {report.messageReport.scope === 'conversation' &&
                            report.messageReport.messageCount !== null ? (
                              <p className="text-muted-foreground">
                                {t('messageReportCount', { count: report.messageReport.messageCount })}
                              </p>
                            ) : null}
                            {report.messageReport.capturedAt ? (
                              <p className="text-muted-foreground">
                                {t('messageReportCaptured', {
                                  date: formatDate(report.messageReport.capturedAt),
                                })}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {reason.freeText ? (
                          <p className={ROW_META}>
                            {t('reasonFreeText', { text: reason.freeText })}
                          </p>
                        ) : null}
                        {report.details ? (
                          <p className={ROW_META}>
                            {report.details}
                          </p>
                        ) : null}
                        {report.dsa ? (
                          <div className="space-y-1 rounded-[14px] border border-border px-4 py-3 text-[13px]">
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
                                      {event.type === 'status_changed'
                                        ? t('caseEventStatus', {
                                            status: t(STATUS_LABEL[event.toStatus ?? ''] ?? 'statusUnknown'),
                                          })
                                        : t(EVENT_LABEL[event.type] ?? 'caseEventSubmitted')}
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {report.dsa?.decision ? (
                          <div className="space-y-1 rounded-[14px] border border-border bg-soft px-4 py-3 text-[13px]">
                            <p className="font-medium text-foreground">
                              {t('decisionSummaryTitle', { reference: report.dsa.decision.reference })}
                              {': '}
                              {t(DECISION_LABEL[report.dsa.decision.decision] ?? 'decisionNoAction')}
                            </p>
                            <p className="break-words text-foreground">{report.dsa.decision.facts}</p>
                            {report.dsa.decision.groundType && report.dsa.decision.groundReference ? (
                              <p className="break-words text-muted-foreground">
                                {t('decisionSummaryGround', {
                                  ground: t(GROUND_LABEL[report.dsa.decision.groundType] ?? 'decisionGroundTerms'),
                                  reference: report.dsa.decision.groundReference,
                                })}
                              </p>
                            ) : null}
                            <p className="text-muted-foreground">
                              {t(
                                report.dsa.decision.automatedDetection
                                  ? 'decisionSummaryAutomated'
                                  : 'decisionSummaryManual',
                              )}{' '}
                              <span aria-hidden="true">·</span>{' '}
                              <time dateTime={report.dsa.decision.decidedAt}>
                                {formatDate(report.dsa.decision.decidedAt)}
                              </time>
                            </p>
                            {report.dsa.decision.restoredAt ? (
                              <p className="break-words text-muted-foreground">
                                {t('decisionSummaryRestored', {
                                  date: formatDate(report.dsa.decision.restoredAt),
                                  reason: report.dsa.decision.restoreReason ?? '',
                                })}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {report.dsa && (report.dsa.reviewPriority > 0 || report.dsa.reviewFlag) ? (
                          <p className={ROW_META}>
                            {t('casePriority', { priority: report.dsa.reviewPriority })}
                            {report.dsa.reviewFlag ? (
                              <>
                                {' '}
                                <span aria-hidden="true">·</span>{' '}
                                {t('caseFlag', { flag: report.dsa.reviewFlag })}
                              </>
                            ) : null}
                          </p>
                        ) : null}
                        {report.dsa ? (
                          <p className={ROW_META}>
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
                        <p className={ROW_META}>
                          {t('reportedBy', {
                            name: report.reporterName ?? t('reporterFallback'),
                          })}{' '}
                          <span aria-hidden="true">·</span>{' '}
                          <time dateTime={report.createdAt ?? undefined}>
                            {formatDate(report.createdAt)}
                          </time>
                        </p>
                        <div className="flex flex-wrap items-center">
                          <span className={cn(TAG, 'mr-[5px] mt-1.5')}>{typeLabel}</span>
                          <AdminStatusBadge kind="report" status={report.status} className="mt-1.5" />
                          {report.dsa ? (
                            <span className={cn(TAG, 'ml-[5px] mt-1.5 font-medium text-foreground')}>
                              {t('kindDsa')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {report.dsa ? (
                        <ModerationDecisionActions
                          reportId={report.id}
                          status={report.status}
                          caseNumber={report.dsa.caseNumber}
                          targetType={report.targetType}
                          targetTypeLabel={typeLabel}
                          targetLabel={targetText(report)}
                          reasonLabel={reasonLabel}
                          decision={report.dsa.decision}
                        />
                      ) : (
                        <ReportActions
                          reportId={report.id}
                          status={report.status}
                          targetTypeLabel={typeLabel}
                          targetLabel={targetText(report)}
                          reasonLabel={reasonLabel}
                        />
                      )}
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
          query={listQuery()}
          nextCursor={result.nextCursor}
          hasCursor={Boolean(cursor)}
          count={reports.length}
        />
      ) : null}
    </div>
  );
}
