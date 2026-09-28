import { expect, test } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * #1141/#1144/#1132 — decyzja produktowa: portal ogłoszeniowy. Serwer w trybie `CLASSIFIEDS_ONLY`
 * (uruchomienie z `E2E_PORTAL_LEGAL_MODE=`): panele zgłoszeń i propozycji oraz strony linków
 * aplikacji bez konta dają 404 w każdym języku, a nawigacja paneli do nich nie prowadzi.
 *
 * Domyślny serwer E2E działa w trybie `RECRUITMENT` (#1136) — wtedy spec jest pomijany, a te same
 * trasy pokrywają istniejące specy (kontrola ujemna: `candidate-application-detail`,
 * `employer-application-detail`, `guest-apply`, `panel-a11y`).
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'Tylko serwer trybu ogłoszeniowego (E2E_PORTAL_LEGAL_MODE=).');

const ID = '11111111-1111-4111-8111-111111111111';
const ROUTES = [
  '/employer/aplikacje',
  `/employer/aplikacje/${ID}`,
  '/candidate/aplikacje',
  `/candidate/aplikacje/${ID}`,
  '/candidate/propozycje',
  '/aplikacja/potwierdz',
  '/aplikacja/przejmij',
];

for (const locale of LOCALES) {
  test(`${locale}: trasy zgłoszeń, propozycji i aplikacji gościa → 404`, async ({ request }) => {
    for (const route of ROUTES) {
      const response = await request.get(`/${locale}${route}`, { maxRedirects: 0 });
      expect(response.status(), route).toBe(404);
    }
  });

  test(`${locale}: nawigacja paneli bez zgłoszeń i propozycji`, async ({ page }) => {
    await page.goto(`/${locale}/candidate`);
    await expect(page.locator('a[href$="/candidate/zapisane"]').first()).toBeVisible();
    await expect(page.locator('a[href*="/candidate/aplikacje"], a[href*="/candidate/propozycje"]')).toHaveCount(0);

    await page.goto(`/${locale}/employer`);
    await expect(page.locator('a[href$="/employer/oferty"]').first()).toBeVisible();
    await expect(page.locator('a[href*="/employer/aplikacje"]')).toHaveCount(0);
  });
}
