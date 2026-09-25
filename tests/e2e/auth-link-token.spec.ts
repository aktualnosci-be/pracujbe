import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Linki z e-maili kont (#24, #505): token jest we fragmencie `#token=`, więc nie trafia do
 * serwera, logów ani nagłówka Referer. Strona po odczycie usuwa go z paska adresu i historii.
 * Otwarcie linku niczego nie wykonuje — potwierdzenie adresu wymaga kliknięcia przycisku.
 * Brak tokenu → jasny komunikat i droga do nowego linku, bez formularza.
 */

type AuthMessages = {
  auth: { confirmEmailSubmit: string; setPassword: string; linkMissing: string; requestNewResetLink: string };
};
const t = (locale: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as AuthMessages;

const RESET_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx';

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  test(`ustaw-nowe-haslo (${locale}): token z fragmentu, usunięty z adresu, nie trafia do serwera`, async ({ page }) => {
    const serverUrls: string[] = [];
    page.on('request', (request) => serverUrls.push(request.url()));
    await page.goto(`/${locale}/ustaw-nowe-haslo#token=${RESET_TOKEN}`);
    const submit = page.getByRole('button', { name: t(locale).auth.setPassword });
    await expect(submit).toBeEnabled();
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    expect(serverUrls.filter((url) => url.includes(RESET_TOKEN))).toEqual([]);
  });

  test(`potwierdz-email (${locale}): przycisk zamiast automatycznej akcji, adres bez tokenu`, async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(request.url());
    });
    await page.goto(`/${locale}/potwierdz-email#token=aaa.bbb.ccc`);
    await expect(page.getByRole('button', { name: t(locale).auth.confirmEmailSubmit })).toBeEnabled();
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    // Samo otwarcie linku (np. przez skaner poczty) nie wywołuje akcji serwera.
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
  });
}

test('ustaw-nowe-haslo bez tokenu: komunikat i link do nowej prośby, bez formularza', async ({ page }) => {
  await page.goto('/pl/ustaw-nowe-haslo');
  await expect(page.locator('main').getByRole('alert')).toHaveText(t('pl').auth.linkMissing);
  await expect(page.getByRole('link', { name: t('pl').auth.requestNewResetLink })).toHaveAttribute('href', '/pl/reset-hasla');
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('potwierdz-email bez tokenu: komunikat, bez przycisku potwierdzenia', async ({ page }) => {
  await page.goto('/pl/potwierdz-email');
  await expect(page.locator('main').getByRole('alert')).toHaveText(t('pl').auth.linkMissing);
  await expect(page.getByRole('button', { name: t('pl').auth.confirmEmailSubmit })).toHaveCount(0);
});
