import AxeBuilder from './fixtures/axe';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { LOCALES } from './fixtures/messages';

/**
 * Tryb ogłoszeniowy (#1147; epik #1128) — decyzja produktowa: portal ogłoszeniowy. Statystyki
 * pracodawcy = statystyki ogłoszenia: `/employer/statystyki` ma tytuł „Statystyki ogłoszeń”,
 * kafelki aktywnych ofert, wyświetleń i kliknięć „Aplikuj u pracodawcy”, lejek ofert bez wysłanych
 * aplikacji; bez lejka rekrutacyjnego, zgłoszeń i wiadomości „do odpowiedzi”. Pulpit ma w miejscu
 * lejka rekrutacyjnego odnośnik do statystyk. Axe WCAG A/AA (critical/serious) 320 i 1280 px.
 *
 * Wymaga serwera w trybie ogłoszeniowym: `E2E_PORTAL_LEGAL_MODE= npx playwright test
 * classifieds-employer-stats`. Domyślny przebieg (serwer `RECRUITMENT`, #1136) pomija ten plik —
 * widok rekrutacyjny pokrywają `panel-a11y`, `employer-dashboard-a11y` i unit
 * `classifieds-employer-stats` (kontrole ujemne obu wariantów).
 */

const classifieds = (process.env.E2E_PORTAL_LEGAL_MODE ?? 'RECRUITMENT').trim().toUpperCase() !== 'RECRUITMENT';
test.skip(!classifieds, 'serwer testowy w trybie RECRUITMENT (E2E_PORTAL_LEGAL_MODE=)');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

type Messages = {
  dashboard: Record<'listingStatsTitle' | 'funnelTitle' | 'newApplications' | 'messagesToAnswer' | 'funnelDetails', string>;
  jobFunnel: Record<'applyClicks' | 'applicationsSubmitted' | 'applyStarted' | 'consentNoteListing', string>;
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
      id: 'classifieds-stats-e2e',
    }),
    url: 'http://localhost:3000',
    sameSite: 'Lax',
  }]);
}

for (const locale of LOCALES) {
  test(`${locale}: /employer/statystyki = statystyki ogłoszenia`, async ({ page }) => {
    const t = messages(locale);
    await storeConsent(page);
    await page.goto(`/${locale}/employer/statystyki`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: t.dashboard.listingStatsTitle })).toBeVisible();
    await expect(main.getByText(t.jobFunnel.applyClicks, { exact: true }).first()).toBeVisible();
    await expect(main.getByTestId('job-funnel-consent-note')).toHaveText(t.jobFunnel.consentNoteListing);
    for (const text of [t.dashboard.funnelTitle, t.dashboard.newApplications, t.dashboard.messagesToAnswer,
      t.jobFunnel.applicationsSubmitted, t.jobFunnel.applyStarted]) {
      await expect(main.getByText(text, { exact: true })).toHaveCount(0);
    }
  });

  test(`${locale}: pulpit — odnośnik do statystyk ogłoszeń zamiast lejka rekrutacyjnego`, async ({ page }) => {
    const t = messages(locale);
    await storeConsent(page);
    await page.goto(`/${locale}/employer`);
    const section = page.getByTestId('employer-listing-stats-link');
    await expect(section.getByRole('heading', { level: 2, name: t.dashboard.listingStatsTitle })).toBeVisible();
    await expect(section.getByRole('link', { name: t.dashboard.funnelDetails })).toHaveAttribute('href', `/${locale}/employer/statystyki`);
    const main = page.getByRole('main');
    await expect(main.getByText(t.jobFunnel.applyClicks, { exact: true })).toBeVisible();
    // Liczniki zgłoszeń przy kartach ofert (`EmployerOffersPreview`) to osobny obszar (#1144).
    for (const text of [t.dashboard.funnelTitle, t.dashboard.messagesToAnswer]) {
      await expect(main.getByText(text, { exact: true })).toHaveCount(0);
    }
  });
}

for (const width of [1280, 320] as const) {
  test(`/employer/statystyki bez naruszeń WCAG A/AA (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await storeConsent(page);
    for (const locale of width === 320 ? LOCALES : (['pl', 'en'] as const)) {
      await page.goto(`/${locale}/employer/statystyki`);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      const blocking = results.violations
        .filter((v) => BLOCKING.has(v.impact ?? ''))
        .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      expect(blocking, locale).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, locale).toBeLessThanOrEqual(0);
    }
  });
}
