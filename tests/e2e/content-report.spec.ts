import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * #41 w trybie DEMO (bez bazy): strona zgłoszenia bez wskazanej treści i dla oferty
 * przykładowej (bez formularza — przykład nie jest treścią serwisu), strona statusu sprawy
 * (błędy przy polach, fokus, brak fałszywego wyniku) oraz osobna kolejka spraw DSA w panelu
 * administratora. Pełny formularz: `content-report-form.spec.ts` na serwerze fixture.
 */

type Messages = {
  contentReport: Record<string, string> & { error: Record<string, string> };
  admin: Record<string, string>;
  errors: Record<string, string>;
};

function messages(locale: string): Messages {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Messages;
}

const DEMO_JOB_SLUG = 'bricklayer-brussels-1002';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  test(`#41 strona zgłoszenia: bez treści i oferta przykładowa — bez formularza (${locale})`, async ({ page }) => {
    const t = messages(locale).contentReport;
    await page.goto(`/${locale}/zglos-tresc`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
    await expect(page.getByText(t.missingTarget)).toBeVisible();
    await expect(page.getByText(t.legalPlaceholder)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await blockingViolations(page)).toEqual([]);

    await page.goto(`/${locale}/zglos-tresc?oferta=${DEMO_JOB_SLUG}`);
    await expect(page.getByText(t.demoNotice)).toBeVisible();
    await expect(page.getByRole('button', { name: t.submit })).toHaveCount(0);
  });

  test(`#41 status sprawy: błędy przy polach, fokus, brak wyniku w demo (${locale})`, async ({ page }) => {
    const m = messages(locale);
    const t = m.contentReport;
    await page.goto(`/${locale}/zglos-tresc/sprawa`);
    await rejectOptionalCookies(page, locale);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    await page.getByRole('button', { name: t.lookupSubmit }).click();
    const caseInput = page.getByRole('textbox', { name: t.caseNumberLabel });
    await expect(caseInput).toBeFocused();
    await expect(caseInput).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(t.error.caseNumberRequired)).toBeVisible();
    await expect(page.getByText(t.error.accessCodeRequired)).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);

    await caseInput.fill('dsa-1a2b-3c4d-5e6f-7a8b');
    await page.getByRole('textbox', { name: t.accessCodeLabel }).fill('ABCD-EFGH-IJKL-MNOP-QRST-UVWX');
    await page.getByRole('button', { name: t.lookupSubmit }).click();
    // Demo nie ma spraw: jawny komunikat, żadnego wymyślonego statusu.
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(m.errors.demoUnavailable);
    await expect(page.getByTestId('report-case-status')).toHaveCount(0);
  });
}

test('#41 panel admina: sprawa DSA z numerem, terminem, dowodem i osobnym filtrem', async ({ page }) => {
  const t = messages('pl').admin;
  await page.goto('/pl/admin/zgloszenia');
  await rejectOptionalCookies(page, 'pl');
  const main = page.getByRole('main');
  await expect(main.getByText('DSA-7F3A-19C2-B4E0-5D11')).toBeVisible();
  await expect(main.getByText(t.caseSnapshotTitle)).toBeVisible();
  await expect(main.getByText(t.caseReporterContact.replace('{email}', 'zglaszajacy@example.com'))).toBeVisible();
  await expect(main.getByText(t.caseHistoryTitle)).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  const kindNav = page.getByRole('navigation', { name: t.filterKindLabel });
  await kindNav.getByRole('link', { name: t.kindDsa, exact: true }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/zgloszenia\?kind=dsa_notice$/);
  await expect(kindNav.getByRole('link', { name: t.kindDsa, exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(main.getByRole('heading', { name: t.reasonFraud })).toBeVisible();
  await expect(main.getByRole('heading', { name: t.reasonMisleading })).toHaveCount(0);

  // Kontrola ujemna: pozostałe zgłoszenia bez spraw DSA.
  await kindNav.getByRole('link', { name: t.kindQuality, exact: true }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/zgloszenia\?kind=quality$/);
  await expect(main.getByText('DSA-7F3A-19C2-B4E0-5D11')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: t.reasonMisleading })).toBeVisible();

  // Filtr statusu zachowuje rodzaj.
  await page.getByRole('navigation', { name: t.filterReportsLabel }).getByRole('link', { name: t.statusOpen, exact: true }).click();
  await expect(page).toHaveURL(/status=open/);
  await expect(page).toHaveURL(/kind=quality/);
});
