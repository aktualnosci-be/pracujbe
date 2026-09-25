import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import {
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
import {
  aiBudgetLevel,
  aiBudgetPercent,
  createUsdFormatter,
  type AiBudgetLevel,
} from '@/lib/admin/ai-costs';
import type { AiFeatureId } from '@/lib/ai/inventory';
import { getAiCostReport } from '@/lib/data/admin-ai-costs';

/**
 * Panel administratora — koszty AI (#36). Tylko odczyt.
 *
 * Wydatek doby i bieżącego miesiąca (Europe/Brussels) względem globalnego limitu, dzienne
 * agregaty per funkcja AI (wywołania, wyniki, tokeny, koszt) i sumy miesięczne. Dane z
 * `ai_cost_report` (0114) — same liczby, bez treści i identyfikatorów osób/firm. Limity
 * zmienia właściciel w bazie (docs/AI_BUDGET.md); strona nie ma akcji zapisu.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/koszty-ai';

const FEATURE_KEY: Record<AiFeatureId, string> = {
  job_listing_import: 'aiCostsFeatureJobImport',
  content_translation: 'aiCostsFeatureTranslation',
  job_offer_assist: 'aiCostsFeatureAssist',
};

const LEVEL_KEY: Record<AiBudgetLevel, string | null> = {
  ok: null,
  warning: 'aiCostsNearLimit',
  exhausted: 'aiCostsExhausted',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('aiCostsTitle'), robots: { index: false, follow: false } };
}

export default async function AdminAiCostsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const result = await getAiCostReport();
  const usd = createUsdFormatter(locale);
  const dayFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const monthFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' });
  const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
  const num = new Intl.NumberFormat(locale);

  const period = (label: string, p: { spentMicroUsd: number; limitMicroUsd: number | null }) => {
    const level = aiBudgetLevel(p);
    const note = LEVEL_KEY[level];
    return (
      <div className={STAT}>
        <span className={STAT_LABEL}>{label}</span>
        <strong className={STAT_VALUE}>{usd(p.spentMicroUsd)}</strong>
        <small className={STAT_SMALL}>
          {p.limitMicroUsd === null
            ? t('aiCostsNoLimit')
            : t('aiCostsOfLimit', { limit: usd(p.limitMicroUsd), percent: aiBudgetPercent(p) })}
        </small>
        {note ? (
          <small className={`${STAT_SMALL} font-semibold ${level === 'exhausted' ? 'text-error-text' : 'text-foreground'}`}>
            {t(note)}
          </small>
        ) : null}
      </div>
    );
  };

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader eyebrow={t('brandTag')} title={t('aiCostsTitle')} subtitle={t('aiCostsSubtitle')} />

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}`} />
      ) : (
        <>
          <section aria-labelledby="ai-costs-budget" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="ai-costs-budget" className={PANEL_H2}>
                {t('aiCostsBudget')}
              </h2>
            </div>
            <div className={`${STATS} grid-cols-1 sm:grid-cols-2`}>
              {period(t('aiCostsToday'), result.report.status.day)}
              {period(t('aiCostsMonth'), result.report.status.month)}
            </div>
            {result.report.status.staleReservations > 0 ? (
              <p className={`${PANEL_P} mt-4 font-semibold`}>
                {t('aiCostsStale', { count: result.report.status.staleReservations })}
              </p>
            ) : null}
            <p className={`${PANEL_P} mt-4`}>{t('aiCostsHowCounted')}</p>
            <p className={`${PANEL_P} mt-2`}>{t('aiCostsLimitsHint')}</p>
          </section>

          <section aria-labelledby="ai-costs-daily" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="ai-costs-daily" className={PANEL_H2}>
                {t('aiCostsDaily', { days: result.report.days })}
              </h2>
            </div>
            {result.report.daily.length === 0 ? (
              <p className={PANEL_P}>{t('aiCostsNoData')}</p>
            ) : (
              // Lista, nie tabela: przy 320 px i 200% tekstu wiersze zawijają się bez przewijania.
              <ul className="divide-y divide-border border-y border-border text-[13px]">
                {result.report.daily.map((row) => (
                  <li key={`${row.day}-${row.feature}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        <time dateTime={row.day}>{dayFmt.format(asDate(row.day))}</time>
                        {' — '}
                        {t(FEATURE_KEY[row.feature])}
                      </p>
                      <p className="break-words text-muted-foreground">
                        {t('aiCostsRow', {
                          calls: num.format(row.calls),
                          ok: num.format(row.ok),
                          notOk: num.format(row.notOk),
                          open: num.format(row.open),
                          input: num.format(row.inputTokens),
                          output: num.format(row.outputTokens),
                        })}
                      </p>
                    </div>
                    <span className="font-semibold text-foreground">{usd(row.costMicroUsd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ai-costs-monthly" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="ai-costs-monthly" className={PANEL_H2}>
                {t('aiCostsMonthly')}
              </h2>
            </div>
            {result.report.monthly.length === 0 ? (
              <p className={PANEL_P}>{t('aiCostsNoData')}</p>
            ) : (
              <dl className="divide-y divide-border border-y border-border text-[13px]">
                {result.report.monthly.map((row) => (
                  <div key={row.month} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2.5">
                    <dt className="min-w-0 break-words text-muted-foreground">
                      {monthFmt.format(asDate(row.month))}
                      {' — '}
                      {t('aiCostsCalls', { calls: num.format(row.calls) })}
                    </dt>
                    <dd className="font-semibold text-foreground">{usd(row.costMicroUsd)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </>
      )}
    </div>
  );
}
