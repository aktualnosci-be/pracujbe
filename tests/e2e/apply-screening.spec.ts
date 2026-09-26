import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import en from '../../src/messages/en.json';
import pl from '../../src/messages/pl.json';

/**
 * #101 — pytania screeningowe w formularzu aplikowania (serwer fixture
 * `playwright.applications-fixture.config.ts`: oferta 1003 ma pytania, zapis bez bazy kończy się
 * komunikatem trybu demo). Wymagalność egzekwuje też baza (`rls.sql` SQ101-8).
 * - kandydat widzi pytania i skutek odpowiedzi przed wysłaniem;
 * - brak odpowiedzi na pytania wymagane → błąd przy pytaniu i fokus, bez wysyłki;
 * - po odpowiedzi formularz przechodzi walidację (w fixture: komunikat demo);
 * - tekst pytania w języku strony, z tłumaczeniem albo w języku oferty.
 */
const JOB_PATH = '/pl/oferty-pracy/truck-driver-ghent-1003';
const Q_YES_NO = 'f1010000-0000-4000-8000-000000000001';
const Q_CHOICE = 'f1010000-0000-4000-8000-000000000002';

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: { necessary: true, preferences: false, analytics: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'apply-screening-e2e',
      }),
      url: baseURL!,
      sameSite: 'Lax',
    },
  ]);
});

test('wymagane pytania blokują wysyłkę przy polu, odpowiedzi przechodzą walidację', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(JOB_PATH);
  await page.getByRole('button', { name: pl.jobs.applyNow }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: pl.apply.screeningTitle })).toBeVisible();
  await expect(dialog.getByText(pl.apply.screeningNote.split('{company}')[1]!.trim())).toBeVisible();
  const yesNo = dialog.getByRole('radiogroup', { name: 'Czy masz prawo jazdy kat. C+E?' });
  await expect(yesNo).toBeVisible();

  await dialog.locator('#apply-phone').fill('+32 470 12 34 56');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: pl.apply.submit }).click();

  // Kontrola ujemna: dwa pytania wymagane bez odpowiedzi → błędy przy pytaniach, fokus na pierwszym.
  await expect(dialog.locator(`#apply-q-${Q_YES_NO}`)).toBeFocused();
  await expect(yesNo).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.locator(`#apply-q-${Q_YES_NO}-error`)).toHaveText(pl.apply.screeningRequired);
  await expect(dialog.locator(`#apply-q-${Q_CHOICE}-error`)).toHaveText(pl.apply.screeningRequired);
  await expect(dialog.getByRole('alert')).toHaveCount(0);

  await yesNo.getByRole('radio', { name: pl.apply.screeningYes }).check();
  await expect(dialog.locator(`#apply-q-${Q_YES_NO}-error`)).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Komunikacją publiczną' }).check();
  await dialog.getByLabel(/Od kiedy możesz zacząć/).fill('2026-10-01');

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

  await dialog.getByRole('button', { name: pl.apply.submit }).click();
  await expect(dialog.getByRole('alert')).toHaveText(pl.apply.demoUnavailable);
});

test('tekst pytań w języku strony, bez tłumaczenia w języku oferty', async ({ page }) => {
  await page.goto('/en/oferty-pracy/truck-driver-ghent-1003');
  await page.getByRole('button', { name: en.jobs.applyNow }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radiogroup', { name: 'Do you hold a C+E driving licence?' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Own car' })).toBeVisible();
  await expect(dialog.getByText(en.apply.screeningTitle)).toBeVisible();
});

test('oferta bez pytań: formularz bez sekcji pytań', async ({ page }) => {
  await page.goto('/pl/oferty-pracy/bricklayer-brussels-1002');
  await page.getByRole('button', { name: pl.jobs.applyNow }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#apply-phone')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: pl.apply.screeningTitle })).toHaveCount(0);
});
