import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Stan operacyjny w panelu admina (#47, `/admin/operacje`) w trybie DEMO (bez bazy): przykładowy
 * stan oznaczony na stronie — maintenance jeszcze nie ruszył (ostrzeżenie), kopia
 * nieskonfigurowana (alarm), kolejki w normie. Każdy wiersz: wartość, próg i stan słowem.
 * Strona noindex, bez dzwonka powiadomień, osiągalna z nawigacji panelu.
 */

type AdminMessages = { admin: Record<string, string> };
const admin = (locale: string) =>
  (JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as AdminMessages)
    .admin;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const locale of LOCALES) {
  test(`admin: stan operacyjny — nawigacja, wiersze z wartością, progiem i stanem (${locale})`, async ({ page }) => {
    const t = admin(locale);
    await page.goto(`/${locale}/admin`);
    await rejectOptionalCookies(page, locale);
    await page.getByRole('link', { name: t.navOperations }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/operacje$`));
    await expect(page.getByRole('heading', { level: 1, name: t.opsTitle })).toBeVisible();
    await expect(page.getByText(t.opsDemoNotice)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    // Stan zbiorczy = alarm (kopia nieskonfigurowana), jak w /api/health/ops.
    await expect(page.getByText(t.opsOverall_alert)).toBeVisible();

    const lastRun = page.locator('[data-ops-row="maintenanceLastRun"]');
    await expect(lastRun).toContainText(t.opsRow_maintenanceLastRun);
    await expect(lastRun).toContainText(t.opsState_warning);
    await expect(lastRun).toContainText(t.opsNoteLastRunNever);

    const queue = page.locator('[data-ops-row="emailQueueAge"]');
    await expect(queue).toContainText(t.opsColValue);
    await expect(queue).toContainText(t.opsColThreshold);
    await expect(queue).toContainText(t.opsState_ok);

    await expect(page.locator('[data-ops-row="backupAge"]')).toContainText(t.opsState_alert);
    for (const key of ['opsSectionQueues', 'opsSectionMaintenance', 'opsSectionStorage', 'opsSectionMail', 'opsSectionAiBudget']) {
      await expect(page.getByRole('heading', { level: 2, name: t[key] })).toBeVisible();
    }
  });
}

test('admin: stan operacyjny — 320 px i 200% tekstu bez naruszeń axe i bez przewijania w poziomie', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/pl/admin/operacje');
  await rejectOptionalCookies(page, 'pl');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.getByRole('main').first().waitFor();
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
