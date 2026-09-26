import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * Dane polowe Core Web Vitals w panelu admina (tryb DEMO: bez bazy i bez Cloudflare —
 * raport przykładowy oznaczony na stronie). Źródłem w produkcji jest Cloudflare Web Analytics
 * (beacon po zgodzie analitycznej); strona nie ładuje w przeglądarce żadnego skryptu pomiaru.
 */

type AdminMessages = { admin: Record<string, string> };
const admin = (locale: string) =>
  (JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as AdminMessages)
    .admin;

for (const locale of LOCALES) {
  test(`admin: wydajność stron — raport, okres, oznaczenie demo (${locale})`, async ({ page }) => {
    const t = admin(locale);
    const external: string[] = [];
    page.on('request', (req) => {
      const host = new URL(req.url()).hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') external.push(host);
    });

    await page.goto(`/${locale}/admin`);
    await rejectOptionalCookies(page, locale);
    await page.getByRole('link', { name: t.navWebVitals }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/wydajnosc`));
    await expect(page.getByRole('heading', { level: 1, name: t.webVitalsTitle })).toBeVisible();
    await expect(page.getByText(t.webVitalsDemoNotice)).toBeVisible();

    const period = page.getByRole('navigation', { name: t.webVitalsPeriodLabel });
    await expect(period.locator('[aria-current="page"]')).toHaveCount(1);
    await period.getByRole('link', { name: /^7\D/ }).click();
    await expect(page).toHaveURL(/dni=7/);
    await expect(period.locator('[aria-current="page"]')).toHaveAttribute('href', /dni=7/);

    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader', { name: t.webVitalsColPath })).toBeVisible();
    await expect(table.getByRole('rowheader', { name: '/pl/oferty-pracy' })).toBeVisible();
    // Ocena słowem obok liczby (nie tylko kolor).
    await expect(table.getByText(t.webVitalsRating_poor).first()).toBeVisible();

    // Strona nie łączy się z Cloudflare z przeglądarki (odczyt API wyłącznie na serwerze).
    expect(external.filter((h) => h.includes('cloudflare'))).toEqual([]);
  });
}
