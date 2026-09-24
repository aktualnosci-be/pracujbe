import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOCALES } from './fixtures/messages';

/**
 * Ustawienia kandydata — widoczność profilu dla firm (#494), tryb DEMO (bez bazy).
 *
 * Demo = ukończony, ukryty profil. Kandydat świadomie włącza i cofa widoczność; po błędzie
 * zapisu (przerwane żądanie Server Action) przełącznik zostaje w potwierdzonym stanie
 * z komunikatem `role="alert"` — bez mylącego stanu. Bramka axe WCAG 2.x A/AA przy 320 px.
 * Egzekwowanie w bazie: supabase/tests/rls.sql sekcja VIS494.
 */

type Messages = {
  profileVisibility: {
    sectionTitle: string;
    toggleLabel: string;
    stateOn: string;
    stateOff: string;
    savedOn: string;
    savedOff: string;
    saveError: string;
    neverChanged: string;
  };
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
        id: 'candidate-profile-visibility-e2e',
      }),
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

for (const locale of LOCALES) {
  test(`${locale}: włączenie i cofnięcie widoczności profilu (#494)`, async ({ page }) => {
    const m = messages(locale).profileVisibility;
    await acceptNecessaryCookies(page);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${locale}/candidate/ustawienia`);

    const section = page.getByRole('region', { name: m.sectionTitle });
    const toggle = section.getByRole('switch', { name: m.toggleLabel });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByText(m.stateOff)).toBeVisible();
    await expect(section.getByText(m.neverChanged)).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const blocking = results.violations
      .filter((v) => BLOCKING.has(v.impact ?? ''))
      .map((v) => `[${v.impact}] ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
    expect(blocking, blocking.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

    await toggle.click();
    await expect(section.getByRole('status')).toHaveText(m.savedOn);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(section.getByText(m.stateOn)).toBeVisible();
    await expect(section.getByText(m.neverChanged)).toHaveCount(0);

    await toggle.click();
    await expect(section.getByRole('status')).toHaveText(m.savedOff);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByRole('alert')).toHaveCount(0);
  });
}

test('pl: błąd zapisu nie zmienia przełącznika (#494)', async ({ page }) => {
  const m = messages('pl').profileVisibility;
  await acceptNecessaryCookies(page);
  await page.goto('/pl/candidate/ustawienia');

  const section = page.getByRole('region', { name: m.sectionTitle });
  const toggle = section.getByRole('switch', { name: m.toggleLabel });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // Server Action = POST z nagłówkiem Next-Action na adres strony; przerywamy tylko je.
  await page.route('**/pl/candidate/ustawienia', (route) =>
    route.request().method() === 'POST' && route.request().headers()['next-action']
      ? route.abort('connectionfailed')
      : route.continue(),
  );
  await toggle.click();
  await expect(section.getByRole('alert')).toHaveText(m.saveError);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toBeEnabled();
  await expect(section.getByText(m.stateOff)).toBeVisible();
  await expect(section.getByRole('status')).toHaveCount(0);
});
