import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page } from '@playwright/test';

/**
 * Teksty UI dla testów E2E — z tych samych plików co aplikacja (`src/messages/*.json`).
 * Zasada (#376): kontrolki o znaczeniu wybieramy rolą i nazwą z komunikatów, nie pozycją
 * (`.first()`/`.nth()`), bo zmiana kolejności przycisków nie może po cichu zmienić scenariusza.
 */

export const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
export type TestLocale = (typeof LOCALES)[number];

/**
 * Typ komunikatów = struktura `src/messages/pl.json` (import tylko typu, bez odczytu w runtime).
 * Pozostałe języki mają te same klucze (strażnik kluczy i18n w testach jednostkowych), więc
 * literówka w kluczu albo usunięty klucz to błąd typecheck zamiast `undefined` w lokatorze.
 */
export type Messages = typeof import('../../../src/messages/pl.json');

const cache = new Map<string, Messages>();

export function messages(locale: string): Messages {
  let loaded = cache.get(locale);
  if (!loaded) {
    loaded = JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Messages;
    cache.set(locale, loaded);
  }
  return loaded;
}

type BannerChoice = 'rejectOptional' | 'acceptAll' | 'customize';

/** Baner cookies strony w danym języku. */
export function cookieBanner(page: Page) {
  return page.locator('[aria-labelledby="cookie-banner-title"]');
}

/** Klika wskazany przycisk banera po jego nazwie w danym języku. */
export async function clickCookieBanner(page: Page, locale: string, choice: BannerChoice) {
  await cookieBanner(page).getByRole('button', { name: messages(locale).cookies[choice], exact: true }).click();
}

/** „Tylko niezbędne” i oczekiwanie, aż baner zniknie. */
export async function rejectOptionalCookies(page: Page, locale: string) {
  await clickCookieBanner(page, locale, 'rejectOptional');
  await expect(cookieBanner(page)).toHaveCount(0);
}
