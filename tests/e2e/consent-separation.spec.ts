import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * #493: rejestracja kandydata i pracodawcy ma TRZY osobne pola — akceptację regulaminu
 * (wymagana), potwierdzenie zapoznania się z informacją o prywatności (wymagane, to nie zgoda)
 * i zgodę opcjonalną na e-maile marketingowe. Żadne nie jest domyślnie zaznaczone; brak
 * zgody opcjonalnej nie blokuje wysyłki. Wysyłkę przechwytujemy (POST server action), więc
 * test sprawdza, co formularz faktycznie wysyła, niezależnie od konfiguracji bazy.
 */

type Messages = {
  auth: {
    optionalConsentsLegend: string;
    marketingOptIn: string;
    error: { termsRequired: string; privacyNoticeRequired: string };
  };
};

const locales = ['pl', 'nl', 'fr', 'en'] as const;
const pages = [
  { slug: 'rejestracja', employer: false },
  { slug: 'rejestracja-pracodawca', employer: true },
] as const;

function msgs(locale: string): Messages {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
  ) as Messages;
}

async function fillAccount(page: Page, employer: boolean): Promise<void> {
  if (employer) await page.locator('#companyName').fill('Firma Test');
  await page.locator('#firstName').fill('Jan');
  await page.locator('#lastName').fill('Kowalski');
  await page.locator('#email').fill('jan@example.com');
  await page.locator('#password').fill('Haslo1234');
  await page.locator('#passwordConfirm').fill('Haslo1234');
}

/** Przechwytuje POST akcji rejestracji; zwraca treści wysłanych żądań. */
async function captureSubmits(page: Page, slug: string): Promise<string[]> {
  const bodies: string[] = [];
  await page.route(`**/${slug}`, async (route) => {
    if (route.request().method() === 'POST') {
      bodies.push(route.request().postData() ?? '');
      await route.fulfill({ status: 500, body: '' });
      return;
    }
    await route.continue();
  });
  return bodies;
}

for (const locale of locales) {
  for (const { slug, employer } of pages) {
    test(`/${locale}/${slug}: trzy osobne, niezaznaczone pola; zgoda opcjonalna w osobnej grupie`, async ({ page }) => {
      const t = msgs(locale);
      await page.goto(`/${locale}/${slug}`);

      const terms = page.locator('#agreeTerms');
      const privacy = page.locator('#privacyNoticeAck');
      const marketing = page.getByRole('checkbox', { name: t.auth.marketingOptIn });
      for (const box of [terms, privacy, marketing]) {
        await expect(box).toHaveCount(1);
        await expect(box).not.toBeChecked();
      }
      await expect(terms).toHaveAttribute('aria-required', 'true');
      await expect(privacy).toHaveAttribute('aria-required', 'true');
      await expect(marketing).not.toHaveAttribute('aria-required', 'true');
      await expect(page.getByRole('group', { name: t.auth.optionalConsentsLegend })).toContainText(
        t.auth.marketingOptIn,
      );
      // Jeden checkbox nie łączy celów: regulamin nie linkuje do prywatności i odwrotnie.
      await expect(page.locator('label[for="agreeTerms"] a')).toHaveCount(1);
      await expect(page.locator('label[for="privacyNoticeAck"] a')).toHaveCount(1);
    });
  }

  test(`/${locale}/rejestracja: bez regulaminu albo informacji o prywatności nic nie jest wysyłane`, async ({ page }) => {
    const t = msgs(locale);
    const bodies = await captureSubmits(page, 'rejestracja');
    await page.goto(`/${locale}/rejestracja`);
    await fillAccount(page, false);

    // Sama zgoda marketingowa nie zastępuje pól wymaganych.
    await page.getByRole('checkbox', { name: t.auth.marketingOptIn }).check();
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('#agreeTerms-error')).toHaveText(t.auth.error.termsRequired);
    await expect(page.locator('#privacyNoticeAck-error')).toHaveText(t.auth.error.privacyNoticeRequired);

    await page.locator('#agreeTerms').check();
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('#agreeTerms-error')).toHaveCount(0);
    await expect(page.locator('#privacyNoticeAck-error')).toHaveText(t.auth.error.privacyNoticeRequired);
    expect(bodies).toHaveLength(0);
  });
}

for (const { slug, employer } of pages) {
  test(`/pl/${slug}: odmowa zgody opcjonalnej nie blokuje wysyłki; wybór trafia osobno`, async ({ page }) => {
    const t = msgs('pl');
    const bodies = await captureSubmits(page, slug);
    await page.goto(`/pl/${slug}`);
    await fillAccount(page, employer);
    await page.locator('#agreeTerms').check();
    await page.locator('#privacyNoticeAck').check();
    // #492: rejestracja kandydata wymaga też deklaracji wieku (osobne pole, nie zgoda).
    if (!employer) await page.locator('#ageConfirmed').check();
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('"agreeTerms":true');
    expect(bodies[0]).toContain('"privacyNoticeAck":true');
    expect(bodies[0]).toContain('"marketingOptIn":false');

    // Ta sama wysyłka ze zgodą: zmienia się wyłącznie wybór opcjonalny.
    await page.getByRole('checkbox', { name: t.auth.marketingOptIn }).check();
    await page.locator('form button[type="submit"]').click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toContain('"marketingOptIn":true');
  });
}
