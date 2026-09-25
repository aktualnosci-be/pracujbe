import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ALERT_OFF_TOKEN_TTL_SECONDS,
  createAlertOffToken,
} from '../../src/lib/email/saved-search-alert-token';
import { createUnsubscribeToken } from '../../src/lib/email/unsubscribe-token';
import { clickCookieBanner, LOCALES } from './fixtures/messages';
import { E2E_UNSUBSCRIBE_SECRET } from './fixtures/unsubscribe';

/**
 * Zapisane wyszukiwania (#100), tryb DEMO (bez bazy).
 *
 * Lista ofert z filtrem pokazuje „Zapisz wyszukiwanie”; bez filtrów przycisku nie ma
 * (kontrola ujemna). Kliknięcie w demo daje jawny komunikat `role="alert"` (bez udawanego
 * sukcesu). Strona `/candidate/wyszukiwania` jest w nawigacji panelu, noindex, z jasnym
 * stanem demo. Bramka axe WCAG 2.x A/AA (critical/serious) przy 320 px bez poziomego
 * przewijania. Zapis, alerty, idempotencja i opt-out w bazie: rls.sql sekcja SS100.
 *
 * Link „wyłącz tylko ten alert” z e-maila jobMatch (`/{locale}/wypisz-alert#t=…`): token we
 * fragmencie (nie trafia do HTTP i znika z adresu), noindex, zapis dopiero po kliknięciu —
 * w demo jawny komunikat „niedostępne”. Zmianę nazwy i wyłączenie w bazie: rls.sql SS108.
 */

type Messages = {
  savedSearches: { save: string; demo: string; browse: string };
  savedSearchAlertOff: {
    title: string;
    confirmText: string;
    confirmButton: string;
    invalidTitle: string;
    expiredTitle: string;
    unavailableText: string;
  };
  dashboard: { navSearches: string };
  errors: { demoUnavailable: string };
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

function messages(locale: string): Messages {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Messages;
}

async function acceptNecessaryCookies(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'pracujbe_consent',
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '1.0',
        categories: { necessary: true, preferences: false, analytics: false, marketing: false },
        ts: '2026-01-01T00:00:00.000Z',
        id: 'saved-search-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

async function blockingViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
}

for (const locale of LOCALES) {
  test(`${locale}: „Zapisz wyszukiwanie” na liście ofert (#100)`, async ({ page }) => {
    const m = messages(locale);
    await acceptNecessaryCookies(page);
    await page.setViewportSize({ width: 320, height: 900 });

    // Kontrola ujemna: bez filtrów nie ma czego zapisać.
    await page.goto(`/${locale}/oferty-pracy`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: m.savedSearches.save })).toHaveCount(0);

    await page.goto(`/${locale}/oferty-pracy?category=warehouse`);
    const save = page.getByRole('button', { name: m.savedSearches.save });
    await expect(save).toBeVisible();
    const blocking = await blockingViolations(page);
    expect(blocking, blocking.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

    await save.click();
    await expect(page.getByRole('alert').filter({ hasText: m.errors.demoUnavailable })).toBeVisible();
    await expect(save).toBeEnabled();
  });

  test(`${locale}: strona zapisanych wyszukiwań w panelu kandydata (#100)`, async ({ page }) => {
    const m = messages(locale);
    await acceptNecessaryCookies(page);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${locale}/candidate/wyszukiwania`);

    await expect(page.getByRole('heading', { level: 1, name: m.dashboard.navSearches })).toBeVisible();
    await expect(page.getByText(m.savedSearches.demo)).toBeVisible();
    await expect(page.getByRole('link', { name: m.savedSearches.browse })).toHaveAttribute(
      'href',
      `/${locale}/oferty-pracy`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const blocking = await blockingViolations(page);
    expect(blocking, blocking.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
}

const ALERT_PROFILE = '8f2c1d3e-4b5a-4c6d-8e7f-901234567890';
const ALERT_SEARCH = '5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const alertToken = (now = Date.now()) =>
  createAlertOffToken({ profileId: ALERT_PROFILE, savedSearchId: ALERT_SEARCH }, E2E_UNSUBSCRIBE_SECRET, now);

for (const locale of LOCALES) {
  test(`${locale}: /wypisz-alert — potwierdzenie w języku strony, noindex, bez zapisu przy GET (#100)`, async ({ page }) => {
    const t = messages(locale).savedSearchAlertOff;
    const token = alertToken();
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const response = await page.goto(`/${locale}/wypisz-alert#t=${encodeURIComponent(token)}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByText(t.confirmText)).toBeVisible();
    await expect(page.getByRole('button', { name: t.confirmButton, exact: true })).toBeEnabled();
    // Token z fragmentu nie trafia do żadnego żądania i znika z paska adresu.
    expect(new URL(page.url()).pathname).toBe(`/${locale}/wypisz-alert`);
    expect(new URL(page.url()).hash).toBe('');
    expect(requests.some((url) => url.includes(token))).toBe(false);
  });
}

test('/wypisz-alert: kliknięcie w demo → jawny komunikat, fokus na nim (bez udawanego sukcesu)', async ({ page }) => {
  const t = messages('nl').savedSearchAlertOff;
  await page.goto(`/nl/wypisz-alert#t=${encodeURIComponent(alertToken())}`);
  await clickCookieBanner(page, 'nl', 'rejectOptional');
  await page.getByRole('button', { name: t.confirmButton, exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: t.unavailableText });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
});

test('/wypisz-alert: token kategorii, zmieniony i wygasły → bez przycisku (kontrole ujemne)', async ({ page }) => {
  const t = messages('fr').savedSearchAlertOff;
  // Token wypisania z kategorii nie jest tokenem alertu (osobna domena podpisu).
  const category = createUnsubscribeToken({ profileId: ALERT_PROFILE, category: 'job_matches' }, E2E_UNSUBSCRIBE_SECRET);
  await page.goto(`/fr/wypisz-alert#t=${encodeURIComponent(category)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.invalidTitle);
  await expect(page.getByRole('button', { name: t.confirmButton, exact: true })).toHaveCount(0);

  const [v, data, sig] = alertToken().split('.');
  const forged = Buffer.from(
    Buffer.from(data!, 'base64url').toString('utf8').replace(ALERT_SEARCH, '0d9c8b7a-6f5e-4d4c-8b3a-2f1e8d7c6b5a'),
  ).toString('base64url');
  // Zmiana samego fragmentu nie przeładowuje strony — każdy przypadek od nowego dokumentu.
  await page.goto('/fr');
  await page.goto(`/fr/wypisz-alert#t=${v}.${forged}.${sig}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.invalidTitle);

  const expired = alertToken(Date.now() - (ALERT_OFF_TOKEN_TTL_SECONDS + 60) * 1000);
  await page.goto('/fr');
  await page.goto(`/fr/wypisz-alert#t=${encodeURIComponent(expired)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.expiredTitle);
  await expect(page.getByRole('button', { name: t.confirmButton, exact: true })).toHaveCount(0);
});

test('/wypisz-alert bez naruszeń WCAG A/AA (critical/serious) przy 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/pl/wypisz-alert#t=${encodeURIComponent(alertToken())}`);
  await clickCookieBanner(page, 'pl', 'rejectOptional');
  await expect(page.getByRole('button', { name: messages('pl').savedSearchAlertOff.confirmButton, exact: true })).toBeVisible();
  const blocking = await blockingViolations(page);
  expect(blocking, blocking.join('\n')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
