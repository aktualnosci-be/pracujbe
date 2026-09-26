import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CANDIDATE_ADULT_AGE } from '@/lib/age-policy/constants';
import { getAgePolicySettings } from '@/lib/data/admin-age-policy';
import { createAppDateFormatter } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import { AgePolicyForm } from '@/components/admin/AgePolicyForm';
import {
  INFO_LABEL,
  INFO_PAIRS,
  INFO_VALUE,
  PANEL,
  PANEL_H2,
  PANEL_P,
  STATUS,
  STATUS_GOOD,
} from '@/components/admin/admin-styles';

/**
 * Panel administratora — próg wieku kandydatów (#492, #576).
 *
 * Pokazuje bieżący próg konta (16/18), status zatwierdzenia i ostatnią zmianę z dziennika
 * zdarzeń (`age_policy.updated`), oraz formularz zmiany (RPC `admin_set_candidate_min_age`,
 * migracja 0126). Odczyt service-rolem po potwierdzeniu roli admina
 * (`getAgePolicySettings` → `requireAdmin`). Tylko etykiety funkcji — bez treści prawnej
 * (`docs/legal-drafts/kandydaci-niepelnoletni.md` czeka na zatwierdzenie właściciela).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/ustawienia';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('agePolicyTitle'), robots: { index: false, follow: false } };
}

export default async function AdminAgePolicyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const result = await getAgePolicySettings();
  const formatDate = createAppDateFormatter(locale, { withTime: true });

  const ageLabel = (age: number) => (age === CANDIDATE_ADULT_AGE ? t('agePolicyOption18') : t('agePolicyOption16'));

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('agePolicyTitle')} subtitle={t('agePolicySubtitle')} />

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}`} />
      ) : (
        <>
          <section className={PANEL}>
            <h2 className={PANEL_H2}>{t('agePolicyCurrentTitle')}</h2>
            <div className={INFO_PAIRS}>
              <div>
                <small className={INFO_LABEL}>{t('agePolicyCurrentLabel')}</small>
                <strong className={INFO_VALUE}>{ageLabel(result.minAge)}</strong>
              </div>
              <div>
                <small className={INFO_LABEL}>{t('agePolicyConfirmedField')}</small>
                <span className={result.confirmed ? STATUS_GOOD : STATUS}>
                  {result.confirmed ? t('agePolicyConfirmedYes') : t('agePolicyConfirmedNo')}
                </span>
              </div>
            </div>
            {result.reason ? (
              <p className={cn(PANEL_P, 'whitespace-pre-wrap break-words')}>{result.reason}</p>
            ) : null}
          </section>

          <section className={PANEL}>
            <h2 className={PANEL_H2}>{t('agePolicyLastChangeTitle')}</h2>
            {result.lastChange ? (
              <>
                <div className={INFO_PAIRS}>
                  <div>
                    <small className={INFO_LABEL}>{t('agePolicyLastChangeTransition')}</small>
                    <strong className={INFO_VALUE}>
                      {result.lastChange.beforeMinAge !== null
                        ? t('agePolicyTransitionValue', {
                            from: ageLabel(result.lastChange.beforeMinAge),
                            to: ageLabel(result.lastChange.afterMinAge),
                          })
                        : ageLabel(result.lastChange.afterMinAge)}
                    </strong>
                  </div>
                  <div>
                    <small className={INFO_LABEL}>{t('agePolicyLastChangeAt')}</small>
                    <strong className={INFO_VALUE}>{formatDate(result.lastChange.createdAt)}</strong>
                  </div>
                  <div>
                    <small className={INFO_LABEL}>{t('agePolicyLastChangeBy')}</small>
                    <strong className={INFO_VALUE}>{result.lastChange.actorName ?? t('adminName')}</strong>
                  </div>
                  {result.lastChange.hiddenProfiles > 0 ? (
                    <div>
                      <small className={INFO_LABEL}>{t('agePolicyLastChangeHidden')}</small>
                      <strong className={INFO_VALUE}>{result.lastChange.hiddenProfiles}</strong>
                    </div>
                  ) : null}
                </div>
                {result.lastChange.reason ? (
                  <p className={cn(PANEL_P, 'whitespace-pre-wrap break-words')}>{result.lastChange.reason}</p>
                ) : null}
              </>
            ) : (
              <p className={PANEL_P}>{t('agePolicyLastChangeNone')}</p>
            )}
          </section>

          <AgePolicyForm minAge={result.minAge} confirmed={result.confirmed} />
        </>
      )}
    </div>
  );
}
