import { routing, type Locale } from '@/i18n/routing';
import { pickXDefaultLocale } from '@/lib/seo/locales';

/**
 * Język treści oferty (#301).
 *
 * `get_public_job` wybiera tłumaczenie w kolejności: język strony → język domyślny oferty → en.
 * RPC nie zwraca języka użytego tłumaczenia, więc ustalamy go po treści: tłumaczenie, którego
 * tytuł i opis są identyczne z tym, co zwróciło RPC. Przy kilku identycznych wygrywa język
 * strony. Brak dopasowania (np. oferta bez żadnego tłumaczenia) = język nieznany.
 */
export interface JobTranslationSample {
  locale: string;
  title: string;
  description: string | null;
}

export interface JobContentLocales {
  contentLocale?: Locale;
  availableLocales: Locale[];
}

function asLocale(value: string): Locale | undefined {
  return (routing.locales as readonly string[]).includes(value) ? (value as Locale) : undefined;
}

export function resolveJobContentLocales(
  requested: Locale,
  job: { title: string; description: string },
  translations: readonly JobTranslationSample[],
): JobContentLocales {
  const availableLocales = routing.locales.filter((locale) =>
    translations.some((row) => row.locale === locale),
  );
  const matching = translations
    .filter((row) => row.title === job.title && (row.description ?? '') === job.description)
    .map((row) => asLocale(row.locale))
    .filter((locale): locale is Locale => locale !== undefined);
  const contentLocale = matching.includes(requested) ? requested : matching[0];
  return { contentLocale, availableLocales };
}

/** Tłumaczenie oferty w kształcie potrzebnym karcie listy (tytuł + wyróżniki). */
export interface JobListTranslationSample {
  locale: string;
  title: string | null;
  highlights: readonly string[] | null;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Język tytułu i wyróżników karty listy (#1223). `get_public_jobs` (i pochodne: profil firmy)
 * bierze tłumaczenie w kolejności: język strony → język domyślny oferty → en, ale nie zwraca
 * jego języka. Ustalamy go bez zmiany RPC:
 *   - oferta ma tłumaczenie z tytułem w języku strony → karta jest w języku strony (RPC bierze
 *     je pierwsze);
 *   - inaczej język tłumaczenia, którego tytuł i wyróżniki są identyczne z kartą — tylko gdy
 *     jest jednoznaczny (identyczna treść w kilku językach = język nieznany, bez `lang`).
 * Brak dopasowania (np. tytuł z kolumny `jobs.title`) = język nieznany.
 */
export function resolveJobListContentLocale(
  requested: Locale,
  job: { title: string; highlights: readonly string[] },
  translations: readonly JobListTranslationSample[],
): Locale | undefined {
  const rows = translations.filter((row) => asLocale(row.locale) !== undefined);
  if (rows.some((row) => row.locale === requested && row.title !== null)) return requested;
  const matching = new Set(
    rows
      .filter((row) => row.title === job.title && sameList(row.highlights ?? [], job.highlights))
      .map((row) => row.locale as Locale),
  );
  return matching.size === 1 ? [...matching][0] : undefined;
}

/**
 * x-default dla hreflang: język domyślny serwisu, jeśli oferta go ma, inaczej pierwszy dostępny
 * wg kolejności `routing.locales` (nie kolejności wierszy z bazy) — ta sama reguła co w sitemapie
 * (`pickXDefaultLocale`, #1097).
 */
export function defaultAlternateLocale(available: readonly Locale[]): Locale | undefined {
  return pickXDefaultLocale(available);
}
