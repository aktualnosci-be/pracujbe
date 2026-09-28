import { searchFold } from '@/lib/search-fold';

/**
 * Słownik języków (I18N-02/CF-02, migracja 0920) — lustro `public.languages` (0010)
 * i `public.language_aliases` (0920). Czysty moduł bez I/O: działa w przeglądarce
 * (wybór w onboardingu/kreatorze), w matchingu i na serwerze.
 *
 * Pozycja języka w formularzach i w payloadach RPC (`{ language, level }`) to KOD ze słownika
 * (ISO 639-1, np. `nl`) albo — tylko dla starych wpisów, których migracja nie dopasowała —
 * etykieta tekstowa. Baza rozwiązuje ją tak samo (`language_id_for_label`): najpierw dokładny
 * kod, potem alias nazwy w PL/NL/FR/EN. Nazwę w języku widza daje `languageNames.<kod>`
 * w `src/messages` — nigdy etykieta wpisana przez drugą stronę.
 */

export const LANGUAGE_CODES = [
  'pl', 'nl', 'fr', 'en', 'de', 'ro', 'bg', 'uk', 'ru', 'es', 'it', 'pt', 'tr', 'ar',
] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/**
 * Nazwy (i częste warianty) języków w PL/NL/FR/EN oraz nazwa własna. Klucz porównania
 * = `languageAliasKey` (bez wielkości liter, znaków diakrytycznych i podwójnych spacji),
 * więc „Néerlandais” i „neerlandais” to ten sam alias. Test `language-dictionary` porównuje
 * tę listę 1:1 z wierszami `language_aliases` w migracji.
 */
export const LANGUAGE_ALIASES: Readonly<Record<LanguageCode, readonly string[]>> = {
  pl: ['polski', 'Pools', 'polonais', 'Polish', 'język polski'],
  nl: ['niderlandzki', 'holenderski', 'flamandzki', 'Nederlands', 'Vlaams', 'néerlandais', 'flamand', 'Dutch', 'Flemish', 'język niderlandzki'],
  fr: ['francuski', 'Frans', 'français', 'French', 'język francuski'],
  en: ['angielski', 'Engels', 'anglais', 'English', 'język angielski'],
  de: ['niemiecki', 'Duits', 'allemand', 'German', 'Deutsch', 'język niemiecki'],
  ro: ['rumuński', 'Roemeens', 'roumain', 'Romanian', 'română'],
  bg: ['bułgarski', 'Bulgaars', 'bulgare', 'Bulgarian'],
  uk: ['ukraiński', 'Oekraïens', 'ukrainien', 'Ukrainian'],
  ru: ['rosyjski', 'Russisch', 'russe', 'Russian'],
  es: ['hiszpański', 'Spaans', 'espagnol', 'Spanish', 'español'],
  it: ['włoski', 'Italiaans', 'italien', 'Italian', 'italiano'],
  pt: ['portugalski', 'Portugees', 'portugais', 'Portuguese', 'português'],
  tr: ['turecki', 'Turks', 'turc', 'Turkish', 'Türkçe'],
  ar: ['arabski', 'Arabisch', 'arabe', 'Arabic'],
};

/** Klucz porównania etykiet: NFC → `searchFold` → złożone białe znaki (LIM17-05). */
export function languageAliasKey(value: string): string {
  return searchFold(value.normalize('NFC')).trim().replace(/\s+/g, ' ');
}

const CODE_SET = new Set<string>(LANGUAGE_CODES);
const ALIAS_INDEX: ReadonlyMap<string, LanguageCode> = (() => {
  const map = new Map<string, LanguageCode>();
  for (const code of LANGUAGE_CODES) {
    map.set(code, code);
    for (const alias of LANGUAGE_ALIASES[code]) map.set(languageAliasKey(alias), code);
  }
  return map;
})();

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/**
 * Kod języka dla wartości pozycji: dokładny kod ze słownika albo alias nazwy (PL/NL/FR/EN).
 * `null` = etykieta spoza słownika (stary wpis) — zostaje tekstem.
 */
export function resolveLanguageCode(value: string | null | undefined): LanguageCode | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (CODE_SET.has(trimmed)) return trimmed as LanguageCode;
  return ALIAS_INDEX.get(languageAliasKey(trimmed)) ?? null;
}

/**
 * Nazwa pozycji w języku widza: `names(code)` (np. `t('languageNames.nl')`) dla języka ze
 * słownika, inaczej etykieta bez zmian (stary wpis spoza słownika).
 */
export function languageDisplayName(
  value: string,
  names: (code: LanguageCode) => string,
): string {
  const code = resolveLanguageCode(value);
  return code ? names(code) : value;
}
