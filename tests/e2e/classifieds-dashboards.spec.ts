import AxeBuilder from './fixtures/axe';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * Tryb ogłoszeniowy — pulpity (epik #1128; decyzja produktowa: portal ogłoszeniowy).
 * Pulpit pracodawcy: w miejscu „Top dopasowani” skrót statystyk ogłoszeń (najczęściej oglądane
 * oferty z wyświetleniami i kliknięciami „Aplikuj u pracodawcy”) z jednym odnośnikiem do
 * `/employer/statystyki`. Pulpit kandydata: w miejscu polecanych ofert sekcja ofert z zapisanych
 * wyszukiwań (tryb demo = brak zapisanych wyszukiwań → zachęta do zapisania). Axe WCAG A/AA
 * (critical/serious) 320 i 1280 px, bez poziomego przewijania.
 *
 * Wymaga serwera w trybie ogłoszeniowym: `E2E_PORTAL_LEGAL_MODE= npx playwright test
 * classifieds-dashboards`. Domyślny przebieg (serwer `RECRUITMENT`) pomija ten plik — widok
 * rekrutacyjny pokrywają `employer-dashboard-a11y` i `panel-a11y`.
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'serwer testowy w trybie RECRUITMENT (E2E_PORTAL_LEGAL_MODE=)');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

type Messages = {
  dashboard: Record<
    | 'listingStatsTitle' | 'funnelDetails' | 'topMatched' | 'recommendedJobs' | 'savedSearchJobsTitle'
    | 'savedSearchJobsNone' | 'savedSearchJobsCta' | 'newJobsSub' | 'candidateIntro' | 'employerGreetingSubGeneric',
    string
  >;
};
const messages = (locale: string): Messages =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Messages;

async function storeConsent(page: Page) {
  await page.context().addCookies([{
    name: 'pracujbe_consent',
    value: JSON.stringify({
      v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
      categories: { necessary: true, preferences: false, analytics: false },
      ts: '2026-01-01T00:00:00.000Z',
      id: 'classifieds-dashboards-e2e',
    }),
    url: 'http://localhost:3000',
    sameSite: 'Lax',
  }]);
}

for (const locale of LOCALES) {
  test(`${locale}: pulpit pracodawcy — skrót statystyk ogłoszeń zamiast „Top dopasowani”`, async ({ page }) => {
    const t = messages(locale);
    await storeConsent(page);
    await page.goto(`/${locale}/employer`);
    const main = page.getByRole('main');
    const tile = main.getByTestId('employer-listing-stats-link');
    await expect(tile.getByRole('heading', { level: 2, name: t.dashboard.listingStatsTitle })).toBeVisible();
    // Dane demo: co najmniej jedna oferta z liczbą wyświetleń i kliknięć; jeden odnośnik do statystyk.
    await expect(tile.getByRole('heading', { level: 3 }).first()).toBeVisible();
    await expect(tile.getByRole('link', { name: t.dashboard.funnelDetails })).toHaveCount(1);
    await expect(tile.getByRole('link', { name: t.dashboard.funnelDetails })).toHaveAttribute('href', `/${locale}/employer/statystyki`);
    await expect(main.getByText(t.dashboard.topMatched, { exact: true })).toHaveCount(0);
    await expect(main.getByText(t.dashboard.employerGreetingSubGeneric, { exact: true })).toHaveCount(0);
  });

  test(`${locale}: pulpit kandydata — oferty z zapisanych wyszukiwań zamiast polecanych`, async ({ page }) => {
    const t = messages(locale);
    await storeConsent(page);
    await page.goto(`/${locale}/candidate`);
    const section = page.getByTestId('candidate-saved-search-jobs');
    await expect(section.getByRole('heading', { level: 2, name: t.dashboard.savedSearchJobsTitle })).toBeVisible();
    // Tryb demo: brak zapisanych wyszukiwań → zachęta z linkiem do listy ofert.
    await expect(section.getByText(t.dashboard.savedSearchJobsNone)).toBeVisible();
    await expect(section.getByRole('link', { name: t.dashboard.savedSearchJobsCta })).toHaveAttribute('href', `/${locale}/oferty-pracy`);
    const main = page.getByRole('main');
    await expect(main.getByText(t.dashboard.recommendedJobs, { exact: true })).toHaveCount(0);
    // Bez obietnicy dopasowania: kafelek „Nowe oferty” nie mówi o dopasowaniu do profilu.
    await expect(main.getByText(t.dashboard.newJobsSub, { exact: true })).toHaveCount(0);
    await expect(main.getByText(t.dashboard.candidateIntro, { exact: true })).toHaveCount(0);
  });
}

for (const width of [1280, 320] as const) {
  for (const path of ['employer', 'candidate'] as const) {
    test(`/${path} (tryb ogłoszeniowy) bez naruszeń WCAG A/AA (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await storeConsent(page);
      for (const locale of width === 320 ? LOCALES : (['pl', 'en'] as const)) {
        await page.goto(`/${locale}/${path}`);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const blocking = results.violations
          .filter((v) => BLOCKING.has(v.impact ?? ''))
          .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        expect(blocking, `${path} ${locale}`).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path} ${locale}`).toBeLessThanOrEqual(0);
      }
    });
  }
}
