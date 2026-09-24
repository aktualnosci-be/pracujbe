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

type Messages = {
  cookies: { bannerTitle: string; acceptAll: string; rejectOptional: string; customize: string };
  dashboard: { greeting: string; greetingNoName: string };
  footer: { langLabel: string };
  jobs: { applyNow: string };
};

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
