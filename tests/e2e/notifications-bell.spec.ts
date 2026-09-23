import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Copy {
  notifications: { title: string; markAllRead: string; unreadItem: string };
  messages: { senderCompanyFallback: string };
}

function copy(locale: string): Copy {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Copy;
}

// Demo: 2 nieprzeczytane powiadomienia z `getNotifications` (#359).
const BELL_NAME = {
  pl: 'Powiadomienia, 2 nieprzeczytane',
  nl: 'Meldingen, 2 ongelezen',
  fr: 'Notifications, 2 non lues',
  en: 'Notifications, 2 unread',
} as const;

for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
  for (const role of ['candidate', 'employer'] as const) {
    test(`dzwonek: nazwa z liczbą, Escape i Tab (#353) — ${role}, ${locale}`, async ({ page }) => {
      const c = copy(locale);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${locale}/${role}/wiadomosci`);

      const bell = page.getByRole('button', { name: BELL_NAME[locale], exact: true });
      await expect(bell).toBeVisible();

      // Escape z wnętrza panelu → panel zamknięty, fokus na dzwonku.
      await bell.focus();
      await page.keyboard.press('Enter');
      const panel = page.getByRole('region', { name: c.notifications.title, exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByText(c.notifications.unreadItem, { exact: false }).first()).toBeAttached();
      await page.keyboard.press('Tab');
      await expect(panel.getByRole('button', { name: c.notifications.markAllRead })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(bell).toBeFocused();

      // Tab za ostatni element panelu → panel zamknięty.
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      const focusable = await panel.locator('a[href], button:not([disabled])').count();
      for (let i = 0; i <= focusable; i += 1) await page.keyboard.press('Tab');
      await expect(panel).toHaveCount(0);
    });
  }

  if (locale !== 'pl') {
    test(`demo wiadomości w języku strony (#359) — ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/candidate/wiadomosci?c=demo-conv-0`);
      const thread = page.locator('main');
      await expect(page.locator('#thread-heading')).toBeVisible();
      await expect(thread).not.toContainText('Dzień dobry');
      await expect(thread).not.toContainText('Magazynier');
    });
  }
}
