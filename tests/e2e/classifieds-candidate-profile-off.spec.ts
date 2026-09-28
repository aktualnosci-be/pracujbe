import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * Tryb ogłoszeniowy — profil i onboarding kandydata wyłączone (epik #1128) — decyzja produktowa:
 * portal ogłoszeniowy. `/candidate/profil` (z podstronami) i `/candidate/onboarding` = 404, pulpit
 * i nawigacja nie odsyłają do profilu ani do onboardingu, pulpit bez wskaźnika kompletności.
 * Ustawienia konta zostają.
 *
 * Wymaga serwera w trybie ogłoszeniowym: `E2E_PORTAL_LEGAL_MODE= npx playwright test
 * classifieds-candidate-profile-off`. Domyślny przebieg (serwer `RECRUITMENT`) pomija ten plik —
 * zachowanie rekrutacyjne pokrywają `candidate-profile-passport`, `candidate-onboarding`,
 * `candidate-completeness-title`.
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'serwer testowy w trybie RECRUITMENT (E2E_PORTAL_LEGAL_MODE=)');

type Dashboard = Record<'profileCompleteness' | 'completeProfile' | 'navProfile' | 'navSettings', string>;
const dashboard = (locale: string): Dashboard =>
  (JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as { dashboard: Dashboard })
    .dashboard;

for (const locale of LOCALES) {
  test(`profil i onboarding kandydata = 404 (${locale})`, async ({ page }) => {
    for (const path of [
      'candidate/profil',
      'candidate/profil/import-cv',
      'candidate/onboarding',
      'candidate/onboarding?step=3',
    ]) {
      const res = await page.goto(`/${locale}/${path}`);
      expect(res?.status(), path).toBe(404);
    }
  });

  test(`pulpit i nawigacja kandydata bez profilu i wskaźnika kompletności (${locale})`, async ({ page }) => {
    const t = dashboard(locale);
    await page.goto(`/${locale}/candidate`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('link', { name: t.navProfile, exact: true })).toHaveCount(0);
    await expect(page.locator('a[href*="/candidate/profil"]')).toHaveCount(0);
    await expect(page.locator('a[href*="/candidate/onboarding"]')).toHaveCount(0);
    await expect(page.getByText(t.profileCompleteness, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: t.completeProfile, exact: true })).toHaveCount(0);
    // Ustawienia konta zostają.
    await expect(page.getByRole('link', { name: t.navSettings, exact: true }).first()).toBeVisible();
  });

  test(`ustawienia konta dostępne (${locale})`, async ({ page }) => {
    const res = await page.goto(`/${locale}/candidate/ustawienia`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('main h1')).toBeVisible();
  });
}
