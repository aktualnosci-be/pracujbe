import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { LOCALES, messages, rejectOptionalCookies } from './fixtures/messages';

/**
 * 0215 — `/candidate/zapisane` na serwerze fixture (`savedJobsFixture`: 2 oferty publiczne +
 * zamknięta, wygasła, wstrzymana, niedostępna). Oferta bez strony publicznej: etykieta stanu,
 * tytuł i firma, ŻADNEGO linku do `/oferty-pracy/…` (404) i „Usuń z zapisanych”.
 * Kontrola ujemna: oferty publiczne nadal linkują — selektor linków działa.
 */

type Dashboard = Record<string, string>;
const STATE_KEYS = ['savedStateClosed', 'savedStateExpired', 'savedStatePaused', 'savedStateUnavailable'] as const;

for (const locale of LOCALES) {
  test(`saved jobs without a public page keep a card without dead link in ${locale}`, async ({ page }) => {
    const d = messages(locale).dashboard as unknown as Dashboard;
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${locale}/candidate/zapisane`);
    await rejectOptionalCookies(page, locale);
    await expect(page.getByRole('heading', { level: 1, name: d['navSaved'] })).toBeVisible();

    const main = page.getByRole('main');
    const cards = main.getByRole('listitem');
    await expect(cards).toHaveCount(6);

    // Kontrola ujemna: dwie oferty publiczne mają link — i tylko one.
    const jobLinks = main.locator('a[href*="/oferty-pracy/"]');
    await expect(jobLinks).toHaveCount(2);

    for (const key of STATE_KEYS) {
      const card = cards.filter({ hasText: d[key]! });
      await expect(card).toHaveCount(1);
      await expect(card.getByRole('heading', { level: 3 })).not.toHaveText('');
      await expect(card.getByRole('link')).toHaveCount(0);
      await expect(card.getByRole('button', { name: new RegExp(`^${escape(d['savedRemove']!)}`) })).toBeVisible();
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    // Usunięcie zamkniętej oferty: komunikat z fokusem, karta stanu znika, reszta zostaje.
    await page.waitForLoadState('networkidle');
    const closed = cards.filter({ hasText: d['savedStateClosed']! });
    const title = (await closed.getByRole('heading', { level: 3 }).textContent())?.trim() ?? '';
    await closed.getByRole('button', { name: new RegExp(`^${escape(d['savedRemove']!)}`) }).click();
    const status = cards.getByRole('status');
    await expect(status).toHaveText(d['savedRemoved']!.replace('{title}', title));
    await expect(status).toBeFocused();
    await expect(cards.filter({ hasText: d['savedStateClosed']! })).toHaveCount(0);
    await expect(cards.filter({ hasText: d['savedStateExpired']! })).toHaveCount(1);
    await expect(jobLinks).toHaveCount(2);
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
