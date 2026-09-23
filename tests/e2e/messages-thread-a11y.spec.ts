import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface MessagesCopy {
  conversationsHeading: string;
  threadListLabel: string;
  composerLabel: string;
  composerCounter: string;
}

function copy(locale: string): MessagesCopy {
  return (JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as {
    messages: MessagesCopy;
  }).messages;
}

// #358: nazwane regiony listy i wątku, h2 z rozmówcą, nazwana lista, nadawca przed treścią,
// etykieta pola z rozmówcą. #335: licznik znaków i limit 4000 w polu.
for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
  for (const role of ['candidate', 'employer'] as const) {
    test(`wątek wiadomości — struktura dostępności: ${role}, ${locale}`, async ({ page }) => {
      const m = copy(locale);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${locale}/${role}/wiadomosci?c=demo-conv-0`);

      await expect(page.getByRole('region', { name: m.conversationsHeading })).toBeVisible();
      await expect(page.locator('main').getByRole('complementary')).toHaveCount(0);

      const name = (await page.locator('#thread-heading').textContent())?.trim() ?? '';
      expect(name.length).toBeGreaterThan(0);
      await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();

      const thread = page.getByRole('region', { name, exact: true });
      await expect(thread).toBeVisible();

      const list = thread.getByRole('list', { name: m.threadListLabel.replace('{name}', name) });
      await expect(list).toBeVisible();
      // Pierwsza pozycja zaczyna się od nadawcy (tu: rozmówca) w kolejności DOM.
      const firstText = (await list.getByRole('listitem').first().textContent()) ?? '';
      expect(firstText.startsWith(name)).toBe(true);

      const composer = thread.getByRole('textbox', { name: m.composerLabel.replace('{name}', name) });
      await expect(composer).toHaveAttribute('maxlength', '4000');
      await composer.fill('Test');
      await expect(composer).toHaveAccessibleDescription(
        m.composerCounter.replace('{count}', '4').replace('{max}', '4000'),
      );
    });
  }
}
