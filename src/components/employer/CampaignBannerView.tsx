import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { BannerPngButton } from '@/components/employer/BannerPngButton';
import {
  BTN_SECONDARY,
  EYEBROW,
  H1_EXTENDED,
  INTRO,
  PANEL,
  PANEL_H2,
  PANEL_P,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { BANNER_FORMATS, bannerJobUrl, bannerSize } from '@/lib/campaign-banner/render';
import type { CampaignJobLoad } from '@/lib/campaign-banner/source';

/**
 * Widok generatora baneru kampanii (#175) — wspólny dla panelu pracodawcy
 * (`/employer/oferty/[id]/baner`) i panelu administratora (`/admin/oferty/[id]/baner`).
 *
 * Strona ładuje dane (`loadManagedCampaignJob` pod sesją) i sama pilnuje dostępu; widok tylko
 * renderuje podgląd, wybór języka i pobieranie przez `/api/employer/jobs/[id]/banner`
 * (endpoint dopuszcza recruiter+ firmy oferty albo admina — egzekwuje baza, 0102).
 */
export async function CampaignBannerView({
  locale,
  jobId,
  bannerLocale,
  loaded,
  pagePath,
  query = {},
  eyebrow,
  backHref,
  backLabel,
  unavailableHint,
  retryLabel,
}: {
  locale: string;
  jobId: string;
  bannerLocale: Locale;
  loaded: CampaignJobLoad;
  /** Ścieżka strony bez prefiksu języka, np. `/employer/oferty/<id>/baner`. */
  pagePath: string;
  /** Dodatkowe parametry zachowywane w linkach wyboru języka i ponowienia. */
  query?: Record<string, string>;
  eyebrow: string;
  backHref: string;
  backLabel: string;
  unavailableHint: string;
  retryLabel: string;
}) {
  const t = await getTranslations('campaignBanner');

  const hrefFor = (code: Locale) => {
    const params = new URLSearchParams({ ...query, jezyk: code });
    return `${pagePath}?${params.toString()}`;
  };

  const header = (
    <header>
      <p className={EYEBROW}>{eyebrow}</p>
      <h1 className={H1_EXTENDED}>{t('pageTitle')}</h1>
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
            {loaded.status === 'error' ? t('loadErrorHint') : unavailableHint}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {loaded.status === 'error' ? (
              <a className={BTN_SECONDARY} href={`/${locale}${hrefFor(bannerLocale)}`}>
                {retryLabel}
              </a>
            ) : null}
            <Link className={BTN_SECONDARY} href={backHref}>
              {backLabel}
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
            href={hrefFor(code)}
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
        const src = `/api/employer/jobs/${jobId}/banner?format=${format}&locale=${bannerLocale}`;
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
