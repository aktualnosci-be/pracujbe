import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOCALES } from './fixtures/messages';

/**
 * Zapisane wyszukiwania (#100), tryb DEMO (bez bazy).
 *
 * Lista ofert z filtrem pokazuje „Zapisz wyszukiwanie”; bez filtrów przycisku nie ma
 * (kontrola ujemna). Kliknięcie w demo daje jawny komunikat `role="alert"` (bez udawanego
 * sukcesu). Strona `/candidate/wyszukiwania` jest w nawigacji panelu, noindex, z jasnym
 * stanem demo. Bramka axe WCAG 2.x A/AA (critical/serious) przy 320 px bez poziomego
 * przewijania. Zapis, alerty, idempotencja i opt-out w bazie: rls.sql sekcja SS100.
 */

type Messages = {
  savedSearches: { save: string; demo: string; browse: string };
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
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
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
