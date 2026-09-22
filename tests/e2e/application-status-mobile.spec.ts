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

    const statusButton = page.getByRole('button', { name: trigger, exact: true }).first();
    const box = await statusButton.boundingBox();
    expect(box, 'Przycisk zmiany statusu powinien być widoczny i mierzalny.').not.toBeNull();
    expect(box!.height, 'Przycisk zmiany statusu powinien mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);

    await statusButton.click();
    await expect(statusButton).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const menuItem = menu.getByRole('menuitem', { name: option, exact: true });
    const itemBox = await menuItem.boundingBox();
    expect(itemBox, 'Opcja statusu powinna być widoczna i mierzalna.').not.toBeNull();
    expect(itemBox!.height, 'Opcja statusu powinna mieć co najmniej 48 px.').toBeGreaterThanOrEqual(48);
    await menuItem.click();
    await expect(menu).toBeHidden();
    await expect(statusButton).toHaveAttribute('aria-expanded', 'false');

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow, 'Lista aplikacji nie powinna przewijać się poziomo.').toBeLessThanOrEqual(1);
  });
}
