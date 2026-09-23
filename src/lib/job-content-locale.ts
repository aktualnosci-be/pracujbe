import { routing, type Locale } from '@/i18n/routing';

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

/** x-default dla hreflang: język domyślny serwisu, jeśli oferta go ma, inaczej pierwszy dostępny. */
export function defaultAlternateLocale(available: readonly Locale[]): Locale | undefined {
  return available.includes(routing.defaultLocale) ? routing.defaultLocale : available[0];
}
