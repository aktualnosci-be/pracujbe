import type { MetadataRoute } from 'next';

import { env } from '@/lib/env';

/**
 * robots.txt — Pracuj.be.
 *
 * Produkcja: indeksowanie stron publicznych, blokada paneli (candidate/employer/admin)
 * i API, wskazanie sitemap. Środowiska staging/preview (oraz lokalne): pełna blokada
 * indeksowania (`Disallow: /`), aby wersje robocze nie trafiały do wyszukiwarek.
 *
 * Wykrywanie środowiska nieprodukcyjnego: VERCEL_ENV != 'production' lub adres
 * wskazujący localhost/staging/preview (env buduje się leniwie — bez zmiennych działa).
 */

function isNonProduction(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== 'production') return true;
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|staging|preview/i.test(env.siteUrl);
}

export default function robots(): MetadataRoute.Robots {
  const base = env.siteUrl;

  if (isNonProduction()) {
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
