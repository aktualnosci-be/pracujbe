import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Panel administratora w trybie DEMO — przegląd pytań screeningowych (#497): kolejka
 * oczekujących pytań (treść we wszystkich językach), odrzucenie wymaga uzasadnienia w dialogu
 * (fokus na polu, błąd przy polu, komunikat po sukcesie), rozstrzygnięte bez akcji.
 * Kontrolki po roli i nazwie z `src/messages` (#376).
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
  test(`admin pytania (${locale}): odrzucenie wymaga uzasadnienia`, async ({ page }) => {
    const t = admin(locale);
    await page.goto(`/${locale}/admin/pytania`);
    await rejectOptionalCookies(page, locale);

    await expect(page.getByRole('heading', { level: 1, name: t.screeningTitle })).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: 'Wat is je geboortedatum?' });
    await expect(row).toContainText('Podaj datę urodzenia');
    // Rozstrzygnięte pytanie nie jest widoczne w domyślnym filtrze „Oczekujące”.
    await expect(page.getByText('Czy masz zaświadczenie o niekaralności?')).toHaveCount(0);

    await row.getByRole('button', { name: t.screeningActionReject }).click();
    const dialog = page.getByRole('alertdialog', { name: t.screeningRejectConfirmTitle });
    const reason = dialog.getByRole('textbox', { name: t.reasonLabel });
    await expect(reason).toBeFocused();
    expect(await blockingViolations(page)).toEqual([]);

    await dialog.getByRole('button', { name: t.screeningActionReject }).click();
    await expect(dialog.getByText(t.reasonRequired!)).toBeVisible();
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');

    await reason.fill('Brak podstawy dla tego stanowiska.');
    await dialog.getByRole('button', { name: t.screeningActionReject }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: t.screeningRejected })).toBeVisible();
  });
}

test('admin pytania: filtr „Rozstrzygnięte” pokazuje decyzję z uzasadnieniem, bez akcji', async ({ page }) => {
  const t = admin('pl');
  await page.goto('/pl/admin/pytania');
  await rejectOptionalCookies(page, 'pl');
  await page.getByRole('link', { name: t.screeningFilterDecided }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/pytania\?status=decided$/);
  const row = page.getByRole('listitem').filter({ hasText: 'Czy masz zaświadczenie o niekaralności?' });
  await expect(row).toContainText('Brak wskazanej podstawy');
  await expect(row.getByRole('button', { name: t.screeningActionApprove })).toHaveCount(0);
  await expect(page.getByText('Podaj datę urodzenia')).toHaveCount(0);
});
