import type { Metadata } from 'next';

import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { openGraphLocales } from '@/lib/seo/locales';
import { brandShareImageUrl } from '@/lib/seo/structured-data';

export { NAVIGATOR_PATH } from '@/lib/guides/start-navigator';

/** Metadane stron nawigatora: canonical + hreflang (ten sam segment w każdym języku), OG. */
export function navigatorMetadata(
  locale: string,
  path: string,
  title: string,
  description: string,
): Metadata {
  const base = env.siteUrl;
  const url = `${base}/${locale}${path}`;
  const shareImage = brandShareImageUrl(base);
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${path}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${path}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url, languages },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Pracuj.be',
      type: 'website',
      ...openGraphLocales(locale),
      images: [{ url: shareImage, width: 1200, height: 630, alt: 'Pracuj.be' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [shareImage] },
  };
}
