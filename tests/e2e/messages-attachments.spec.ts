import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Załączniki w polu wiadomości (0108) w trybie demo (bez bucketu): za duży plik odrzucony
 * w przeglądarce (bez wysyłki bajtów), poprawny plik → komunikat „nie działa w demo” zamiast
 * fikcyjnego sukcesu; wysyłka zablokowana, dopóki plik nie jest gotowy; axe na stanie z plikami.
 */

interface Copy {
  messages: Record<string, string>;
  files: Record<string, string>;
  errors: Record<string, string>;
}

function copy(locale: string): Copy {
  return JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as Copy;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

for (const locale of ['pl', 'en'] as const) {
  for (const role of ['candidate', 'employer'] as const) {
    test(`załączniki w wątku — walidacja i demo: ${role}, ${locale}`, async ({ page }) => {
      const t = copy(locale);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/${role}/wiadomosci?c=demo-conv-0`);

      const attach = page.getByRole('button', { name: t.messages.attachFile });
      await expect(attach).toBeVisible();
      await expect(attach).toHaveAccessibleDescription(t.messages.attachHint.replace('{max}', '3'));

      const input = page.locator('input[type="file"]');
      await input.setInputFiles([
        { name: 'duzy.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
        { name: 'zdjecie.png', mimeType: 'image/png', buffer: PNG },
      ]);

      const list = page.getByRole('list', { name: t.messages.attachmentsLabel });
      await expect(list.getByRole('listitem')).toHaveCount(2);
      await expect(list.getByText(t.files.errorTooLarge)).toBeVisible();
      await expect(list.getByText(t.errors.demoUnavailable)).toBeVisible();
      await expect(page.getByRole('button', { name: t.messages.send })).toBeDisabled();

      const results = await new AxeBuilder({ page })
        .options({ rules: { 'target-size': { enabled: true } } })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious' || v.id === 'target-size',
      );
      expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

      for (const name of ['duzy.png', 'zdjecie.png']) {
        await page.getByRole('button', { name: t.messages.attachmentRemove.replace('{name}', name) }).click();
      }
      await expect(list).toHaveCount(0);
      await page.getByRole('textbox').fill('Test');
      await expect(page.getByRole('button', { name: t.messages.send })).toBeEnabled();
    });
  }
}
