import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cookieBanner, LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * #486 — „Twoje dane i konto” w ustawieniach kandydata (tryb demo, bez backendu):
 * pobranie pliku JSON z tej samej witryny, obce żądanie odrzucone, usunięcie konta
 * wymaga wpisania adresu (błąd przy polu, fokus), sukces demo niczego nie usuwa.
 * Przepływ na prawdziwej bazie dowodzi `supabase/tests/rls.sql` sekcja DR486.
 */

type Messages = {
  accountData: {
    sectionTitle: string;
    exportButton: string;
    exportDemo: string;
    deleteStart: string;
    confirmLabel: string;
    confirmButton: string;
    cancel: string;
    mismatch: string;
    deletedDemo: string;
  };
};

function messages(locale: string): Messages {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Messages;
}

async function open(page: Page, locale: string): Promise<Messages['accountData']> {
  await page.goto(`/${locale}/candidate/ustawienia`);
  if (await cookieBanner(page).isVisible()) await rejectOptionalCookies(page, locale);
  const m = messages(locale).accountData;
  await expect(page.getByRole('heading', { level: 2, name: m.sectionTitle })).toBeVisible();
  return m;
}

for (const locale of LOCALES) {
  test(`pobranie danych zapisuje plik JSON (demo): ${locale}`, async ({ page }) => {
    const m = await open(page, locale);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: m.exportButton }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pracujbe-dane-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const body = JSON.parse(readFileSync(path, 'utf8')) as { format: string; demo: boolean };
    expect(body).toMatchObject({ format: 'pracujbe-export/1', demo: true });
    await expect(page.getByRole('status').filter({ hasText: m.exportDemo })).toBeVisible();
  });
}

test('eksport nie odpowiada na żądanie bez Origin tej witryny', async ({ request }) => {
  const foreign = await request.post('/api/account/export', { headers: { origin: 'https://evil.example' } });
  expect(foreign.status()).toBe(403);
  expect(foreign.headers()['cache-control']).toBe('private, no-store');
  const missing = await request.post('/api/account/export');
  expect(missing.status()).toBe(403);
});

test('usunięcie konta wymaga adresu e-mail; błąd przy polu, anulowanie wraca fokusem (demo)', async ({ page }) => {
  const m = await open(page, 'pl');
  const start = page.getByRole('button', { name: m.deleteStart });
  await start.click();
  const field = page.getByLabel(m.confirmLabel);
  await expect(field).toBeFocused();

  await page.getByRole('button', { name: m.confirmButton }).click();
  await expect(page.getByRole('alert').filter({ hasText: m.mismatch })).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();

  await page.getByRole('button', { name: m.cancel }).click();
  await expect(start).toBeFocused();

  await start.click();
  await page.getByLabel(m.confirmLabel).fill('kandydat@example.com');
  await page.getByRole('button', { name: m.confirmButton }).click();
  const done = page.getByRole('status').filter({ hasText: m.deletedDemo });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
});

test('sekcja danych bez naruszeń axe (320 px, formularz otwarty)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const m = await open(page, 'pl');
  await page.getByRole('button', { name: m.deleteStart }).click();
  const results = await new AxeBuilder({ page })
    .include('section[aria-labelledby="account-data-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});
