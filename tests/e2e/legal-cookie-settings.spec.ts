import { expect, test } from '@playwright/test';

import { routing } from '../../src/i18n/routing';
import en from '../../src/messages/en.json';
import fr from '../../src/messages/fr.json';
import nl from '../../src/messages/nl.json';
import pl from '../../src/messages/pl.json';

/**
 * Polityka cookies jest celem linku „Więcej informacji” z banera zgód. Użytkownik, który tu
 * trafił, musi móc zmienić wybór bez szukania przycisku w stopce (zasłanianej przez baner).
 * Test sprawdza zachowanie: przycisk w treści strony otwiera centrum ustawień zgód.
 */
const messages = { pl, nl, fr, en } as const;

for (const locale of routing.locales) {
  const m = messages[locale];

  test(`polityka cookies (${locale}) otwiera centrum ustawień zgód z treści strony`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/polityka-cookies`);

    const main = page.getByRole('main');
    const settings = main.getByRole('button', { name: m.footer.cookieSettings });
    await expect(settings).toBeVisible();

    const box = await settings.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await settings.click();
    const dialog = page.getByRole('dialog', { name: m.cookies.settingsTitle });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}
