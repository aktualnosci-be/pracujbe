import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  FIELD,
  FIELD_LABEL,
  PANEL,
  PANEL_H2,
  PANEL_P,
  SECTION_HEAD,
  STAT,
  STAT_LABEL,
  STAT_SMALL,
  STAT_VALUE,
  STATS,
} from '@/components/admin/admin-styles';
import { parseDsaReportRange } from '@/lib/admin/dsa-report';
import {
  getRetentionOverview,
  getTransparencyReport,
  type CountMap,
} from '@/lib/data/admin-dsa';
import { createAppDateFormatter } from '@/lib/datetime';

/**
 * Panel administratora — Raport przejrzystości DSA i retencja spraw (#43).
 *
 * Agregaty za wybrany okres (dni w Europe/Brussels): zgłoszenia wg kategorii i rodzaju treści,
 * decyzje wg rodzaju i podstawy, czas do decyzji, automatyzacja, odwołania i odwrócone decyzje,
 * przywrócenia. Eksport CSV/JSON wiersz-na-decyzję bez danych osobowych (`/api/admin/dsa-report`).
 * Retencja: podgląd bez zmian w danych i ostatnie przebiegi. Zakres publikacji, przekazywania
 * do bazy DSA i okresy retencji są jawnie oznaczone jako do zatwierdzenia przez właściciela.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/raport-dsa';

const CATEGORY_KEY: Record<string, string> = {
  fraud: 'reasonFraud',
  impersonation: 'reasonImpersonation',
  discrimination: 'reasonDiscrimination',
  illegal_conditions: 'reasonIllegalConditions',
  data_misuse: 'reasonDataMisuse',
  other: 'reasonOther',
};
const TARGET_KEY: Record<string, string> = { job: 'targetJob', company: 'targetCompany' };
const DECISION_KEY: Record<string, string> = {
  no_action: 'decisionNoAction',
  job_removed: 'decisionJobRemoved',
  company_suspended: 'decisionCompanySuspended',
};
const GROUND_KEY: Record<string, string> = { terms: 'decisionGroundTerms', law: 'decisionGroundLaw' };
const APPELLANT_KEY: Record<string, string> = { author: 'appealRoleAuthor', reporter: 'appealRoleReporter' };
const APPEAL_STATUS_KEY: Record<string, string> = {
  pending: 'appealStatusPending',
  upheld: 'appealStatusUpheld',
  reversed: 'appealStatusReversed',
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
  return { title: t('dsaReportTitle'), robots: { index: false, follow: false } };
}

export default async function AdminDsaReportPage({
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
  const range = parseDsaReportRange(firstValue(sp['od']), firstValue(sp['do']));
  const [report, retention] = await Promise.all([
    range.ok ? getTransparencyReport(range.from, range.to) : Promise.resolve(null),
    getRetentionOverview(),
  ]);
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const hours = (value: number | null) => (value === null ? t('dsaReportNoData') : t('dsaReportHours', { hours: value }));
  const exportQuery = `od=${encodeURIComponent(range.fromYmd)}&do=${encodeURIComponent(range.toYmd)}`;

  // Lista, nie tabela: przy 320 px i 200% tekstu wiersze zawijają się bez przewijanego regionu.
  const breakdown = (title: string, map: CountMap, keys: Record<string, string>) => (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <dl className="divide-y divide-border border-y border-border text-[13px]">
        {Object.entries(keys).map(([value, key]) => (
          <div key={value} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2.5">
            <dt className="min-w-0 break-words text-muted-foreground">{t(key)}</dt>
            <dd className="font-semibold text-foreground">{map[value] ?? 0}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  const stat = (label: string, value: string | number, small?: string) => (
    <div className={STAT}>
      <span className={STAT_LABEL}>{label}</span>
      <strong className={STAT_VALUE}>{value}</strong>
      {small ? <small className={STAT_SMALL}>{small}</small> : null}
    </div>
  );

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader eyebrow={t('brandTag')} title={t('dsaReportTitle')} subtitle={t('dsaReportSubtitle')} />

      <form method="get" action={`/${locale}${BASE_PATH}`} className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="min-w-0">
          <label htmlFor="dsa-from" className={FIELD_LABEL}>
            {t('dsaReportFrom')}
          </label>
          <input id="dsa-from" name="od" type="date" defaultValue={range.fromYmd} className={FIELD} />
        </div>
        <div className="min-w-0">
          <label htmlFor="dsa-to" className={FIELD_LABEL}>
            {t('dsaReportTo')}
          </label>
          <input id="dsa-to" name="do" type="date" defaultValue={range.toYmd} className={FIELD} />
        </div>
        <button type="submit" className={BTN_PRIMARY}>
          {t('dsaReportApply')}
        </button>
      </form>

      {!range.ok ? (
        <p role="alert" className="text-sm font-medium text-error-text">
          {t('dsaReportInvalidRange')}
        </p>
      ) : report === null || report.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}?${exportQuery}`} />
      ) : (
        <>
          <section aria-labelledby="dsa-notices" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="dsa-notices" className={PANEL_H2}>
                {t('dsaReportNotices')}
              </h2>
            </div>
            <div className={`${STATS} grid-cols-2`}>
              {stat(t('dsaReportTotal'), report.report.notices.total)}
              {stat(t('dsaReportPending'), report.report.notices.pending)}
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {breakdown(t('dsaReportByCategory'), report.report.notices.byCategory, CATEGORY_KEY)}
              {breakdown(t('dsaReportByTarget'), report.report.notices.byTargetType, TARGET_KEY)}
            </div>
          </section>

          <section aria-labelledby="dsa-decisions" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="dsa-decisions" className={PANEL_H2}>
                {t('dsaReportDecisions')}
              </h2>
            </div>
            <div className={`${STATS} grid-cols-2 md:grid-cols-4`}>
              {stat(t('dsaReportTotal'), report.report.decisions.total)}
              {stat(t('dsaReportMedianToDecision'), hours(report.report.decisions.medianHoursToDecision))}
              {stat(t('dsaReportWithinDue'), report.report.decisions.withinDueDate)}
              {stat(t('dsaReportFromAppeal'), report.report.decisions.fromAppeal)}
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {breakdown(t('dsaReportByDecision'), report.report.decisions.byDecision, DECISION_KEY)}
              {breakdown(t('dsaReportByGround'), report.report.decisions.byGround, GROUND_KEY)}
            </div>
            <p className={`${PANEL_P} mt-4`}>
              {t('dsaReportAutomation', {
                detected: report.report.decisions.automatedDetection,
                decided: report.report.decisions.automatedDecision,
              })}
            </p>
          </section>

          <section aria-labelledby="dsa-appeals" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="dsa-appeals" className={PANEL_H2}>
                {t('dsaReportAppeals')}
              </h2>
            </div>
            <div className={`${STATS} grid-cols-2 md:grid-cols-4`}>
              {stat(t('dsaReportTotal'), report.report.appeals.total)}
              {stat(t('dsaReportReversed'), report.report.appeals.reversedDecisions)}
              {stat(t('dsaReportMedianToDecision'), hours(report.report.appeals.medianHoursToDecision))}
              {stat(t('dsaReportSameReviewer'), report.report.appeals.sameReviewer)}
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {breakdown(t('dsaReportByAppellant'), report.report.appeals.byAppellant, APPELLANT_KEY)}
              {breakdown(t('dsaReportByStatus'), report.report.appeals.byStatus, APPEAL_STATUS_KEY)}
            </div>
            <p className={`${PANEL_P} mt-4`}>
              {t('dsaReportRestorations', {
                total: report.report.restorations.total,
                viaAppeal: report.report.restorations.viaAppeal,
                manual: report.report.restorations.manual,
              })}
            </p>
          </section>

          <section aria-labelledby="dsa-export" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="dsa-export" className={PANEL_H2}>
                {t('dsaReportExport')}
              </h2>
            </div>
            <p className={PANEL_P}>{t('dsaReportExportHint')}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={`/api/admin/dsa-report?${exportQuery}&format=csv`} className={BTN_SECONDARY} download>
                {t('dsaReportExportCsv')}
              </a>
              <a href={`/api/admin/dsa-report?${exportQuery}&format=json`} className={BTN_SECONDARY} download>
                {t('dsaReportExportJson')}
              </a>
            </div>
            <p className="mt-4 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {t('dsaReportLegalPlaceholder')}
            </p>
          </section>
        </>
      )}

      <section aria-labelledby="dsa-retention" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="dsa-retention" className={PANEL_H2}>
            {t('dsaRetentionTitle')}
          </h2>
        </div>
        {retention.status === 'error' ? (
          <AdminLoadError retryHref={`/${locale}${BASE_PATH}?${exportQuery}`} />
        ) : (
          <>
            <p className={PANEL_P}>{t('dsaRetentionHint')}</p>
            <p className={`${PANEL_P} mt-2`}>
              {t('dsaRetentionPolicy', {
                appealDays: retention.overview.appealWindowDays,
                retentionDays: retention.overview.retentionDays,
              })}
            </p>
            <div className={`${STATS} grid-cols-2 md:grid-cols-4`}>
              {stat(t('dsaRetentionEligible'), retention.overview.eligibleCases)}
              {stat(t('dsaRetentionWaiting'), retention.overview.waitingForAppealPath)}
              {stat(
                t('dsaRetentionWithin'),
                retention.overview.withinRetention,
                retention.overview.nextEligibleAt
                  ? t('dsaRetentionNext', { date: formatDate(retention.overview.nextEligibleAt) })
                  : undefined,
              )}
              {stat(t('dsaRetentionRedacted'), retention.overview.redactedCases)}
            </div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">{t('dsaRetentionRuns')}</h3>
            {retention.overview.runs.length === 0 ? (
              <p className={PANEL_P}>{t('dsaRetentionNoRuns')}</p>
            ) : (
              <ul className="space-y-1 text-[13px] text-foreground">
                {retention.overview.runs.map((run) => (
                  <li key={run.id}>
                    <time dateTime={run.runAt}>{formatDate(run.runAt)}</time>
                    {' — '}
                    {t(run.dryRun ? 'dsaRetentionRunDry' : 'dsaRetentionRunReal', { cases: run.cases })}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
