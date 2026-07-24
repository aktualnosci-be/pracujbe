import type { MetadataRoute } from 'next';

import { routing } from '@/i18n/routing';
import { env, isProductionDeployment } from '@/lib/env';
import { getJobs, type CategoryKey, type LocationKey } from '@/lib/jobs';
import { getAllGuideSlugs } from '@/lib/guides/guides';

/**
 * Mapa strony (sitemap.xml) — Pracuj.be.
 *
 * Zawiera: publiczne strony statyczne, listę ofert, szczegóły ofert (z `getJobs`)
 * oraz landing-page'e kategorii i lokalizacji (filtrowane widoki listy). Każdy wpis
 * ma alternatywy językowe (hreflang). Panele (candidate/employer/admin) i API są
 * celowo pominięte (patrz robots.ts). Działa bez env (dane demonstracyjne z `getJobs`).
 *
 * TODO(i18n-slugs): segment listy ofert jest wspólny (`oferty-pracy`) — po wdrożeniu
 * lokalizowanych slugów zaktualizować ścieżki per język.
 */

const JOBS_PATH = '/oferty-pracy';
const HUB_PATH = '/praca';
const GUIDES_PATH = '/poradniki';

/** Publiczne strony statyczne (segment bez prefiksu języka). '' = strona główna.
 *  Tylko trasy zwracające 200 (zweryfikowane smoke) i z REALNĄ treścią.
 *  Strony prawne/informacyjne (regulamin, prywatność, cookies, o-nas, faq, kontakt, pomoc)
 *  mają obecnie treść placeholder → są `noindex` i CELOWO poza sitemap (audyt FUN-09).
 *  Po zatwierdzeniu treści dodać je tu z powrotem i zdjąć `noindex` w `_legal/legal-page.tsx`. */
const STATIC_PATHS: readonly string[] = [
  '',
  JOBS_PATH,
  HUB_PATH,
  GUIDES_PATH,
];

const CATEGORY_KEYS: readonly CategoryKey[] = [
  'construction',
  'transport',
  'warehouse',
  'production',
  'technical',
  'cleaning',
  'hospitality',
  'care',
  'logistics',
  'seasonal',
];

const LOCATION_KEYS: readonly LocationKey[] = [
  'brussels',
  'antwerp',
  'ghent',
  'leuven',
  'mechelen',
  'hasselt',
  'liege',
  'charleroi',
  'bruges',
  'kortrijk',
];

/** Buduje mapę hreflang { locale -> absolutny URL } dla ścieżki (opcjonalnie zależnej od języka).
 *  Dodaje wpis `x-default` wskazujący na język domyślny — spójnie z hreflang stron. */
function buildLanguages(
  base: string,
  locales: readonly string[],
  pathForLocale: (locale: string) => string,
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[locale] = `${base}${pathForLocale(locale)}`;
  }
  languages['x-default'] = `${base}${pathForLocale(routing.defaultLocale)}`;
  return languages;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Staging/preview/local: pusty sitemap (spójne z robots.ts Disallow:/ i X-Robots-Tag).
  // JEDNO źródło prawdy o środowisku (P1-19): isProductionDeployment().
  if (!isProductionDeployment()) return [];

  const base = env.siteUrl;
  const locales = routing.locales;
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  // --- Strony statyczne ---
  for (const path of STATIC_PATHS) {
    const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: path === '' ? 'daily' : 'weekly',
        priority: path === '' ? 1 : path === JOBS_PATH ? 0.9 : 0.6,
        alternates: { languages },
      });
    }
  }

  // --- Landing-page'e kategorii (dedykowana trasa /praca/kategoria/<klucz>, slug stabilny) ---
  for (const key of CATEGORY_KEYS) {
    const path = `${HUB_PATH}/kategoria/${key}`;
    const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: 'weekly',
        priority: 0.6,
        alternates: { languages },
      });
    }
  }

  // --- Landing-page'e miast (dedykowana trasa /praca/miasto/<slug>, slug stabilny) ---
  for (const key of LOCATION_KEYS) {
    const path = `${HUB_PATH}/miasto/${key}`;
    const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages },
      });
    }
  }

  // --- Poradniki (blog) ---
  for (const slug of getAllGuideSlugs()) {
    const path = `${GUIDES_PATH}/${slug}`;
    const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: 'monthly',
        priority: 0.5,
        alternates: { languages },
      });
    }
  }

  // --- Szczegóły ofert (P1-13: paginacja — get_public_jobs klampuje limit do 100/stronę,
  // więc iterujemy stronami do rozsądnego sufitu, zamiast brać tylko pierwszą setkę). ---
  const SITEMAP_PAGE = 100;
  const SITEMAP_MAX_JOBS = 5000; // sufit anty-abuse; powyżej rozważ sitemap index
  for (let page = 1; entries.length < SITEMAP_MAX_JOBS * locales.length; page += 1) {
    const result = await getJobs({ locale: routing.defaultLocale, page, pageSize: SITEMAP_PAGE });
    if (result.jobs.length === 0) break;
    for (const job of result.jobs) {
      const path = `${JOBS_PATH}/${job.slug}`;
      const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
      const publishedTs = Date.parse(job.publishedAt);
      const lastModified = Number.isNaN(publishedTs) ? now : new Date(publishedTs);
      for (const locale of locales) {
        entries.push({
          url: `${base}/${locale}${path}`,
          lastModified,
          changeFrequency: 'daily',
          priority: 0.8,
          alternates: { languages },
        });
      }
    }
    if (result.jobs.length < SITEMAP_PAGE) break; // ostatnia strona
    if (page * SITEMAP_PAGE >= SITEMAP_MAX_JOBS) break;
  }

  return entries;
}
