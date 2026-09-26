import type { MetadataRoute } from 'next';

import { env, isProductionDeployment } from '@/lib/env';
import { generateSitemaps } from './sitemap';

/**
 * robots.txt — Pracuj.be.
 *
 * Produkcja: indeksowanie stron publicznych, blokada paneli (candidate/employer/admin)
 * i API, wskazanie WSZYSTKICH plików sitemap. Środowiska staging/preview (oraz lokalne):
 * pełna blokada indeksowania (`Disallow: /`), aby wersje robocze nie trafiały do wyszukiwarek.
 *
 * Wykrywanie środowiska: JEDNO źródło prawdy `isProductionDeployment()` (P1-19) —
 * spójne z nagłówkami (next.config.mjs) i sitemap.
 *
 * Sitemap index (#599): `sitemap.ts` dzieli katalog na `generateSitemaps()` plików
 * (`/sitemap/<id>.xml`, konwencja Next.js) zamiast jednego, ucinanego pliku. `robots.txt`
 * wskazuje KAŻDY z nich osobno (protokół dopuszcza wiele linii `Sitemap:`) — te same
 * identyfikatory, które serwuje sitemap.
 */

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = env.siteUrl;

  if (!isProductionDeployment()) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  const sitemaps = await generateSitemaps();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/*/candidate', '/*/employer', '/*/admin'],
    },
    sitemap: sitemaps.map(({ id }) => `${base}/sitemap/${id}.xml`),
    host: base,
  };
}
