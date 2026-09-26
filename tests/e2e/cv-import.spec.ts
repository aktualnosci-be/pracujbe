import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import en from '../../src/messages/en.json';
import pl from '../../src/messages/pl.json';
import { buildDocx, buildPdf, CV_WITH_REFEREES, DOCX_TYPE, PDF_TYPE, REFEREES } from '../helpers/cv-fixtures';

/**
 * Import CV do profilu kandydata (#487, #498) — tryb demo z atrapą dostawcy AI
 * (`AI_CV_IMPORT_PROVIDER=fixture`, playwright.config.ts). Zero wywołań prawdziwego API.
 *
 * Pokrywa: podgląd przed wysłaniem bez danych referentów, propozycje domyślnie
 * niezaznaczone, edycja wartości z błędem przy polu (limit kreatora), zapis tylko zaznaczonych; kontrole ujemne — NISS w CV (odmowa, bez
 * podglądu), zatwierdzenie bez zaznaczenia (blokada). Brak zapisu bez zatwierdzenia na
 * poziomie bazy dowodzi `rls.sql` sekcja CV487, a akcji — `cv-import-actions.test.ts`.
 */

type Messages = typeof pl;

async function open(page: Page, locale: string, m: Messages): Promise<void> {
  await page.goto(`/${locale}/candidate/profil/import-cv`);
  await page.getByRole('button', { name: m.cookies.rejectOptional }).click();
  await expect(page.getByRole('heading', { level: 1, name: m.cvImport.title })).toBeVisible();
}

async function upload(page: Page, m: Messages, text: string): Promise<void> {
  await page.getByLabel(m.cvImport.fileLabel).setInputFiles({ name: 'cv.docx', mimeType: DOCX_TYPE, buffer: buildDocx(text) });
  await page.getByRole('button', { name: m.cvImport.prepare }).click();
}

for (const [locale, m] of Object.entries({ pl, en })) {
  test(`${locale}: podgląd bez referentów, zapis tylko zaznaczonych propozycji`, async ({ page }) => {
    await open(page, locale, m);
    await upload(page, m, CV_WITH_REFEREES);

    const preview = page.getByLabel(m.cvImport.previewLabel);
    await expect(preview).toBeVisible();
    const sent = (await preview.textContent()) ?? '';
    expect(sent).toContain('wózka widłowego');
    for (const value of Object.values(REFEREES)) expect(sent).not.toContain(value);

    await page.getByRole('button', { name: m.cvImport.send }).click();
    await expect(page.getByRole('heading', { name: m.cvImport.reviewTitle })).toBeFocused();
    const boxes = page.getByRole('checkbox');
    expect(await boxes.count()).toBeGreaterThan(2);
    for (const box of await boxes.all()) await expect(box).not.toBeChecked();
    await expect(page.getByText(REFEREES.email1)).toHaveCount(0);

    const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    // Kontrola ujemna: bez zaznaczenia nic nie jest wysyłane do zapisu.
    await page.getByRole('button', { name: m.cvImport.apply }).click();
    await expect(page.getByRole('alert').filter({ hasText: m.cvImport.errorNothingSelected })).toBeVisible();

    // Edycja wartości przed zapisem: za długa (limit kreatora 160 znaków) → błąd przy polu
    // i fokus na nim, bez zapisu; po poprawce zapis poprawionej wartości.
    await page.getByRole('checkbox', { name: 'VCA' }).check();
    const vca = page.getByLabel(m.cvImport.editLabel.replace('{value}', 'VCA'));
    await vca.fill('V'.repeat(161));
    await page.getByRole('button', { name: m.cvImport.apply }).click();
    await expect(page.getByRole('alert').filter({ hasText: m.cvImport.errorFieldsInvalid })).toBeVisible();
    await expect(vca).toBeFocused();
    await expect(vca).toHaveAttribute('aria-invalid', 'true');
    await expect(vca).toHaveAccessibleDescription(m.cvImport.errorValueTooLong.replace('{max}', '160'));
    await expect(page.getByRole('heading', { name: m.cvImport.doneTitle })).toHaveCount(0);

    await vca.fill('VCA VOL');
    await expect(vca).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('checkbox', { name: 'VCA VOL' })).toBeChecked();
    await page.getByRole('button', { name: m.cvImport.apply }).click();
    await expect(page.getByRole('heading', { name: m.cvImport.doneTitle })).toBeFocused();
  });
}

test('pl: CV z numerem NISS jest odrzucane przed podglądem i przed AI', async ({ page }) => {
  await open(page, 'pl', pl);
  await upload(page, pl, `${CV_WITH_REFEREES}\nNISS: 85.07.30-033.28`);
  await expect(page.getByRole('alert').filter({ hasText: pl.errors.cvImportSensitiveData })).toBeVisible();
  await expect(page.getByLabel(pl.cvImport.previewLabel)).toHaveCount(0);
});

test('en: PDF is read locally on the server; the references section is removed', async ({ page }) => {
  await open(page, 'en', en);
  const pdf = buildPdf([
    'John Test',
    'Work experience',
    'Warehouse operative 2019-2024, forklift and hand scanner, VCA',
    'References',
    `${REFEREES.email1} ${REFEREES.phone1}`,
    'Hobbies',
    'Cycling',
  ]);
  await page.getByLabel(en.cvImport.fileLabel).setInputFiles({ name: 'cv.pdf', mimeType: PDF_TYPE, buffer: pdf });
  await page.getByRole('button', { name: en.cvImport.prepare }).click();
  const preview = page.getByLabel(en.cvImport.previewLabel);
  await expect(preview).toContainText('Warehouse operative');
  await expect(preview).not.toContainText(REFEREES.email1);
  await expect(preview).not.toContainText('478');
});
