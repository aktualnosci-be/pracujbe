import type { MetadataRoute } from 'next';

import { routing } from '@/i18n/routing';
import { env, isProductionDeployment } from '@/lib/env';
import {
  getCategoryCounts,
  getCityCounts,
  getJobs,
  getJobsAvailableLocales,
  type CategoryKey,
  type LocationKey,
} from '@/lib/jobs';
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
const EMPLOYERS_PATH = '/dla-pracodawcow';
const HELP_PATH = '/pomoc';
const CONTACT_PATH = '/kontakt';

/** Publiczne strony statyczne (segment bez prefiksu języka). '' = strona główna.
 *  Tylko trasy zwracające 200 (zweryfikowane smoke) i z REALNĄ treścią.
 *  Pomoc i Kontakt (#61) mają realną treść (FAQ z faktów produktu, formularz kontaktu).
 *  Strony prawne/informacyjne (regulamin, prywatność, cookies, o-nas, faq) mają obecnie treść
 *  placeholder → są `noindex` i CELOWO poza sitemap (audyt FUN-09).
 *  Po zatwierdzeniu treści dodać je tu z powrotem i zdjąć `noindex` w `_legal/legal-page.tsx`. */
const STATIC_PATHS: readonly string[] = [
  '',
  JOBS_PATH,
  HUB_PATH,
  GUIDES_PATH,
  EMPLOYERS_PATH,
  HELP_PATH,
  CONTACT_PATH,
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
  const xDefault = locales.includes(routing.defaultLocale) ? routing.defaultLocale : locales[0];
  if (xDefault) languages['x-default'] = `${base}${pathForLocale(xDefault)}`;
  return languages;
}

/**
 * Języki, w których landing ma ≥1 ofertę (#299). Liczniki używają tego samego filtra co strona
 * (kategoria; miasto po kluczu i wszystkich jego nazwach — #189), więc sitemap nie zgłasza pustych landingów,
 * które same mają `noindex`. `null` z licznika = błąd odczytu: sitemap nie może zgadywać.
 */
async function nonEmptyLandingLocales(
  locales: readonly string[],
): Promise<{ categories: Map<string, string[]>; cities: Map<string, string[]> }> {
  const categoryCounts = await getCategoryCounts(routing.defaultLocale, CATEGORY_KEYS);
  if (!categoryCounts) throw new Error('sitemap: brak liczników kategorii');
  const categories = new Map<string, string[]>();
  for (const key of CATEGORY_KEYS) {
    categories.set(key, (categoryCounts[key] ?? 0) > 0 ? [...locales] : []);
  }

  // #189: licznik per klucz miasta (wszystkie nazwy PL/NL/FR/EN) — landing ma te same oferty
  // w każdym języku, więc jest pusty albo niepusty jednocześnie we wszystkich wersjach.
  const cityCounts = await getCityCounts(routing.defaultLocale, LOCATION_KEYS);
  if (!cityCounts) throw new Error('sitemap: brak liczników miast');
  const cities = new Map<string, string[]>();
  for (const key of LOCATION_KEYS) {
    cities.set(key, (cityCounts[key] ?? 0) > 0 ? [...locales] : []);
  }
  return { categories, cities };
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

  const landings = await nonEmptyLandingLocales(locales);

  // --- Landing-page'e kategorii (dedykowana trasa /praca/kategoria/<klucz>, slug stabilny) ---
  // Tylko z ≥1 ofertą (#299).
  for (const key of CATEGORY_KEYS) {
    const path = `${HUB_PATH}/kategoria/${key}`;
    const withJobs = landings.categories.get(key) ?? [];
    const languages = buildLanguages(base, withJobs, (locale) => `/${locale}${path}`);
    for (const locale of withJobs) {
      entries.push({
        url: `${base}/${locale}${path}`,
        changeFrequency: 'weekly',
        priority: 0.6,
        alternates: { languages },
      });
    }
  }

  // --- Landing-page'e miast (dedykowana trasa /praca/miasto/<slug>, slug stabilny) ---
  // Tylko języki, w których filtr miasta znajduje ≥1 ofertę (#299).
  for (const key of LOCATION_KEYS) {
    const path = `${HUB_PATH}/miasto/${key}`;
    const withJobs = landings.cities.get(key) ?? [];
    const languages = buildLanguages(base, withJobs, (locale) => `/${locale}${path}`);
    for (const locale of withJobs) {
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
    // Tylko wersje językowe z tłumaczeniem (#301); nieznane (błąd odczytu) = wszystkie, jak dotąd.
    const availableByJob = await getJobsAvailableLocales(result.jobs.map((job) => job.id));
    for (const job of result.jobs) {
      const path = `${JOBS_PATH}/${job.slug}`;
      const available = availableByJob?.[job.id];
      const jobLocales = availableByJob && available?.length ? available : locales;
      const languages = buildLanguages(base, jobLocales, (locale) => `/${locale}${path}`);
      const publishedTs = Date.parse(job.publishedAt);
      const lastModified = Number.isNaN(publishedTs) ? now : new Date(publishedTs);
      for (const locale of jobLocales) {
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
