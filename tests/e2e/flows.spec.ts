import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, test } from '@playwright/test';

import { localeNames } from '../../src/i18n/routing';
import { messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * Testy e2e kluczowych przepływów (na danych DEMO, bez Supabase).
 *
 * Zakres (uzupełnia smoke.spec.ts / seo.spec.ts):
 *  1. Wielojęzyczność: /pl /nl /fr /en renderują H1 hero w danym języku.
 *  2. Szczegóły oferty: z listy -> detal (H1) + widoczne CTA aplikowania.
 *  3. Panele = noindex (Invariant #9): candidate/employer/admin w 4 językach renderują się
 *     w trybie demo (bez sesji przepuszczane) i mają meta robots noindex.
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

/**
 * #376: etykieta przełącznika (`footer.langLabel`) i nazwy języków (`localeNames`) z tych samych
 * źródeł co UI; przełącznik w stopce (`contentinfo`), nie „ostatni combobox” na stronie.
 * Co najmniej jedna zmiana startuje z innego języka niż PL.
 */
const LOCALE_SWITCHES = [
  { from: 'pl', to: 'nl' },
  { from: 'fr', to: 'en' },
] as const;

for (const { from, to } of LOCALE_SWITCHES) {
  test(`zmiana języka zachowuje aktywne filtry ofert (${from} → ${to})`, async ({ page }) => {
    const query =
      'keyword=spawacz&city=Bruksela&category=construction&contractType=permanent&salaryMin=20&salaryMax=35&accommodation=provided&immediate=1&noLang=1&date=7d&sort=salary&page=2';
    await page.goto(`/${from}/oferty-pracy?${query}#wyniki`);
    await rejectOptionalCookies(page, from);

    await page
      .getByRole('contentinfo')
      .getByRole('combobox', { name: messages(from).footer.langLabel, exact: true })
      .click();
    await page.getByRole('option', { name: localeNames[to], exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/${to}/oferty-pracy\\?${query}#wyniki$`));
    await expect(page.locator('html')).toHaveAttribute('lang', to);
  });
}

test('szczegóły oferty otwierają się z listy i mają CTA aplikowania', async ({ page }) => {
  const pl = messages('pl');
  await page.goto('/pl/oferty-pracy');
  await rejectOptionalCookies(page, 'pl');

  // #376: link z KARTY wyniku (nagłówek artykułu na liście w `main`), nie dowolny
  // `a[href*="/oferty-pracy/"]` (breadcrumb, stopka).
  const results = page.getByRole('main').getByRole('listitem').getByRole('article');
  await expect(results).not.toHaveCount(0);
  const firstJob = results.first().getByRole('heading', { level: 3 }).getByRole('link');
  const title = (await firstJob.innerText()).trim();
  expect(title).not.toBe('');
  await firstJob.click();

  // Detal oferty: H1 = tytuł klikniętej oferty.
  await expect(page).toHaveURL(/\/pl\/oferty-pracy\/[^/?#]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);

  // CTA aplikowania z `jobs.applyNow` (nazwa = etykieta + podpowiedź): dokładnie jeden
  // widoczny przycisk (desktop — panel boczny; dolny pasek mobilny jest ukryty).
  const applyName = new RegExp(`^${pl.jobs.applyNow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
  await expect(page.getByRole('button', { name: applyName }).filter({ visible: true })).toHaveCount(1);
});

type PanelMessages = { dashboard: { greetingNoName: string; greetingEmployer: string }; admin: { title: string } };

/** Nagłówek H1 panelu w danym języku (kandydat w demo nie ma imienia → sam prefiks powitania). */
function panelHeading(locale: string, panel: 'candidate' | 'employer' | 'admin'): string {
  const file = resolve(process.cwd(), 'src', 'messages', `${locale}.json`);
  const messages = JSON.parse(readFileSync(file, 'utf-8')) as PanelMessages;
  // Demo nie zna imienia kandydata, więc pulpit wita neutralnie, bez wiszącego przecinka (#334).
  if (panel === 'candidate') return messages.dashboard.greetingNoName;
  if (panel === 'employer') return messages.dashboard.greetingEmployer;
  return messages.admin.title;
}

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  for (const panel of ['candidate', 'employer', 'admin'] as const) {
    test(`panel /${locale}/${panel} renderuje się (demo) i ma meta robots noindex`, async ({ page }) => {
      const response = await page.goto(`/${locale}/${panel}`);
      // Brak panelu (404/5xx) albo przekierowanie gdzie indziej = porażka, nie pominięcie.
      expect(response?.status(), `status /${locale}/${panel}`).toBe(200);
      await expect(page).toHaveURL(new RegExp(`/${locale}/${panel}$`));
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(panelHeading(locale, panel));
      // Invariant #9. Sprawdzamy meta robots z layoutu panelu, nie X-Robots-Tag —
      // ten nagłówek poza produkcją jest ustawiany globalnie dla całej witryny.
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    });
  }
}

test('strona regulaminu jest dostępna, ale noindex (placeholder, FUN-09)', async ({ page }) => {
  const res = await page.goto('/pl/regulamin');
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Treść prawna to placeholder → strona jest noindex do czasu zatwierdzenia (audyt FUN-09).
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
