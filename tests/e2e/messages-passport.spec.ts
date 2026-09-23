import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
  for (const role of ['candidate', 'employer'] as const) {
    test(`lista rozmów paszport: ${role}, ${locale}, 320 px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(`/${locale}/${role}/wiadomosci`);

      const list = page.locator('aside').getByRole('list');
      await expect(list).toBeVisible();
      await expect(list.getByRole('link').first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      const firstLink = list.getByRole('link').first();
      expect((await firstLink.boundingBox())!.height).toBeGreaterThanOrEqual(80);
    });
  }
}

for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
  for (const role of ['candidate', 'employer'] as const) {
    test(`rozmowa ${role}, ${locale}: reflow przy 640 CSS px`, async ({ page }) => {
      const translations = JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as {
        messages: { back: string; send: string; composerPlaceholder: string };
      };
      const listPath = `/${locale}/${role}/wiadomosci`;
      // Testuje układ przy 640 CSS px, bez zmiany powiększenia przeglądarki.
      await page.setViewportSize({ width: 640, height: 900 });
      await page.goto(listPath);

      const conversation = page.locator('aside').getByRole('list').getByRole('link').first();
      await expect(conversation).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

      await conversation.click();
      await expect(page.getByRole('link', { name: translations.messages.back, exact: true })).toBeVisible();
      const composer = page.getByRole('textbox', { name: translations.messages.composerPlaceholder });
      const send = page.getByRole('button', { name: translations.messages.send, exact: true });
      await expect(send).toBeDisabled();
      await composer.fill('Test');
      await expect(send).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

      await page.getByRole('link', { name: translations.messages.back, exact: true }).click();
      await expect(page).toHaveURL(listPath);
      await expect(page.locator('aside').getByRole('list').getByRole('link').first()).toBeVisible();
    });
  }
}
