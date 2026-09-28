import { expect, test, type Page } from '@playwright/test';

import AxeBuilder from './fixtures/axe';
import { LOCALES, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * Tryb ogłoszeniowy (#1135, #1137; epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 * - `/candidate/ustawienia`: bez sekcji widoczności profilu dla firm (reszta ustawień jest);
 * - `/admin/pytania` → 404, a w nawigacji admina brak pozycji „Pytania w ofertach”;
 * - krok 7 kreatora oferty bez sekcji pytań screeningowych.
 *
 * Wymaga serwera w trybie ogłoszeniowym: `E2E_PORTAL_LEGAL_MODE= npx playwright test
 * classifieds-profile-screening`. Domyślny przebieg (serwer `RECRUITMENT`, #1136) pomija ten plik —
 * zachowanie rekrutacyjne pokrywają `candidate-profile-visibility`, `admin-screening-review`,
 * `job-wizard-screening`.
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'serwer testowy w trybie RECRUITMENT (E2E_PORTAL_LEGAL_MODE=)');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoBlockingA11y(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => v.id)).toEqual([]);
}

for (const locale of LOCALES) {
  test(`ustawienia kandydata bez widoczności profilu dla firm (${locale})`, async ({ page }) => {
    const m = messages(locale);
    await page.goto(`/${locale}/candidate/ustawienia`);
    await rejectOptionalCookies(page, locale);
    await expect(page.locator('main h1')).toHaveText(m.settings.title);
    // Pozostałe sekcje zostają (wiek, dane konta), sekcji widoczności nie ma wcale.
    await expect(page.getByRole('heading', { name: m.ageAttestation.sectionTitle })).toBeVisible();
    await expect(page.getByRole('heading', { name: m.profileVisibility.sectionTitle })).toHaveCount(0);
    await expect(page.locator('#profile-visibility-title')).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expectNoBlockingA11y(page);
  });

  test(`przegląd pytań screeningowych admina = 404, brak w nawigacji (${locale})`, async ({ page }) => {
    const m = messages(locale);
    const res = await page.goto(`/${locale}/admin/pytania`);
    expect(res?.status()).toBe(404);

    await page.goto(`/${locale}/admin`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('link', { name: m.admin.navScreening, exact: true })).toHaveCount(0);
    await expect(page.locator('a[href*="/admin/pytania"]')).toHaveCount(0);
  });
}

test('krok 7 kreatora oferty bez pytań screeningowych (pl)', async ({ page }) => {
  const t = messages('pl').jobWizard;
  const next = page.getByRole('button', { name: t.next, exact: true });
  const addChip = async (label: string, value: string) => {
    const input = page.getByLabel(label, { exact: true });
    await input.fill(value);
    await input.locator('..').getByRole('button', { name: t.add, exact: true }).click();
  };

  await page.goto('/pl/employer/oferty/nowa');
  await rejectOptionalCookies(page, 'pl');
  await page.getByLabel(t.titleLabel).fill('Kierowca C+E');
  await page.getByRole('combobox', { name: t.categoryLabel }).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.occupationLabel).fill('Kierowca');
  await next.click();
  await page.getByRole('combobox', { name: t.contractTypeLabel }).click();
  await page.getByRole('option').first().click();
  await page.getByLabel(t.workingHoursLabel).fill('40 h');
  await next.click();
  await page.getByLabel(t.cityLabel).fill('Gandawa');
  await page.getByLabel(t.regionLabel).fill('Flandria');
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step4Title })).toBeVisible();
  await next.click();
  await page.getByLabel(t.descriptionLabel).fill('Transport międzynarodowy z bazy w Gandawie, stałe trasy.');
  await addChip(t.responsibilitiesLabel, 'Przewóz ładunków');
  await next.click();
  await addChip(t.requirementsMandatoryLabel, 'Prawo jazdy C+E');
  await next.click();

  await expect(page.getByRole('heading', { level: 2, name: t.step7Title })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: t.screeningTitle })).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.screeningAdd })).toHaveCount(0);
  // Krok przechodzi dalej bez pytań.
  await next.click();
  await expect(page.getByRole('heading', { level: 2, name: t.step8Title })).toBeVisible();
});
