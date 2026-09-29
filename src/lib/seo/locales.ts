import { routing, type Locale } from '@/i18n/routing';

/**
 * Jedyne źródło reguł językowych metadanych SEO (#1084, #1097): `og:locale` i wybór adresu
 * `x-default` dla hreflang. Stąd korzystają `generateMetadata` stron publicznych, layout
 * i sitemap — koniec kilku kopii tej samej mapy i rozjazdu między HTML a sitemapą.
 */

/** Locale aplikacji → `og:locale` (format `język_KRAJ`; rynek docelowy: Belgia). */
export const OG_LOCALE: Record<Locale, string> = {
  pl: 'pl_PL',
  nl: 'nl_BE',
  fr: 'fr_BE',
  en: 'en_GB',
};

function isAppLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}

/** `og:locale` dla języka aplikacji; nieznany kod zostaje bez zmian (nigdy nie rzuca). */
export function ogLocale(locale: string): string {
  return isAppLocale(locale) ? OG_LOCALE[locale] : locale;
}

/**
 * Pola `openGraph.locale` + `openGraph.alternateLocale` (pozostałe języki serwisu). Strona z
 * ograniczonym zbiorem wersji (oferta z tłumaczeniami tylko w części języków) podaje je w
 * `alternates`; obecny język i duplikaty są pomijane, kolejność = kolejność `routing.locales`.
 */
export function openGraphLocales(
  locale: string,
  alternates: readonly string[] = routing.locales,
): { locale: string; alternateLocale: string[] } {
  const others = routing.locales.filter((candidate) => candidate !== locale && alternates.includes(candidate));
  return { locale: ogLocale(locale), alternateLocale: others.map(ogLocale) };
}

/**
 * Język adresu `x-default` dla hreflang: język domyślny serwisu, jeśli wersja istnieje, inaczej
 * PIERWSZY wg kolejności `routing.locales` — niezależnie od kolejności wejścia (bazy). Sitemap i
 * metadata strony wołają tę samą funkcję, więc nie mogą wskazać różnych adresów (#1097).
 */
export function pickXDefaultLocale<T extends string>(available: readonly T[]): T | undefined {
  const preferred = routing.locales.find((candidate) => (available as readonly string[]).includes(candidate));
  return preferred !== undefined ? (preferred as T) : available[0];
}
