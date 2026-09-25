import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Panel administratora w trybie DEMO — kampanie e-mail (#45): lista rewizji z liczbami
 * odbiorców, podgląd treści w każdym języku, zatrzymanie z potwierdzeniem w dialogu.
 * Serwer E2E nie ma nadawcy marketingu (EMAIL_SENDER_*), więc strona pokazuje jawny
 * komunikat, a aktywacja jest wyłączona i powiązana z tym komunikatem.
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
  test(`admin kampanie (${locale}): lista, brak nadawcy, zatrzymanie z potwierdzeniem`, async ({ page }) => {
    const t = admin(locale);
    await page.goto(`/${locale}/admin/kampanie`);
    await rejectOptionalCookies(page, locale);

    await expect(page.getByRole('heading', { level: 1, name: t.campaignTitle })).toBeVisible();
    await expect(page.getByRole('note').filter({ hasText: t.campaignSenderMissingTitle! })).toBeVisible();
    const list = page.getByRole('region', { name: t.campaignTitle });
    const active = list.getByRole('listitem').filter({ hasText: 'newsletter-wrzesien' }).filter({
      hasText: t.campaignStatusActive!,
    });
    await expect(active).toHaveCount(1);
    await expect(active).toContainText(t.campaignRecipientDelivered!);

    await page.getByRole('link', { name: 'newsletter-pazdziernik' }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/kampanie/demo-k3$`));
    await expect(page.getByRole('heading', { level: 1, name: 'newsletter-pazdziernik' })).toBeVisible();

    // Bez nadawcy aktywacja jest wyłączona i opisana komunikatem.
    const activate = page.getByRole('button', { name: t.campaignActionActivate });
    await expect(activate).toBeDisabled();
    await expect(activate).toHaveAccessibleDescription(
      `${t.campaignSenderMissingTitle} ${t.campaignSenderMissingText}`,
    );

    // Podgląd w każdym języku serwisu.
    for (const title of ['Magazynier', 'Magazijnier', 'Magasinier', 'Warehouse worker']) {
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }
    expect(await blockingViolations(page)).toEqual([]);

    // Zatrzymanie: dialog z danymi rewizji, fokus na „Anuluj”, Escape zamyka i oddaje fokus.
    const cancel = page.getByRole('button', { name: t.campaignActionCancel });
    await cancel.click();
    const dialog = page.getByRole('alertdialog', { name: t.campaignCancelConfirmTitle });
    await expect(dialog).toContainText('newsletter-pazdziernik');
    expect(await blockingViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(cancel).toBeFocused();

    await cancel.click();
    await dialog.getByRole('button', { name: t.campaignActionCancel }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: t.campaignCancelled })).toBeVisible();
  });
}

test('admin kampanie: filtr „Zamknięte” i rewizje tego samego sluga', async ({ page }) => {
  const t = admin('pl');
  await page.goto('/pl/admin/kampanie');
  await rejectOptionalCookies(page, 'pl');
  await page.getByRole('link', { name: t.campaignFilterClosed }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/kampanie\?status=closed$/);
  const rows = page.getByRole('region', { name: t.campaignTitle }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(t.campaignStatusSuperseded!);
  await expect(page.getByText('newsletter-pazdziernik')).toHaveCount(0);

  await page.goto('/pl/admin/kampanie/demo-k1');
  // Zastąpiona rewizja: bez akcji; link do aktywnej rewizji tego sluga.
  await expect(page.getByRole('button', { name: t.campaignActionCancel })).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.campaignActionActivate })).toHaveCount(0);
  await page.getByRole('link', { name: t.campaignRevisionLabel!.replace('{revision}', '2') }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/kampanie\/demo-k2$/);
  await expect(page.getByRole('button', { name: t.campaignActionCancel })).toBeVisible();
});
