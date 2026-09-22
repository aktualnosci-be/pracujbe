import { expect, test } from '@playwright/test';

const CASES = [
  { locale: 'pl', consent: 'Tylko niezbędne', send: 'Wyślij' },
  { locale: 'nl', consent: 'Alleen noodzakelijke', send: 'Versturen' },
  { locale: 'fr', consent: 'Uniquement nécessaires', send: 'Envoyer' },
  { locale: 'en', consent: 'Only necessary', send: 'Send' },
] as const;

for (const { locale, consent, send } of CASES) {
  test(`kompozytor wiadomości: ${locale}, ekran 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/candidate/wiadomosci?c=demo-conv-0`);
    await page.getByRole('button', { name: consent }).click();

    const sendButton = page.getByRole('button', { name: send });
    const box = await sendButton.boundingBox();
    expect(box, 'Przycisk wysyłania powinien być widoczny i mierzalny.').not.toBeNull();
    expect(box!.height, 'Główna akcja wysyłania powinna mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow, 'Widok wiadomości nie powinien przewijać się poziomo.').toBeLessThanOrEqual(1);
  });
}
