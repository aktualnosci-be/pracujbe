import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isLocale, type Locale } from '@/i18n/routing';
import { CampaignBannerView } from '@/components/employer/CampaignBannerView';
import { adminBannerBackHref, parseAdminBannerCompany } from '@/lib/admin/campaign-banner-link';
import { isCampaignJobId, loadManagedCampaignJob, type CampaignJobLoad } from '@/lib/campaign-banner/source';
import { requireAdmin } from '@/lib/data/admin';
import { getPortalIdentity, isPortalDataConfigured } from '@/lib/db/portal';

/**
 * Baner kampanii z oferty w panelu administratora — `/admin/oferty/[id]/baner?jezyk=…&firma=…`.
 *
 * Strona pracodawcy (`/employer/oferty/[id]/baner`) jest zablokowana layoutem `employer/*`
 * dla konta bez aktywnego członkostwa w firmie, więc admin dostaje własną trasę z tym samym
 * widokiem (`CampaignBannerView`) i tym samym endpointem `/api/employer/jobs/[id]/banner`
 * (dostęp admina egzekwuje baza: `get_managed_campaign_job`, 0102). Filtry oferty jak dla
 * pracodawcy: tylko aktywna, niewygasła, niedemonstracyjna oferta zweryfikowanej firmy —
 * inaczej ten sam komunikat „baner niedostępny”. Tryb demo (bez bazy) niczego nie eksportuje.
 *
 * Guard: layout `admin/*` (rola admin, inaczej 404) + `requireAdmin()` przed odczytem (też
 * 404). `firma` = powrót do szczegółu firmy. NOINDEX, force-dynamic.
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

export default async function AdminCampaignBannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ jezyk?: string; firma?: string }>;
}) {
  const { locale, id } = await params;
  const { jezyk, firma } = await searchParams;
  setRequestLocale(locale);
  const bannerLocale: Locale = isLocale(jezyk) ? jezyk : isLocale(locale) ? locale : 'pl';
  const companyId = parseAdminBannerCompany(firma);
  const t = await getTranslations('campaignBanner');
  const ta = await getTranslations('admin');

  let loaded: CampaignJobLoad = { status: 'unavailable' };
  if (isPortalDataConfigured()) {
    // Niezależnie od layoutu: nie-admin = 404 (nie ujawniamy trasy ani oferty).
    await requireAdmin();
    if (isCampaignJobId(id)) {
      try {
        const me = await getPortalIdentity();
        if (me) loaded = await loadManagedCampaignJob(me, id, bannerLocale);
      } catch {
        loaded = { status: 'error' };
      }
    }
  }

  return (
    <CampaignBannerView
      locale={locale}
      jobId={id}
      bannerLocale={bannerLocale}
      loaded={loaded}
      pagePath={`/admin/oferty/${encodeURIComponent(id)}/baner`}
      query={companyId ? { firma: companyId } : {}}
      eyebrow={ta('targetJob')}
      backHref={adminBannerBackHref(companyId)}
      backLabel={companyId ? t('backToCompany') : ta('backToCompanies')}
      unavailableHint={t('unavailableHintAdmin')}
      retryLabel={ta('loadErrorRetry')}
    />
  );
}
