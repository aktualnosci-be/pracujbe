import { expect, test } from '@playwright/test';

const CASES = [
  { locale: 'pl', consent: 'Tylko niezbędne', trigger: 'Status', option: 'Obejrzana' },
  { locale: 'nl', consent: 'Alleen noodzakelijke', trigger: 'Status', option: 'Bekeken' },
  { locale: 'fr', consent: 'Uniquement nécessaires', trigger: 'Statut', option: 'Consultée' },
  { locale: 'en', consent: 'Only necessary', trigger: 'Status', option: 'Viewed' },
] as const;

for (const { locale, consent, trigger, option } of CASES) {
  test(`menu statusu aplikacji: ${locale}, ekran 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/employer/aplikacje`);
    await page.getByRole('button', { name: consent }).click();

    // Drugi rekord demonstracyjny ma status `viewed`, więc sprawdzamy też bieżący wybór
    // bez uruchamiania Server Action.
    const statusButton = page.getByRole('button', { name: trigger, exact: true }).nth(1);
    const box = await statusButton.boundingBox();
    expect(box, 'Przycisk zmiany statusu powinien być widoczny i mierzalny.').not.toBeNull();
    expect(box!.height, 'Przycisk zmiany statusu powinien mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);

    await statusButton.click();
    await expect(statusButton).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('list', { name: trigger, exact: true });
    await expect(panel).toBeVisible();
    const options = panel.getByRole('button');
    await expect(options).toHaveCount(5);
    for (const statusOption of await options.all()) {
      const itemBox = await statusOption.boundingBox();
      expect(itemBox, 'Każda opcja statusu powinna być widoczna i mierzalna.').not.toBeNull();
      expect(itemBox!.height, 'Każda opcja statusu powinna mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);
    }
    await expect(panel.getByRole('button', { name: option, exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow, 'Otwarty panel nie powinien przewijać strony poziomo.').toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(statusButton).toHaveAttribute('aria-expanded', 'false');
    await expect(statusButton).toBeFocused();

    await statusButton.click();
    await expect(panel).toBeVisible();
    await statusButton.click();
    await expect(panel).toBeHidden();
  });
}
