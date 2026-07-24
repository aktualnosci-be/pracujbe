import type { MetadataRoute } from 'next';

import { env, isProductionDeployment } from '@/lib/env';

/**
 * robots.txt — Pracuj.be.
 *
 * Produkcja: indeksowanie stron publicznych, blokada paneli (candidate/employer/admin)
 * i API, wskazanie sitemap. Środowiska staging/preview (oraz lokalne): pełna blokada
 * indeksowania (`Disallow: /`), aby wersje robocze nie trafiały do wyszukiwarek.
 *
 * Wykrywanie środowiska: JEDNO źródło prawdy `isProductionDeployment()` (P1-19) —
 * spójne z nagłówkami (next.config.mjs) i sitemap.
 */

export default function robots(): MetadataRoute.Robots {
  const base = env.siteUrl;

  if (!isProductionDeployment()) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/*/candidate', '/*/employer', '/*/admin'],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
