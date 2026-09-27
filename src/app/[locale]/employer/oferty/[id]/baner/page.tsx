import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isLocale, type Locale } from '@/i18n/routing';
import { CampaignBannerView } from '@/components/employer/CampaignBannerView';
import { isCampaignJobId, loadManagedCampaignJob, type CampaignJobLoad } from '@/lib/campaign-banner/source';
import { getPortalIdentity, isPortalDataConfigured } from '@/lib/db/portal';

/**
 * Baner kampanii z oferty (#175) — `/employer/oferty/[id]/baner?jezyk=pl|nl|fr|en`.
 *
 * Dane wyłącznie z `get_managed_campaign_job` (0102, #186) pod sesją: tylko aktywna, niewygasła,
 * niedemonstracyjna oferta zweryfikowanej firmy, tylko dla recruiter+ tej firmy albo admina;
 * każdy inny przypadek = ten sam komunikat „baner niedostępny”. Tryb demo (bez bazy) nie
 * eksportuje danych demonstracyjnych. Podgląd i pobranie idą przez
 * `/api/employer/jobs/[id]/banner` (limit, noindex, no-store). Nic nie jest publikowane.
 *
 * Guard sesji + aktywnego członkostwa dziedziczony z layoutu `employer/*`. NOINDEX, force-dynamic.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'campaignBanner' });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

export default async function CampaignBannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ jezyk?: string }>;
}) {
  const { locale, id } = await params;
  const { jezyk } = await searchParams;
  setRequestLocale(locale);
  const bannerLocale: Locale = isLocale(jezyk) ? jezyk : isLocale(locale) ? locale : 'pl';
  const t = await getTranslations('campaignBanner');
  const td = await getTranslations('dashboard');

  let loaded: CampaignJobLoad = { status: 'unavailable' };
  if (isPortalDataConfigured() && isCampaignJobId(id)) {
    try {
      const me = await getPortalIdentity();
      if (me) loaded = await loadManagedCampaignJob(me, id, bannerLocale);
    } catch {
      loaded = { status: 'error' };
    }
  }

  return (
    <CampaignBannerView
      locale={locale}
      jobId={id}
      bannerLocale={bannerLocale}
      loaded={loaded}
      pagePath={`/employer/oferty/${id}/baner`}
      eyebrow={td('employerRole')}
      backHref="/employer/oferty"
      backLabel={t('backToOffers')}
      unavailableHint={t('unavailableHint')}
      retryLabel={td('employerOffersRetry')}
    />
  );
}
