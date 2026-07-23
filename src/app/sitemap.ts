import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { getJobs, type CategoryKey, type LocationKey } from '@/lib/jobs';

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

/** Publiczne strony statyczne (segment bez prefiksu języka). '' = strona główna. */
const STATIC_PATHS: readonly string[] = [
  '',
  JOBS_PATH,
  '/how-it-works',
  '/for-employers',
  '/guides',
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

/** Buduje mapę hreflang { locale -> absolutny URL } dla ścieżki (opcjonalnie zależnej od języka). */
function buildLanguages(
  base: string,
  locales: readonly string[],
  pathForLocale: (locale: string) => string,
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[locale] = `${base}${pathForLocale(locale)}`;
  }
  return languages;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
        lastModified: now,
        changeFrequency: path === '' ? 'daily' : 'weekly',
        priority: path === '' ? 1 : path === JOBS_PATH ? 0.9 : 0.6,
        alternates: { languages },
      });
    }
  }

  // --- Landing-page'e kategorii (?category=<klucz> — klucz stabilny między językami) ---
  for (const key of CATEGORY_KEYS) {
    const path = `${JOBS_PATH}?category=${key}`;
    const languages = buildLanguages(base, locales, (locale) => `/${locale}${path}`);
    for (const locale of locales) {
      entries.push({
        url: `${base}/${locale}${path}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.6,
        alternates: { languages },
      });
    }
  }

  // --- Landing-page'e lokalizacji (?city=<nazwa lokalna> — różna per język) ---
  const translators = await Promise.all(
    locales.map(async (locale) => ({
      locale,
      t: await getTranslations({ locale, namespace: 'locations' }),
    })),
  );

  for (const key of LOCATION_KEYS) {
    const languages: Record<string, string> = {};
    for (const { locale, t } of translators) {
      languages[locale] = `${base}/${locale}${JOBS_PATH}?city=${encodeURIComponent(t(key))}`;
    }
    for (const { locale, t } of translators) {
      entries.push({
        url: `${base}/${locale}${JOBS_PATH}?city=${encodeURIComponent(t(key))}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages },
      });
    }
  }

  // --- Szczegóły ofert ---
  const result = await getJobs({ locale: routing.defaultLocale, page: 1, pageSize: 1000 });
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

  return entries;
}
