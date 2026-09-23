import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import pl from '../../src/messages/pl.json';

/**
 * #402: po udanej zmianie kroku kreatora oferty fokus trafia na nagłówek nowego kroku, krok
 * jest ogłaszany, a stan zapisu ma jeden region `role="status"`. Tryb demo — zapis nie trafia
 * do bazy, test dowodzi zachowania klienta.
 */
test('kreator oferty: fokus i ogłoszenie kroku po „Dalej” i „Wstecz”', async ({ page }) => {
  await page.goto('/pl/employer/oferty/nowa');
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();
  const t = pl.jobWizard;

  await page.getByLabel(t.titleLabel).fill('Operator wózka widłowego');
  await page.getByRole('combobox', { name: t.categoryLabel }).click();
  await page.getByRole('option', { name: pl.categories.warehouse }).click();
  await page.getByLabel(t.occupationLabel).fill('Magazynier');

  await page.getByRole('button', { name: t.next, exact: true }).focus();
  await page.keyboard.press('Enter');

  const step2 = page.getByRole('heading', { level: 2, name: t.step2Title });
  await expect(step2).toBeFocused();
  await expect(page.getByText(`Krok 2 z 9: ${t.step2Title}`)).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByRole('status')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText(t.savedDemo);

  // Tab z nagłówka prowadzi do pola kroku 2, nie do sidebaru.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: t.contractTypeLabel })).toBeFocused();

  const blocking = (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => v.id)).toEqual([]);

  await page.getByRole('button', { name: t.back, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: t.step1Title })).toBeFocused();
});
