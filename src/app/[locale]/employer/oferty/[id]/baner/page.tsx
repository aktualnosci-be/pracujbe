import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { isLocale, routing, type Locale } from '@/i18n/routing';
import { BannerPngButton } from '@/components/employer/BannerPngButton';
import {
  BTN_SECONDARY,
  EYEBROW,
  H1,
  INTRO,
  PANEL,
  PANEL_H2,
  PANEL_P,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { BANNER_FORMATS, bannerJobUrl, bannerSize } from '@/lib/campaign-banner/render';
import { isCampaignJobId, loadManagedCampaignJob, type CampaignJobLoad } from '@/lib/campaign-banner/source';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Baner kampanii z oferty (#175) — `/employer/oferty/[id]/baner?jezyk=pl|nl|fr|en`.
 *
 * Dane wyłącznie z `get_managed_campaign_job` (0099, #186) pod sesją: tylko aktywna, niewygasła,
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
  if (isSupabaseConfigured() && isCampaignJobId(id)) {
    try {
      loaded = await loadManagedCampaignJob(await createServerClient(), id, bannerLocale);
    } catch {
      loaded = { status: 'error' };
    }
  }

  const header = (
    <header>
      <p className={EYEBROW}>{td('employerRole')}</p>
      <h1 className={H1}>{t('pageTitle')}</h1>
      <p className={INTRO}>{t('intro')}</p>
    </header>
  );

  if (loaded.status !== 'ok') {
    return (
      <div className="space-y-7">
        {header}
        <section role={loaded.status === 'error' ? 'alert' : undefined} className={PANEL}>
          <h2 className={PANEL_H2}>
            {loaded.status === 'error' ? t('loadError') : t('unavailableTitle')}
          </h2>
          <p className={`mt-2 ${PANEL_P}`}>
            {loaded.status === 'error' ? t('loadErrorHint') : t('unavailableHint')}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {loaded.status === 'error' ? (
              <a className={BTN_SECONDARY} href={`/${locale}/employer/oferty/${id}/baner?jezyk=${bannerLocale}`}>
                {td('employerOffersRetry')}
              </a>
            ) : null}
            <Link className={BTN_SECONDARY} href="/employer/oferty">
              {t('backToOffers')}
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const { job } = loaded;
  const jobUrl = bannerJobUrl(job.slug, bannerLocale);
  const pngLabels = { download: t('downloadPng'), pending: t('downloadPngPending'), error: t('downloadPngError') };

  return (
    <div className="space-y-7">
      {header}
      <nav aria-label={t('languageLabel')} className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{t('languageLabel')}</span>
        {routing.locales.map((code) => (
          <Link
            key={code}
            href={`/employer/oferty/${id}/baner?jezyk=${code}`}
            aria-current={code === bannerLocale ? 'true' : undefined}
            className={`${TEXT_LINK} min-h-11 min-w-11 justify-center uppercase ${code === bannerLocale ? 'underline' : ''}`}
          >
            {code}
          </Link>
        ))}
      </nav>
      <p className={`${PANEL_P} break-words`}>{t('linkNote', { url: jobUrl })}</p>
      {BANNER_FORMATS.map((format) => {
        const { width, height } = bannerSize(format);
        const src = `/api/employer/jobs/${id}/banner?format=${format}&locale=${bannerLocale}`;
        const name = t('formatHeading', { width, height });
        return (
          <section key={format} className={PANEL} aria-labelledby={`banner-${format}`}>
            <h2 id={`banner-${format}`} className={PANEL_H2}>
              {name}
            </h2>
            <div className="mt-4 overflow-hidden rounded-[11px] border border-border bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG z endpointu pod sesją, bez optymalizatora */}
              <img
                src={src}
                width={width}
                height={height}
                alt={t('previewAlt', { width, height, title: job.title })}
                className="block h-auto max-w-full"
                loading="lazy"
              />
            </div>
            <div className="mt-4 flex flex-wrap items-start gap-3">
              <a className={BTN_SECONDARY} href={`${src}&download=1`} download aria-label={`${t('downloadSvg')} — ${name}`}>
                {t('downloadSvg')}
              </a>
              <BannerPngButton
                src={src}
                filename={`pracujbe-${job.slug}-${bannerLocale}-${format}.png`}
                width={width}
                height={height}
                labels={{ ...pngLabels, name }}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
