import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test } from '@playwright/test';

/**
 * Regresja #362 (tryb demo, 390×844): plik CV > 5 MB jest odrzucany w przeglądarce z komunikatem
 * o rozmiarze — bez żądania do serwera (limit ciała Server Actions 6mb → 413 → granica błędu).
 * Zły format → komunikat o formacie. Strona profilu działa dalej.
 * Kontrola ujemna: bez kontroli rozmiaru w CvUpload 7 MB trafia na 413 i `main` pokazuje błąd strony.
 */

const pl = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src', 'messages', 'pl.json'), 'utf-8'),
) as { files: Record<string, string> };

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'cv-upload-size-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
});

const pdf = (sizeMb: number) => {
  const buffer = Buffer.alloc(Math.round(sizeMb * 1024 * 1024), 0x20);
  buffer.write('%PDF-1.4');
  return buffer;
};

for (const sizeMb of [7, 5.5]) {
  test(`plik ${sizeMb} MB: komunikat o rozmiarze bez żądania do serwera`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pl/candidate/profil');

    const actions: string[] = [];
    page.on('request', (request) => {
      if (request.headers()['next-action']) actions.push(request.url());
    });

    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: pdf(sizeMb) });

    await expect(page.getByRole('alert').filter({ hasText: pl.files.errorTooLarge })).toBeVisible();
    await expect(page.getByRole('button', { name: pl.files.upload, exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: pl.files.cvTitle })).toBeVisible();
    expect(actions).toEqual([]);
  });
}

test('zły format: komunikat o dozwolonych formatach', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pl/candidate/profil');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'zdjecie.png', mimeType: 'image/png', buffer: Buffer.from('png') });
  await expect(page.getByRole('alert').filter({ hasText: pl.files.errorType })).toBeVisible();
});
