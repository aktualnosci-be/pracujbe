import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  test(`pulpit kandydata spełnia kontrast tekstu: ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/candidate`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

    const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    const violations = result.violations.flatMap((violation) =>
      violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    );
    expect(violations, `${locale}/candidate: kontrast tekstu WCAG AA`).toEqual([]);
  });
}
