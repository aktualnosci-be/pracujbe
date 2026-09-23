import { expect, test, type Page } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';

/**
 * #191 / #197 / #185 — izolowany serwer dev (TEST_APPLICATIONS_FIXTURE=error) wymusza błędy
 * odczytu pomocniczych danych. Szczegół oferty zachowuje opis i aplikowanie, gdy podobne
 * oferty lub dopasowanie się nie wczytają; pulpit pracodawcy pokazuje błąd listy ofert
 * z ponowieniem zamiast „brak ofert”, a pozostałe sekcje działają.
 */

const viewports = [
  { width: 640, height: 900, label: '200%' },
  { width: 320, height: 800, label: '320 px' },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const { documentWidth, viewportWidth } = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(documentWidth).toBeLessThanOrEqual(viewportWidth + 1);
}

async function firstJobPath(page: Page, locale: string): Promise<string> {
  await page.goto(`/${locale}/oferty-pracy`);
  const href = await page.locator(`main a[href^="/${locale}/oferty-pracy/"]`).first().getAttribute('href');
  expect(href).toBeTruthy();
  return href!;
}

for (const [locale, messages] of Object.entries({ pl, nl, fr, en })) {
  test(`job detail keeps description and apply when similar jobs and match fail (${locale})`, async ({ page }) => {
    const path = await firstJobPath(page, locale);
    await page.goto(path);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#opis')).toBeVisible();
    await expect(page.getByRole('button', { name: messages.jobs.applyNow }).first()).toBeVisible();

    const similar = page.getByTestId('similar-jobs-error');
    await expect(similar).toBeVisible();
    await expect(similar).toContainText(messages.job.similarJobsLoadError);
    await expect(page.locator('#podobne a[href*="/oferty-pracy/"]')).toHaveCount(0);

    const match = page.getByTestId('job-match-error');
    await expect(match).toBeVisible();
    await expect(match).toContainText(messages.match.loadError);
    await expect(match).not.toContainText('%');

    await page.waitForLoadState('networkidle');
    const retry = match.getByRole('button', { name: messages.common.retry });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('job-match-error')).toBeVisible();
  });

  for (const viewport of viewports) {
    test(`employer offers read failure shows retry, never a false empty list (${locale}, ${viewport.label})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/${locale}/employer`);

      const alert = page.getByRole('alert').filter({ hasText: messages.dashboard.employerOffersLoadError });
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(messages.dashboard.employerOffersLoadErrorHint);
      const retry = alert.getByRole('link', { name: messages.dashboard.employerOffersRetry });
      await expect(retry).toBeVisible();
      await expect(page.getByRole('list', { name: messages.dashboard.yourActiveOffers })).toHaveCount(0);

      // Niezależna sekcja nadal działa na prawdziwych (tu: demo) danych.
      await expect(page.getByRole('heading', { name: messages.dashboard.recentApplications })).toBeVisible();

      await expectNoHorizontalOverflow(page);
      const box = await retry.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    });
  }
}
