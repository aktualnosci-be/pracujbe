import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Panel administratora w trybie DEMO — blokady adresów e-mail (#44): lista aktywnych blokad,
 * filtr zdjętych, zdjęcie blokady wymaga uzasadnienia w dialogu (fokus na polu, błąd przy
 * polu, komunikat po sukcesie). Kontrolki po roli i nazwie z `src/messages` (#376).
 */

type AdminMessages = Record<string, string>;

function admin(locale: string): AdminMessages {
  return (
    JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as {
      admin: AdminMessages;
    }
  ).admin;
}

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const locale of LOCALES) {
  test(`admin poczta (${locale}): zdjęcie blokady wymaga uzasadnienia`, async ({ page }) => {
    const t = admin(locale);
    await page.goto(`/${locale}/admin/poczta`);
    await rejectOptionalCookies(page, locale);

    await expect(page.getByRole('heading', { level: 1, name: t.emailTitle })).toBeVisible();
    const active = page.getByRole('listitem').filter({ hasText: 'skarga@example.com' });
    await expect(active).toContainText(t.emailReasonComplaint!);
    // Zdjęta blokada nie jest widoczna w domyślnym filtrze „Aktywne”.
    await expect(page.getByText('poprawiony.adres@example.com')).toHaveCount(0);

    await active.getByRole('button', { name: t.emailActionLift }).click();
    const dialog = page.getByRole('alertdialog', { name: t.emailLiftConfirmTitle });
    await expect(dialog).toContainText('skarga@example.com');
    const reason = dialog.getByRole('textbox', { name: t.reasonLabel });
    await expect(reason).toBeFocused();
    expect(await blockingViolations(page)).toEqual([]);

    // Bez uzasadnienia: błąd przy polu, fokus wraca na pole, dialog zostaje.
    await dialog.getByRole('button', { name: t.emailActionLift }).click();
    await expect(dialog.getByText(t.reasonRequired!)).toBeVisible();
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');

    await reason.fill('Odbiorca potwierdził adres.');
    await dialog.getByRole('button', { name: t.emailActionLift }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: t.emailLifted })).toBeVisible();
  });
}

test('admin poczta: filtr „Zdjęte” pokazuje historię z uzasadnieniem, bez akcji', async ({ page }) => {
  const t = admin('pl');
  await page.goto('/pl/admin/poczta');
  await rejectOptionalCookies(page, 'pl');
  await page.getByRole('link', { name: t.emailFilterLifted }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/poczta\?status=lifted$/);
  const row = page.getByRole('listitem').filter({ hasText: 'poprawiony.adres@example.com' });
  await expect(row).toContainText('Użytkownik poprawił skrzynkę');
  await expect(row.getByRole('button', { name: t.emailActionLift })).toHaveCount(0);
  await expect(page.getByText('skarga@example.com')).toHaveCount(0);
});
