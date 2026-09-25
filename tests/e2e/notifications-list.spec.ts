import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOCALES, rejectOptionalCookies } from './fixtures/messages';

/**
 * #148: pełna lista powiadomień w panelach (tryb demo: 3 pozycje, 2 nieprzeczytane).
 * Kontrolki po roli i nazwie z `src/messages` (#376): „Zobacz wszystkie” z dzwonka, filtr
 * „nieprzeczytane” w URL, oznaczanie pojedynczo i wszystkich, noindex strony.
 */

interface Copy {
  notifications: {
    title: string;
    seeAll: string;
    filterLabel: string;
    filterAll: string;
    filterUnread: string;
    markAllRead: string;
    markRead: string;
    markedRead: string;
    markedAllRead: string;
    itemJobMatch: string;
    itemApplicationStatusChanged: string;
    itemMessageReceived: string;
  };
}

function copy(locale: string): Copy {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Copy;
}

for (const locale of LOCALES) {
  for (const role of ['candidate', 'employer'] as const) {
    test(`lista powiadomień z dzwonka, filtr i noindex (#148) — ${role}, ${locale}`, async ({ page }) => {
      const c = copy(locale).notifications;
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${locale}/${role}`);
      await rejectOptionalCookies(page, locale);

      await page.getByRole('button', { name: new RegExp(`^${c.title}`) }).click();
      const panel = page.getByRole('region', { name: c.title, exact: true });
      await panel.getByRole('link', { name: c.seeAll }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/${role}/powiadomienia$`));
      await expect(panel).toHaveCount(0);

      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1, name: c.title })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(main.getByRole('link', { name: new RegExp(c.itemMessageReceived) })).toBeVisible();

      const filter = main.getByRole('navigation', { name: c.filterLabel });
      await expect(filter.getByRole('link', { name: c.filterAll })).toHaveAttribute('aria-current', 'page');
      await filter.getByRole('link', { name: c.filterUnread }).click();
      await expect(page).toHaveURL(/\?nieprzeczytane=1$/);
      await expect(filter.getByRole('link', { name: c.filterUnread })).toHaveAttribute('aria-current', 'page');
      await expect(main.getByRole('link', { name: new RegExp(c.itemJobMatch) })).toBeVisible();
      await expect(main.getByRole('link', { name: new RegExp(c.itemMessageReceived) })).toHaveCount(0);
    });
  }
}

test('oznaczanie pojedynczo i wszystkich (#148) — kandydat, pl', async ({ page }) => {
  const c = copy('pl').notifications;
  await page.goto('/pl/candidate/powiadomienia');
  await rejectOptionalCookies(page, 'pl');
  const main = page.getByRole('main');

  const markOne = main.getByRole('button', { name: `${c.markRead}: ${c.itemJobMatch}` });
  await markOne.click();
  await expect(markOne).toHaveCount(0);
  await expect(main.getByRole('link', { name: new RegExp(c.itemJobMatch) })).toBeFocused();
  await expect(main.getByRole('status')).toHaveText(c.markedRead);

  await main.getByRole('button', { name: c.markAllRead }).click();
  await expect(main.getByRole('button', { name: new RegExp(`^${c.markRead}:`) })).toHaveCount(0);
  await expect(main.getByRole('status')).toHaveText(c.markedAllRead);
  await expect(main.getByRole('button', { name: c.markAllRead })).toBeDisabled();
});
