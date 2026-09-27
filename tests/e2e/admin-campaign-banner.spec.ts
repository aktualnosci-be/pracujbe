import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Baner kampanii w panelu admina (#175 „Otwarte”) w trybie DEMO (bez bazy): w szczególe firmy
 * link „Baner kampanii” jest TYLKO przy ofercie aktywnej (szkic — brak linku, kontrola ujemna)
 * i prowadzi do generatora `/admin/oferty/[id]/baner` (nie do surowego SVG ani do panelu
 * pracodawcy, który admina bez firmy nie wpuszcza). Danych demonstracyjnych nie eksportujemy:
 * strona pokazuje „baner niedostępny” bez podglądu, z powrotem do firmy; noindex; axe.
 * Nie-admin → 404: w trybie demo layout nie ma sesji, więc tę kontrolę ujemną dowodzi
 * `tests/unit/admin-campaign-banner.test.ts` (requireAdmin przed odczytem, mutacja = czerwony).
 */

type Copy = {
  admin: Record<string, string>;
  campaignBanner: Record<string, string>;
};

function copy(locale: string): Copy {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Copy;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  const t = copy(locale);
  const labelPrefix = t.campaignBanner.openBannerLabel.split('{title}')[0] ?? '';
  const bannerLink = new RegExp(`^${escapeRegExp(labelPrefix)}`);

  test(`admin: link do baneru tylko przy aktywnej ofercie → generator admina (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/admin/firmy/demo-c2`);
    await rejectOptionalCookies(page, locale);
    const jobs = page.getByRole('main').getByRole('region', { name: t.admin.sectionJobs });

    // Firma demo ma jedną ofertę aktywną i jeden szkic — link tylko przy aktywnej.
    await expect(jobs.getByText(t.admin.jobStatusDraft, { exact: true })).toBeVisible();
    const links = jobs.getByRole('link', { name: bannerLink });
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute(
      'href',
      `/${locale}/admin/oferty/demo-c2-job-1/baner?firma=demo-c2`,
    );
    await expect(links).not.toHaveAttribute('target', '_blank');

    await links.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/oferty/demo-c2-job-1/baner\\?firma=demo-c2$`));
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: t.campaignBanner.pageTitle })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: t.campaignBanner.unavailableTitle })).toBeVisible();
    await expect(main.getByText(t.campaignBanner.unavailableHintAdmin)).toBeVisible();
    await expect(main.locator('img')).toHaveCount(0);
    await expect(main.getByRole('link', { name: t.campaignBanner.backToCompany })).toHaveAttribute(
      'href',
      `/${locale}/admin/firmy/demo-c2`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page).toHaveTitle(/\S/);
    expect(await blockingViolations(page)).toEqual([]);
  });
}

test('admin: strona baneru bez parametru firmy wraca do listy firm, zły parametr ignorowany', async ({ page }) => {
  const t = copy('pl');
  await page.goto('/pl/admin/oferty/00000000-0000-4000-8000-000000000000/baner?firma=..%2F..%2Fx');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 2, name: t.campaignBanner.unavailableTitle })).toBeVisible();
  await expect(main.getByRole('link', { name: t.admin.backToCompanies })).toHaveAttribute('href', '/pl/admin/firmy');
});
