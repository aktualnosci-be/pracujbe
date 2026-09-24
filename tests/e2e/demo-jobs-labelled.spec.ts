import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test, type Page } from '@playwright/test';

/**
 * #297 (Invariant #12): w trybie demo (bez bazy) fikcyjne oferty nie udają prawdziwych.
 * Na stronach z ofertami jest baner „dane przykładowe”, karty mają etykietę „przykładowa”,
 * nigdzie nie ma odznaki „Zweryfikowana firma”, szczegół jest noindex bez JobPosting, a dialog
 * „Aplikuj” mówi, że nie można aplikować — bez formularza.
 * Kontrola ujemna (oferty bez flagi demo): tests/e2e/job-posting-fixture.spec.ts.
 */

const locales = ['pl', 'nl', 'fr', 'en'] as const;
type Locale = (typeof locales)[number];
type Messages = {
  jobs: { demoNoticeTitle: string; demoNoticeBody: string; demoBadge: string; applyNow: string };
  job: { verified: string; sendMessage: string };
  apply: { demoJobTitle: string; demoJobBody: string; submit: string };
};

function messages(locale: Locale): Messages {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'));
}

const DEMO_JOB_SLUG = 'warehouse-worker-antwerp-1001';

async function expectNotice(page: Page, t: Messages) {
  const notice = page.getByTestId('demo-jobs-notice');
  await expect(notice).toHaveCount(1);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(t.jobs.demoNoticeTitle);
  await expect(notice).toContainText(t.jobs.demoNoticeBody);
}

for (const locale of locales) {
  test(`lista ofert demo: baner, etykiety „przykładowa”, bez odznaki weryfikacji (${locale})`, async ({ page }) => {
    const t = messages(locale);
    await page.goto(`/${locale}/oferty-pracy`);
    await expectNotice(page, t);

    const cards = page.locator('article').filter({ has: page.locator('a[href*="/oferty-pracy/"]') });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    await expect(cards.getByText(t.jobs.demoBadge, { exact: true })).toHaveCount(count);
    await expect(page.getByText(t.job.verified, { exact: true })).toHaveCount(0);
  });

  test(`szczegół oferty demo: baner, noindex, bez JobPosting, odznaki i formularza (${locale})`, async ({ page }) => {
    const t = messages(locale);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}`);
    await expectNotice(page, t);

    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
    const types = (await page.locator('script[type="application/ld+json"]').allTextContents())
      .map((raw) => (JSON.parse(raw) as { '@type'?: string })['@type']);
    expect(types).not.toContain('JobPosting');
    // Firma demo 1001 jest „zweryfikowana” w danych, ale odznaki nie pokazujemy.
    await expect(page.getByText(t.job.verified, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: t.job.sendMessage })).toHaveCount(0);

    await page.getByRole('button', { name: t.jobs.applyNow }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: t.apply.demoJobTitle })).toBeVisible();
    await expect(dialog).toContainText(t.apply.demoJobBody);
    await expect(dialog.locator('#apply-phone')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: t.apply.submit })).toHaveCount(0);
  });
}

for (const path of ['', '/praca/kategoria/warehouse', '/praca/miasto/antwerp']) {
  test(`strona z ofertami /pl${path || '/'} pokazuje baner danych przykładowych`, async ({ page }) => {
    const t = messages('pl');
    await page.goto(`/pl${path}`);
    await expectNotice(page, t);
    await expect(page.getByText(t.job.verified, { exact: true })).toHaveCount(0);
  });
}

test('strony bez ofert (poradniki) nie pokazują baneru', async ({ page }) => {
  await page.goto('/pl/poradniki');
  await expect(page.getByTestId('demo-jobs-notice')).toHaveCount(0);
});
