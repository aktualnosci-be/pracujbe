import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import {
  INFO_LABEL,
  INFO_PAIRS,
  INFO_VALUE,
  PANEL,
  PANEL_H2,
  PANEL_P,
  ROW,
  ROW_META,
  ROW_TITLE,
  STATUS,
  STATUS_GOOD,
  TAG,
  TEXT_LINK,
} from '@/components/admin/admin-styles';
import { Alert } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';
import { getRetentionOverview, type RetentionPolicyRow } from '@/lib/data/admin-retention';
import { createAppDateFormatter } from '@/lib/datetime';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — przegląd retencji danych (#486/#574). TYLKO ODCZYT.
 *
 * Okresy z `retention_policies` (0105/0127/0132) z opisem kategorii, kto egzekwuje termin
 * (zadanie `run_retention_purge`, czujka, infrastruktura, brak zadania), ostatnia zmiana
 * z dziennika (`retention.policy_changed`) oraz tryby zadań crona `/api/maintenance`
 * (`RETENTION_MODE`, `DSA_RETENTION_MODE`, `STORAGE_GC_MODE`). Strona nie zmienia okresów ani
 * trybów — to decyzja administratora danych (#574). Odczyt service-rolem po `requireAdmin`.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/ustawienia/retencja';

/** Tryb z env → klucz i18n (`adminRetention.mode.*`). */
const MODE_KEY = { off: 'off', 'dry-run': 'dryRun', apply: 'apply' } as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminRetention' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function AdminRetentionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'adminRetention' });
  const result = await getRetentionOverview();
  const formatDate = createAppDateFormatter(locale, { withTime: true });

  const days = (value: number | null) => (value === null ? t('periodOff') : t('days', { count: value }));

  const categoryLabel = (key: string) => (t.has(`keys.${key}.label`) ? t(`keys.${key}.label`) : key);
  const categoryDescription = (key: string) =>
    t.has(`keys.${key}.description`) ? t(`keys.${key}.description`) : t('unknownCategory');

  const renderPolicy = (policy: RetentionPolicyRow) => {
    const headingId = `retention-${policy.key}`;
    return (
      <li key={policy.key} className={ROW}>
        <article aria-labelledby={headingId} className="min-w-0 flex-1">
          <h3 id={headingId} className={ROW_TITLE}>
            {categoryLabel(policy.key)}
          </h3>
          <p className={ROW_META}>{categoryDescription(policy.key)}</p>
          <dl className={INFO_PAIRS}>
            <div>
              <dt className={INFO_LABEL}>{t('fieldPeriod')}</dt>
              <dd className={INFO_VALUE}>{days(policy.periodDays)}</dd>
            </div>
            {policy.warningDays !== null ? (
              <div>
                <dt className={INFO_LABEL}>{t('fieldWarning')}</dt>
                <dd className={INFO_VALUE}>{t('days', { count: policy.warningDays })}</dd>
              </div>
            ) : null}
            <div>
              <dt className={INFO_LABEL}>{t('fieldEnforcement')}</dt>
              <dd>
                <span className={TAG}>{t(`enforcement.${policy.enforcement}`)}</span>
              </dd>
            </div>
            <div>
              <dt className={INFO_LABEL}>{t('fieldLastChange')}</dt>
              <dd className={INFO_VALUE}>
                {policy.lastChange
                  ? t('lastChangeValue', {
                      date: formatDate(policy.lastChange.createdAt),
                      actor: policy.lastChange.actorName ?? t('actorUnknown'),
                      from: days(policy.lastChange.beforeDays),
                      to: days(policy.lastChange.afterDays),
                    })
                  : policy.updatedAt
                    ? t('updatedValue', { date: formatDate(policy.updatedAt) })
                    : t('lastChangeNone')}
              </dd>
            </div>
          </dl>
        </article>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('title')} subtitle={t('subtitle')} />

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}`} />
      ) : (
        <>
          {result.demo ? <Alert>{t('demoNotice')}</Alert> : null}

          <section className={PANEL} aria-labelledby="retention-modes">
            <h2 id="retention-modes" className={PANEL_H2}>
              {t('modesTitle')}
            </h2>
            <p className={cn(PANEL_P, 'mt-2')}>{t('modesHint')}</p>
            <dl className={INFO_PAIRS}>
              <div>
                <dt className={INFO_LABEL}>{t('modeRetention')}</dt>
                <dd>
                  <span className={result.modes.retention === 'off' ? STATUS : STATUS_GOOD}>
                    {t(`mode.${MODE_KEY[result.modes.retention]}`)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className={INFO_LABEL}>{t('modeDsaRetention')}</dt>
                <dd>
                  <span className={result.modes.dsaRetention === 'off' ? STATUS : STATUS_GOOD}>
                    {t(`mode.${MODE_KEY[result.modes.dsaRetention]}`)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className={INFO_LABEL}>{t('modeStorageGc')}</dt>
                <dd>
                  <span className={result.modes.storageGc === 'dry-run' ? STATUS : STATUS_GOOD}>
                    {t(result.modes.storageGc === 'delete' ? 'storageGcDelete' : 'storageGcDryRun')}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className={PANEL} aria-labelledby="retention-policies">
            <h2 id="retention-policies" className={PANEL_H2}>
              {t('policiesTitle')}
            </h2>
            <p className={cn(PANEL_P, 'mt-2')}>{t('policiesHint')}</p>
            {result.policies.length === 0 ? (
              <p className={cn(PANEL_P, 'mt-6')}>{t('policiesEmpty')}</p>
            ) : (
              <ul className="mt-6">{result.policies.map(renderPolicy)}</ul>
            )}
            <p className="mt-4">
              <Link href="/admin/dziennik?entity=retention_policy" className={TEXT_LINK}>
                {t('auditLink')}
              </Link>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
