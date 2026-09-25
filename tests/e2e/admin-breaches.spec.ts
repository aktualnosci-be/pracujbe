import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Panel administratora w trybie DEMO — rejestr naruszeń (#490): lista z wpisem, nowy wpis
 * (błędy przy polach, fokus na pierwszym błędzie, brak zapisu w DEMO), szczegół z historią,
 * zamknięcie wymaga podsumowania, zawiadomienie osób niedostępne bez decyzji „zawiadamiamy”.
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
  test(`admin naruszenia (${locale}): nowy wpis — błędy przy polach, bez zapisu w DEMO`, async ({ page }) => {
    const t = admin(locale);
    await page.goto(`/${locale}/admin/naruszenia`);
    await rejectOptionalCookies(page, locale);

    await expect(page.getByRole('heading', { level: 1, name: t.breachTitle })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Przykładowy wpis: e-mail do niewłaściwego odbiorcy' })).toBeVisible();
    await page.getByRole('link', { name: t.breachNew }).click();
    await expect(page.getByRole('heading', { level: 1, name: t.breachNewTitle })).toBeVisible();

    await page.getByRole('button', { name: t.breachCreateSubmit }).click();
    const title = page.getByRole('textbox', { name: new RegExp(`^${t.breachFieldTitle}`) });
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: t.breachFormHasErrors })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);

    await title.fill('Test');
    await page.getByRole('textbox', { name: new RegExp(`^${t.breachFieldDescription}`) }).fill('Opis zakresu.');
    await page.getByLabel(new RegExp(`^${t.breachFieldDetectedAt}`)).fill('2025-02-10T09:00');
    await page.getByRole('button', { name: t.breachCreateSubmit }).click();
    await expect(page.getByRole('alert').filter({ hasText: t.breachDemoNotSaved })).toBeVisible();
  });
}

test('admin naruszenia: szczegół — historia, zamknięcie wymaga podsumowania, brak zawiadomienia bez decyzji', async ({
  page,
}) => {
  const t = admin('pl');
  await page.goto('/pl/admin/naruszenia/demo-b1');
  await rejectOptionalCookies(page, 'pl');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Przykładowy wpis');
  await expect(page.getByRole('heading', { name: t.breachSectionHistory })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: t.breachEventCreated })).toBeVisible();
  await expect(page.getByText(t.breachNoticeNotAllowed!)).toBeVisible();
  await expect(page.getByText(/^Termin 72 h minął/)).toBeVisible();

  await page.getByRole('button', { name: t.breachActionClose }).click();
  const dialog = page.getByRole('alertdialog', { name: t.breachCloseTitle });
  const summary = dialog.getByRole('textbox', { name: t.breachCloseSummaryLabel });
  await expect(summary).toBeFocused();
  expect(await blockingViolations(page)).toEqual([]);
  await dialog.getByRole('button', { name: t.breachActionClose }).click();
  await expect(dialog.getByText(t.reasonRequired!)).toBeVisible();
  await expect(summary).toHaveAttribute('aria-invalid', 'true');

  await summary.fill('Koniec analizy.');
  await dialog.getByRole('button', { name: t.breachActionClose }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: t.breachDemoNotSaved })).toBeVisible();
});
