import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * Tryb ogłoszeniowy (#1131, #1133, #1139; epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Wymaga serwera w trybie ogłoszeniowym: `E2E_PORTAL_LEGAL_MODE= npx playwright test
 * classifieds-matching-off`. Domyślny przebieg (serwer `RECRUITMENT`, #1136) pomija ten plik —
 * zachowanie rekrutacyjne pokrywają istniejące specy (`employer-candidates-*`,
 * `candidate-recommended-*`, `job-detail-passport`).
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'serwer testowy w trybie RECRUITMENT (E2E_PORTAL_LEGAL_MODE=)');

const DEMO_JOB_SLUG = 'warehouse-worker-antwerp-1001';

type Dashboard = Record<
  'topMatched' | 'matchedCandidates' | 'colMatched' | 'navCandidates' | 'navRecommended' | 'recommendedJobs' | 'seeAllCandidates',
  string
>;
const dashboard = (locale: string): Dashboard =>
  (JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as { dashboard: Dashboard })
    .dashboard;

for (const locale of LOCALES) {
  test(`trasy dopasowań = 404 (${locale})`, async ({ page }) => {
    for (const path of ['employer/kandydaci', 'employer/kandydaci/demo-c-1', 'candidate/oferty-polecane']) {
      const res = await page.goto(`/${locale}/${path}`);
      expect(res?.status(), path).toBe(404);
    }
  });

  test(`pulpit i nawigacja pracodawcy bez kandydatów i dopasowań (${locale})`, async ({ page }) => {
    const t = dashboard(locale);
    await page.goto(`/${locale}/employer`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('link', { name: t.navCandidates, exact: true })).toHaveCount(0);
    await expect(page.locator('a[href*="/employer/kandydaci"]')).toHaveCount(0);
    await expect(page.getByText(t.topMatched, { exact: true })).toHaveCount(0);
    await expect(page.getByText(t.matchedCandidates, { exact: true })).toHaveCount(0);
    await expect(page.getByText(t.colMatched, { exact: true })).toHaveCount(0);

    await page.goto(`/${locale}/employer/oferty`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByText(t.colMatched, { exact: true })).toHaveCount(0);

    await page.goto(`/${locale}/employer/statystyki`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByText(t.matchedCandidates, { exact: true })).toHaveCount(0);
  });

  test(`pulpit i nawigacja kandydata bez polecanych ofert (${locale})`, async ({ page }) => {
    const t = dashboard(locale);
    await page.goto(`/${locale}/candidate`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('link', { name: t.navRecommended, exact: true })).toHaveCount(0);
    await expect(page.locator('a[href*="/candidate/oferty-polecane"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: t.recommendedJobs })).toHaveCount(0);
  });

  test(`szczegół oferty bez slotu dopasowania (${locale})`, async ({ page }) => {
    // Bez slotu wyspa `JobMatchCard` nie istnieje, więc nie woła akcji dopasowania.
    await page.goto(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}`);
    await expect(page.getByTestId('job-detail-passport')).toBeVisible();
    await expect(page.getByTestId('job-match-slot')).toHaveCount(0);
  });
}
