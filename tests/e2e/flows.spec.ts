import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test } from '@playwright/test';

/**
 * Testy e2e kluczowych przepływów (na danych DEMO, bez Supabase).
 *
 * Zakres (uzupełnia smoke.spec.ts / seo.spec.ts):
 *  1. Wielojęzyczność: /pl /nl /fr /en renderują H1 hero w danym języku.
 *  2. Szczegóły oferty: z listy -> detal (H1) + widoczne CTA aplikowania.
 *  3. Panele = noindex (Invariant #9): candidate/employer mają meta robots noindex,
 *     i renderują się w trybie demo (bez sesji przepuszczane).
 *  4. Strony prawne dostępne (regulamin), ale noindex — treść placeholder (FUN-09).
 */

type LocaleMessages = { home: { heroTitle: string } };

function heroTitle(locale: string): string {
  const file = resolve(process.cwd(), 'src', 'messages', `${locale}.json`);
  return (JSON.parse(readFileSync(file, 'utf-8')) as LocaleMessages).home.heroTitle;
}

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  test(`strona główna /${locale} renderuje hero w języku ${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heroTitle(locale));
    await expect(page).toHaveURL(new RegExp(`/${locale}(/|$)`));
  });
}

test('szczegóły oferty otwierają się z listy i mają CTA aplikowania', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');
  const firstJob = page.locator('a[href*="/oferty-pracy/"]').first();
  await expect(firstJob).toBeVisible();
  await firstJob.click();

  // Detal oferty: H1 z tytułem stanowiska.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/pl\/oferty-pracy\/.+/);

  // CTA aplikowania (przycisk otwierający modal/aplikację) — co najmniej jeden.
  const applyCta = page.getByRole('button', { name: /aplikuj/i });
  expect(await applyCta.count()).toBeGreaterThan(0);
});

for (const panel of ['candidate', 'employer']) {
  test(`panel /${panel} jest noindex i renderuje się (demo)`, async ({ page }) => {
    await page.goto(`/pl/${panel}`);
    // Invariant #9: panele wyłączone z indeksowania.
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', /noindex/);
    // Treść panelu się renderuje (jakikolwiek nagłówek).
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
}

test('strona regulaminu jest dostępna, ale noindex (placeholder, FUN-09)', async ({ page }) => {
  const res = await page.goto('/pl/regulamin');
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Treść prawna to placeholder → strona jest noindex do czasu zatwierdzenia (audyt FUN-09).
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
