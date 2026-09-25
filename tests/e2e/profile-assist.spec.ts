import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';

/**
 * Asystent budowania profilu z odpowiedzi (#37, część kandydata) — tryb demo z atrapą
 * dostawcy AI (`AI_PROFILE_ASSIST_PROVIDER=fixture`, playwright.config.ts). Zero wywołań
 * prawdziwego API.
 *
 * Pokrywa: informacja o AI przed pierwszym użyciem w każdym języku i powiązana z przyciskiem
 * (czytnik ekranu ją odczytuje), telefon 320 px; propozycje domyślnie niezaznaczone; zapis tylko
 * zaznaczonych; kontrole ujemne — NISS w odpowiedzi (odmowa, bez propozycji), zatwierdzenie
 * bez zaznaczenia (blokada). Warstwę akcji dowodzi `profile-assist-actions.test.ts`.
 */

type Messages = typeof pl;
const WORK = 'Przez 3 lata pracowałem w magazynie, jeździłem wózkiem widłowym. Mam VCA.';

async function open(page: Page, locale: string, m: Messages): Promise<void> {
  await page.goto(`/${locale}/candidate/profil/asystent`);
  await page.getByRole('button', { name: m.cookies.rejectOptional }).click();
  await expect(page.getByRole('heading', { level: 1, name: m.profileAssist.title })).toBeVisible();
}

async function axe(page: Page): Promise<unknown[]> {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

for (const [locale, m] of Object.entries({ pl, nl, fr, en })) {
  test(`${locale}: informacja o AI przed pierwszym użyciem opisuje przycisk (320 px)`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await open(page, locale, m);
    const button = page.getByRole('button', { name: m.profileAssist.propose });
    await expect(page.getByText(m.profileAssist.aiNotice)).toBeVisible();
    await expect(button).toHaveAccessibleDescription(new RegExp(m.profileAssist.aiNotice.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(await axe(page)).toEqual([]);
  });
}

test('pl: propozycje niezaznaczone, zapis tylko zaznaczonych', async ({ page }) => {
  await open(page, 'pl', pl);
  await page.getByLabel(pl.profileAssist.questionWork).fill(WORK);
  await page.getByRole('button', { name: pl.profileAssist.propose }).click();
  await expect(page.getByRole('heading', { name: pl.profileAssist.reviewTitle })).toBeFocused();
  const boxes = page.getByRole('checkbox');
  expect(await boxes.count()).toBeGreaterThan(1);
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();
  expect(await axe(page)).toEqual([]);

  // Kontrola ujemna: bez zaznaczenia nic nie jest zapisywane.
  await page.getByRole('button', { name: pl.profileAssist.apply }).click();
  await expect(page.getByRole('alert').filter({ hasText: pl.profileAssist.errorNothingSelected })).toBeVisible();

  await page.getByRole('checkbox', { name: 'VCA' }).check();
  await page.getByRole('button', { name: pl.profileAssist.apply }).click();
  await expect(page.getByRole('heading', { name: pl.profileAssist.doneTitle })).toBeFocused();
});

test('pl: odpowiedź z numerem NISS jest odrzucana przed AI, odpowiedzi zostają', async ({ page }) => {
  await open(page, 'pl', pl);
  const field = page.getByLabel(pl.profileAssist.questionWork);
  await field.fill(`${WORK} NISS 85.07.30-033.28`);
  await page.getByRole('button', { name: pl.profileAssist.propose }).click();
  await expect(page.getByRole('alert').filter({ hasText: pl.errors.profileAssistSensitiveData })).toBeVisible();
  await expect(page.getByRole('heading', { name: pl.profileAssist.reviewTitle })).toHaveCount(0);
  await expect(field).toHaveValue(`${WORK} NISS 85.07.30-033.28`);
});
