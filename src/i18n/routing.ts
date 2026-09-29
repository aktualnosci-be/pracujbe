import { defineRouting } from 'next-intl/routing';

/**
 * Konfiguracja routingu językowego Pracuj.be.
 *
 * Pierwsza wersja: pl, nl, fr, en. Architektura przygotowana pod dodanie kolejnych
 * (de, ro, bg, uk, es, pt) — wystarczy dopisać locale tutaj i plik src/messages/<locale>.json.
 *
 * localePrefix: 'always' — każdy adres ma prefiks języka (/pl, /nl, /fr, /en). Wymagane dla SEO
 * (hreflang, canonical) i przewidywalności. Middleware wykrywa język z Accept-Language dla "/".
 */
export const routing = defineRouting({
  locales: ['pl', 'nl', 'fr', 'en'],
  defaultLocale: 'pl',
  localePrefix: 'always',
  // #1057: bez nagłówka HTTP `Link: …; rel="alternate"; hreflang=…`, który next-intl dokłada do
  // każdej odpowiedzi middleware. Jego `x-default` wskazywał adres bez prefiksu języka i był
  // sprzeczny z hreflang w metadata stron i w sitemapie (jedyne źródło: `alternates.languages`
  // i `src/app/sitemap.ts`, z uwzględnieniem tłumaczeń konkretnej oferty).
  alternateLinks: false,
});

export type Locale = (typeof routing.locales)[number];

/**
 * Jedyne źródło listy języków w kodzie aplikacji (#29): walidacja, fallbacki i schematy
 * korzystają z `routing.locales`/`isLocale`, a nie z własnych kopii listy.
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (routing.locales as readonly string[]).includes(value);
}

export const localeNames: Record<Locale, string> = {
  pl: 'Polski',
  nl: 'Nederlands',
  fr: 'Français',
  en: 'English',
};
