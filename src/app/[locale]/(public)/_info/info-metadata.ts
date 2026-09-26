import type { Metadata } from 'next';

import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { brandShareImageUrl } from '@/lib/seo/structured-data';

/**
 * Metadane stron informacyjnych z realną treścią (Pomoc, Kontakt — #61): INDEKSOWALNE,
 * kanoniczny URL w bieżącym języku, hreflang dla PL/NL/FR/EN + `x-default`, obraz marki.
 * Strony prawne z treścią placeholder (regulamin, prywatność…) używają nadal
 * `_legal/legal-page.tsx` (`noindex`).
 */
export function buildInfoMetadata({
  locale,
  path,
  title,
  description,
}: {
  locale: string;
  path: string;
  title: string;
  description: string;
}): Metadata {
  const base = env.siteUrl;
  const url = `${base}/${locale}${path}`;
  const shareImage = brandShareImageUrl(base);
  const languages: Record<string, string> = {};
  for (const supported of routing.locales) {
    languages[supported] = `${base}/${supported}${path}`;
  }
  languages['x-default'] = `${base}/${routing.defaultLocale}${path}`;

  return {
    title,
    description,
    alternates: { canonical: url, languages },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Pracuj.be',
      type: 'website',
      locale,
      images: [{ url: shareImage, width: 1200, height: 630, alt: 'Pracuj.be' }],
    },
  };
}
