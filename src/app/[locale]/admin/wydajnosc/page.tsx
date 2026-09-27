import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import {
  NOTICE_TEXT,
  PANEL,
  PANEL_H2,
  PANEL_P,
  SECTION_HEAD,
  STAT,
  STAT_LABEL,
  STAT_SMALL,
  STAT_VALUE,
  STATS,
  TABLE_WRAP,
  TEXT_LINK,
  chipClass,
} from '@/components/admin/admin-styles';
import { Alert } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHeader } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { getFieldWebVitals } from '@/lib/data/admin-web-vitals';
import { cn } from '@/lib/utils';
import {
  WEB_VITALS_MIN_SAMPLE,
  WEB_VITALS_PERIODS,
  parseWebVitalsPeriod,
  rateWebVital,
  type WebVitalMetric,
  type WebVitalRating,
  type WebVitalsRow,
} from '@/lib/web-vitals/field-report';

/**
 * Panel administratora — dane polowe Core Web Vitals (tylko odczyt).
 *
 * Źródło: Cloudflare Web Analytics (beacon ładowany wyłącznie po zgodzie analitycznej i tylko
 * na trasach publicznych — Invariant #7). Portal nie zbiera metryk sam; strona czyta agregaty
 * p75 LCP/INP/CLS przez GraphQL Analytics API po stronie serwera (`CF_ANALYTICS_*`). Bez
 * konfiguracji — instrukcja, bez żadnego żądania do Cloudflare.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/wydajnosc';

const RATING_CLASS: Record<WebVitalRating, string> = {
  good: 'text-success-text',
  needsImprovement: 'text-warning-text',
  poor: 'text-error-text',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('webVitalsTitle'), robots: { index: false, follow: false } };
}

export default async function AdminWebVitalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const period = parseWebVitalsPeriod((await searchParams).dni);
  const result = await getFieldWebVitals(period);
  const num = new Intl.NumberFormat(locale);
  const ms = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const cls = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const dayFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  const format = (metric: WebVitalMetric, row: WebVitalsRow): string | null => {
    if (metric === 'cls') return row.cls === null ? null : cls.format(row.cls);
    const value = metric === 'lcp' ? row.lcpMs : row.inpMs;
    return value === null ? null : t('webVitalsMs', { value: ms.format(value) });
  };
  const rawValue = (metric: WebVitalMetric, row: WebVitalsRow) =>
    metric === 'lcp' ? row.lcpMs : metric === 'inp' ? row.inpMs : row.cls;

  // Wartość + ocena słowem (kolor nie jest jedynym nośnikiem informacji, WCAG 1.4.1).
  const cell = (metric: WebVitalMetric, row: WebVitalsRow) => {
    const text = format(metric, row);
    const rating = rateWebVital(metric, rawValue(metric, row));
    if (text === null || rating === null) return <span className="text-muted-foreground">{t('webVitalsNoData')}</span>;
    return (
      <span>
        {text} <span className={cn('font-semibold', RATING_CLASS[rating])}>{t(`webVitalsRating_${rating}`)}</span>
      </span>
    );
  };

  const metrics: { key: WebVitalMetric; label: string; hint: string }[] = [
    { key: 'lcp', label: t('webVitalsLcp'), hint: t('webVitalsLcpHint') },
    { key: 'inp', label: t('webVitalsInp'), hint: t('webVitalsInpHint') },
    { key: 'cls', label: t('webVitalsCls'), hint: t('webVitalsClsHint') },
  ];

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader eyebrow={t('brandTag')} title={t('webVitalsTitle')} subtitle={t('webVitalsSubtitle')} />

      <nav aria-label={t('webVitalsPeriodLabel')} className="flex flex-wrap gap-2">
        {WEB_VITALS_PERIODS.map((days) => (
          <Link
            key={days}
            href={{ pathname: BASE_PATH, query: { dni: String(days) } }}
            aria-current={days === period ? 'page' : undefined}
            className={chipClass(days === period)}
          >
            {t('webVitalsPeriodDays', { count: days })}
          </Link>
        ))}
      </nav>

      {result.status === 'unconfigured' ? (
        <Alert>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{t('webVitalsUnconfiguredTitle')}</p>
            <p className={cn(NOTICE_TEXT, 'mb-0')}>{t('webVitalsUnconfiguredText')}</p>
          </div>
        </Alert>
      ) : result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}?dni=${period}`} />
      ) : (
        <>
          {result.demo ? <Alert>{t('webVitalsDemoNotice')}</Alert> : null}
          <section aria-labelledby="web-vitals-summary" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="web-vitals-summary" className={PANEL_H2}>
                {t('webVitalsSummary')}
              </h2>
              <p className={PANEL_P}>
                {t('webVitalsRange', {
                  from: dayFmt.format(new Date(`${result.report.from}T00:00:00Z`)),
                  to: dayFmt.format(new Date(`${result.report.to}T00:00:00Z`)),
                })}
              </p>
            </div>
            <div className={`${STATS} grid-cols-1 sm:grid-cols-3`}>
              {metrics.map((metric) => (
                <div key={metric.key} className={STAT}>
                  <span className={STAT_LABEL}>{metric.label}</span>
                  <strong className={STAT_VALUE}>{cell(metric.key, result.report.total)}</strong>
                  <small className={STAT_SMALL}>{metric.hint}</small>
                </div>
              ))}
            </div>
            <p className={`${PANEL_P} mt-4`}>
              {t('webVitalsSampleCount', { count: result.report.total.count, formatted: num.format(result.report.total.count) })}
            </p>
            {result.report.total.count < WEB_VITALS_MIN_SAMPLE ? (
              <p className={`${PANEL_P} mt-2 font-semibold`}>{t('webVitalsLowSample', { min: WEB_VITALS_MIN_SAMPLE })}</p>
            ) : null}
          </section>

          <section aria-labelledby="web-vitals-paths" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="web-vitals-paths" className={PANEL_H2}>
                {t('webVitalsPaths')}
              </h2>
            </div>
            {result.report.paths.length === 0 ? (
              <p className={PANEL_P}>{t('webVitalsEmpty')}</p>
            ) : (
              // Przewijany poziomo region musi być osiągalny klawiaturą (axe scrollable-region-focusable).
              <div
                className={cn(TABLE_WRAP, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
                role="region"
                aria-labelledby="web-vitals-paths"
                tabIndex={0}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('webVitalsColPath')}</TableHead>
                      <TableHead>{t('webVitalsColCount')}</TableHead>
                      <TableHead>{t('webVitalsLcp')}</TableHead>
                      <TableHead>{t('webVitalsInp')}</TableHead>
                      <TableHead>{t('webVitalsCls')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.report.paths.map((row) => (
                      <TableRow key={row.path}>
                        <TableRowHeader className="break-all font-mono text-[12px]">{row.path}</TableRowHeader>
                        <TableCell>{num.format(row.count)}</TableCell>
                        <TableCell>{cell('lcp', row)}</TableCell>
                        <TableCell>{cell('inp', row)}</TableCell>
                        <TableCell>{cell('cls', row)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section aria-labelledby="web-vitals-about" className={PANEL}>
            <h2 id="web-vitals-about" className={PANEL_H2}>
              {t('webVitalsAbout')}
            </h2>
            <p className={`${PANEL_P} mt-3`}>{t('webVitalsAboutConsent')}</p>
            <p className={`${PANEL_P} mt-2`}>{t('webVitalsAboutSampling')}</p>
            <p className={`${PANEL_P} mt-2`}>{t('webVitalsAboutThresholds')}</p>
            {result.accountId ? (
              <p className="mt-3">
                <a
                  href={`https://dash.cloudflare.com/${result.accountId}/web-analytics`}
                  className={TEXT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('webVitalsOpenCloudflare')}
                </a>
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
