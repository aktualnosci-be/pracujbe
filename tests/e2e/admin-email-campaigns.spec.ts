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

/* ---------------------------------------------------------------------------
 * Edytor rewizji (#45, 0202) — tryb DEMO: walidacja i podgląd w przeglądarce, zapis bez bazy.
 * ------------------------------------------------------------------------- */

const LOCALE_NAMES: Record<string, string> = { pl: 'Polski', nl: 'Nederlands', fr: 'Français', en: 'English' };

async function fillJob(page: Page, t: AdminMessages, locale: string, title: string) {
  const section = page.getByRole('region', { name: LOCALE_NAMES[locale]!, exact: true });
  await section.getByRole('textbox', { name: t.campaignEditorJobSlug }).fill(`magazynier-${locale}`);
  await section.getByRole('textbox', { name: t.campaignEditorJobTitle }).fill(title);
  await section.getByRole('textbox', { name: t.campaignEditorJobCity }).fill('Gent');
}

for (const locale of ['pl', 'en'] as const) {
  test(`admin kampanie (${locale}): nowa kampania — brak języka = błąd przy polu, podgląd, zapis`, async ({ page }) => {
    const t = admin(locale);
    await page.goto(`/${locale}/admin/kampanie`);
    await rejectOptionalCookies(page, locale);
    await page.getByRole('link', { name: t.campaignNewTitle }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/kampanie/nowa$`));
    await expect(page.getByRole('heading', { level: 1, name: t.campaignNewTitle })).toBeVisible();
    // Brak nadawcy marketingu: ten sam komunikat (szkic można zapisać, aktywować — nie).
    await expect(page.getByRole('note').filter({ hasText: t.campaignSenderMissingTitle! })).toBeVisible();

    await page.getByRole('textbox', { name: t.campaignEditorSlug }).fill('newsletter-test');
    await fillJob(page, t, 'pl', 'Magazynier');
    await fillJob(page, t, 'nl', 'Magazijnier');
    await fillJob(page, t, 'fr', 'Magasinier');
    // Angielski pusty → błąd przy polu, fokus na pierwszym błędzie, dane zostają.
    await page.getByRole('button', { name: t.campaignEditorSave }).click();
    await expect(page.getByRole('alert').filter({ hasText: t.campaignEditorHasErrors! })).toBeVisible();
    const english = page.getByRole('region', { name: 'English', exact: true });
    const enSlug = english.getByRole('textbox', { name: t.campaignEditorJobSlug });
    await expect(enSlug).toBeFocused();
    await expect(enSlug).toHaveAttribute('aria-invalid', 'true');
    await expect(enSlug).toHaveAccessibleDescription(t.campaignEditorErrorRequired!);
    await expect(english.getByRole('textbox', { name: t.campaignEditorJobTitle })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(
      page.getByRole('region', { name: 'Polski', exact: true }).getByRole('textbox', { name: t.campaignEditorJobTitle }),
    ).toHaveValue('Magazynier');

    // Podgląd przełączany językiem: angielski niepoprawny, polski z wpisaną treścią.
    const previewLocales = page.getByRole('group', { name: t.campaignEditorPreviewLocales });
    await previewLocales.getByRole('button', { name: 'English' }).click();
    await expect(previewLocales.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(t.campaignPreviewInvalid!, { exact: true })).toBeVisible();
    await previewLocales.getByRole('button', { name: 'Polski' }).click();
    await expect(page.getByText('Magazynier', { exact: true })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);

    await fillJob(page, t, 'en', 'Warehouse worker');
    await expect(enSlug).not.toHaveAttribute('aria-invalid', 'true');
    await previewLocales.getByRole('button', { name: 'English' }).click();
    await expect(page.getByText('Warehouse worker', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: t.campaignEditorSave }).click();
    // Tryb demo: nic nie jest zapisywane, jasny komunikat, formularz zostaje.
    await expect(page.getByRole('status').filter({ hasText: t.campaignEditorDemoNotSaved! })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: t.campaignEditorHasErrors! })).toHaveCount(0);
  });
}

test('admin kampanie: nowa rewizja — formularz wypełniony treścią rewizji, slug stały', async ({ page }) => {
  const t = admin('pl');
  await page.goto('/pl/admin/kampanie/demo-k3');
  await rejectOptionalCookies(page, 'pl');
  await page.getByRole('link', { name: t.campaignNewRevisionTitle }).click();
  await expect(page).toHaveURL(/\/pl\/admin\/kampanie\/demo-k3\/nowa-rewizja$/);
  await expect(page.getByRole('heading', { level: 1, name: t.campaignNewRevisionTitle })).toBeVisible();

  const slug = page.getByRole('textbox', { name: t.campaignEditorSlug });
  await expect(slug).toHaveValue('newsletter-pazdziernik');
  await expect(slug).toHaveAttribute('readonly', '');
  for (const [locale, title] of [
    ['pl', 'Magazynier'],
    ['nl', 'Magazijnier'],
    ['fr', 'Magasinier'],
    ['en', 'Warehouse worker'],
  ] as const) {
    await expect(
      page.getByRole('region', { name: LOCALE_NAMES[locale]!, exact: true }).getByRole('textbox', {
        name: t.campaignEditorJobTitle,
      }),
    ).toHaveValue(title);
  }
  // Usunięcie treści w jednym języku → błąd przy polu tego języka.
  const dutchTitle = page
    .getByRole('region', { name: 'Nederlands', exact: true })
    .getByRole('textbox', { name: t.campaignEditorJobTitle });
  await dutchTitle.fill('');
  await page.getByRole('button', { name: t.campaignEditorSave }).click();
  await expect(dutchTitle).toBeFocused();
  await expect(dutchTitle).toHaveAccessibleDescription(t.campaignEditorErrorRequired!);
  await dutchTitle.fill('Magazijnier');
  await page.getByRole('button', { name: t.campaignEditorSave }).click();
  await expect(page.getByRole('status').filter({ hasText: t.campaignEditorDemoNotSaved! })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});
