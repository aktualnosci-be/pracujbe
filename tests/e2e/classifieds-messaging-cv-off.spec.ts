import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import AxeBuilder from './fixtures/axe';
import { LOCALES } from './fixtures/messages';

/**
 * Tryb ogłoszeniowy (#1134, #1138; epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 * Bez rozmów kandydat ↔ pracodawca, bez załączników, bez wgrywania CV i bez importu CV przez AI.
 *
 * Wymaga serwera w trybie ogłoszeniowym: `E2E_PORTAL_LEGAL_MODE= npx playwright test
 * classifieds-messaging-cv-off`. Domyślny przebieg (serwer `RECRUITMENT`, #1136) pomija ten plik —
 * zachowanie rekrutacyjne pokrywają istniejące specy (`messages-*`, `cv-upload-size`, `cv-import`).
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'serwer testowy w trybie RECRUITMENT (E2E_PORTAL_LEGAL_MODE=)');

const DEMO_JOB_SLUG = 'warehouse-worker-antwerp-1001';
const ATTACHMENT = '77777777-7777-4777-8777-777777777777';

type Messages = {
  dashboard: Record<'navMessages' | 'latestMessages', string>;
  job: Record<'sendMessage' | 'contactViaPlatform', string>;
  files: Record<'upload', string>;
  candidatePassport: Record<'importCv', string>;
};
const messages = (locale: string): Messages =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Messages;

test('/api/files/message/<id> z tokenem = 404', async ({ request }) => {
  const res = await request.get(`/api/files/message/${ATTACHMENT}?t=signed`);
  expect(res.status()).toBe(404);
});

for (const locale of LOCALES) {
  test(`trasy wiadomości i importu CV = 404 (${locale})`, async ({ page }) => {
    for (const path of ['candidate/wiadomosci', 'candidate/wiadomosci?c=demo-conv-0', 'employer/wiadomosci', 'employer/szablony', 'candidate/profil/import-cv']) {
      const res = await page.goto(`/${locale}/${path}`);
      expect(res?.status(), path).toBe(404);
    }
  });

  test(`panel kandydata bez wiadomości i bez wgrywania CV (${locale})`, async ({ page }) => {
    const t = messages(locale);
    await page.goto(`/${locale}/candidate`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('link', { name: t.dashboard.navMessages, exact: true })).toHaveCount(0);
    await expect(page.locator('a[href*="/wiadomosci"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: t.dashboard.latestMessages })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t.files.upload, exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    await page.goto(`/${locale}/candidate/profil`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('button', { name: t.files.upload, exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: t.candidatePassport.importCv })).toHaveCount(0);
  });

  test(`nawigacja pracodawcy bez wiadomości (${locale})`, async ({ page }) => {
    const t = messages(locale);
    await page.goto(`/${locale}/employer`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('link', { name: t.dashboard.navMessages, exact: true })).toHaveCount(0);
    await expect(page.locator('a[href*="/wiadomosci"]')).toHaveCount(0);
    // #1211: szablony odpowiedzi = narzędzie wiadomości — bez pozycji w nawigacji.
    await expect(page.locator('a[href*="/employer/szablony"]')).toHaveCount(0);
  });

  test(`szczegół oferty bez kontaktu przez platformę (${locale})`, async ({ page }) => {
    const t = messages(locale);
    await page.goto(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}`);
    await expect(page.getByTestId('job-detail-passport')).toBeVisible();
    await expect(page.getByRole('link', { name: t.job.sendMessage })).toHaveCount(0);
    await expect(page.getByText(t.job.contactViaPlatform, { exact: true })).toHaveCount(0);
  });
}
