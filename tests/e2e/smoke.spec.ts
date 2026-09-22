import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test } from '@playwright/test';

/**
 * Testy dymne (smoke) — działają na danych demonstracyjnych (bez Supabase).
 *
 * Zakres:
 *  1. Strona główna /pl: obecność nagłówka (heroTitle) i wyszukiwarki.
 *  2. Lista ofert /pl/oferty-pracy: wyniki (co najmniej jedna oferta).
 *  3. Baner cookies: po „odrzuć opcjonalne" znika, a analityka (GA) NIE jest ładowana.
 */

type Messages = {
  home: { heroTitle: string; searchButton: string };
  jobs: { pageTitle: string };
  cookies: { bannerTitle: string; rejectOptional: string };
};

function loadPlMessages(): Messages {
  const file = resolve(process.cwd(), 'src', 'messages', 'pl.json');
  return JSON.parse(readFileSync(file, 'utf-8')) as Messages;
}

const pl = loadPlMessages();

test('strona główna /pl pokazuje nagłówek i wyszukiwarkę', async ({ page }) => {
  await page.goto('/pl');

  // Nagłówek hero (H1) z tekstem z tłumaczeń.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pl.home.heroTitle);

  // Wyszukiwarka: landmark role="search" + przycisk wyszukiwania.
  const search = page.getByRole('search');
  await expect(search).toBeVisible();
  await expect(
    search.getByRole('button', { name: pl.home.searchButton }),
  ).toBeVisible();

  // Metryczka pochodzi z tego samego artefaktu co strona i pozostaje pre-1.0.
  const buildTime = page.locator('footer time[datetime]').last();
  const release = buildTime.locator('..');
  await expect(release).toContainText(/v0\.\d{8}\.\d+(?:\+[0-9a-f]{7,8})?/);
  await expect(buildTime).toHaveAttribute(
    'datetime',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
});

test('lista ofert /pl/oferty-pracy renderuje wyniki', async ({ page }) => {
  await page.goto('/pl/oferty-pracy');

  // Tytuł strony listy.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pl.jobs.pageTitle);

  // Co najmniej jedna oferta (link do szczegółów /oferty-pracy/<slug>).
  const jobLinks = page.locator('a[href*="/oferty-pracy/"]');
  expect(await jobLinks.count()).toBeGreaterThan(0);
});

test('baner cookies: odrzucenie opcjonalnych nie ładuje analityki (brak GA)', async ({
  page,
}) => {
  await page.goto('/pl');

  // Baner pojawia się po stronie klienta (po zamontowaniu).
  const banner = page.getByRole('region', { name: pl.cookies.bannerTitle });
  await expect(banner).toBeVisible();

  // Przed jakąkolwiek zgodą skrypt GA nie jest obecny.
  expect(await page.locator('script[src*="googletagmanager.com"]').count()).toBe(0);

  // Odrzucenie opcjonalnych zgód.
  await banner.getByRole('button', { name: pl.cookies.rejectOptional }).click();

  // Baner znika...
  await expect(banner).toBeHidden();

  // ...i analityka (Google Analytics) nadal NIE jest ładowana.
  expect(await page.locator('script[src*="googletagmanager.com"]').count()).toBe(0);
  const hasGtag = await page.evaluate(
    () => typeof (window as unknown as { gtag?: unknown }).gtag !== 'undefined',
  );
  expect(hasGtag).toBe(false);
});
