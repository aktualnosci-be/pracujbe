import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * #310 — decyzja admina o firmie w trybie DEMO: szczegół firmy (dane, VAT, członkowie,
 * oferty), wymagane uzasadnienie odrzucenia/zawieszenia (kontrola ujemna: bez powodu brak
 * zapisu, błąd przy polu) i informacja o powiadomieniu właściciela. Kontrolki po roli i nazwie
 * z `src/messages`.
 */

type AdminMessages = Record<string, string>;

function admin(locale: string): AdminMessages {
  const all = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as { admin: AdminMessages };
  return all.admin;
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  const t = admin(locale);

  test(`admin #310: szczegół firmy z listy — dane, członkowie, oferty (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/admin/firmy?status=awaiting`);
    await rejectOptionalCookies(page, locale);
    await page
      .getByRole('table')
      .getByRole('link', { name: 'Bouwbedrijf De Vos', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/firmy/demo-c2$`));

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Bouwbedrijf De Vos' })).toBeVisible();
    for (const section of [t.sectionStatus, t.sectionCompanyData, t.sectionMembers, t.sectionJobs]) {
      await expect(main.getByRole('heading', { level: 2, name: section })).toBeVisible();
    }
    await expect(main.getByText('BE0987654321')).toBeVisible();
    await expect(main.getByText(t.memberRoleOwner, { exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: t.backToCompanies })).toHaveAttribute(
      'href',
      `/${locale}/admin/firmy`,
    );
    expect(await blockingViolations(page)).toEqual([]);
  });

  test(`admin #310: odrzucenie wymaga uzasadnienia (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/admin/firmy/demo-c2`);
    await rejectOptionalCookies(page, locale);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: t.actionRejectCompany, exact: true }).click();

    const dialog = page.getByRole('alertdialog');
    const reason = dialog.getByRole('textbox', { name: t.reasonLabel });
    await expect(reason).toBeFocused();
    await expect(dialog).toContainText(t.ownerNotifiedNote);

    // Kontrola ujemna: bez uzasadnienia — brak zapisu, błąd przy polu, dialog zostaje.
    await reason.fill('   ');
    await dialog.getByRole('button', { name: t.actionRejectCompany, exact: true }).click();
    await expect(dialog.getByText(t.reasonRequired)).toBeVisible();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    await expect(reason).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: t.statusChanged })).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);

    await reason.fill('Numer VAT nie zgadza się z rejestrem KBO.');
    await dialog.getByRole('button', { name: t.actionRejectCompany, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: t.statusChanged })).toBeVisible();
    // Po decyzji fokus na nagłówku strony szczegółu (#415), nie na body.
    await expect(main.getByRole('heading', { level: 1, name: 'Bouwbedrijf De Vos' })).toBeFocused();
  });
}

test('admin #310: nieznana firma → komunikat „nie znaleziono” z powrotem do listy', async ({
  page,
}) => {
  const t = admin('pl');
  await page.goto('/pl/admin/firmy/nie-ma-takiej');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: t.companyNotFoundTitle })).toBeVisible();
  await expect(main.getByRole('link', { name: t.backToCompanies })).toBeVisible();
  await expect(main.getByRole('alertdialog')).toHaveCount(0);
});
