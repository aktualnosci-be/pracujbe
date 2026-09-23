import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  test(`pulpit kandydata spełnia kontrast tekstu: ${locale}`, async ({ page }) => {
    const messages = JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as {
      dashboard: { viewOffer: string; rowActions: string; withdrawApplication: string };
      status: { rejected: string };
    };
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/candidate`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: messages.dashboard.viewOffer })).toHaveClass(/text-accent-dark/);
    await expect(page.getByText(messages.status.rejected, { exact: true })).toHaveClass(/text-error-text/);

    await expectNoContrastViolations(page, `${locale}/candidate`);

    // Menu akcji ma jasnoczerwone tło po najechaniu, więc sprawdzamy ten stan osobno.
    await page.getByRole('button', { name: messages.dashboard.rowActions }).first().click();
    const withdraw = page.getByRole('menuitem', { name: messages.dashboard.withdrawApplication });
    await expect(withdraw).toBeVisible();
    await withdraw.hover();
    await expectNoContrastViolations(page, `${locale}/candidate: menu akcji`);

  });
}

async function expectNoContrastViolations(page: import('@playwright/test').Page, path: string) {
    const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    const violations = result.violations.flatMap((violation) =>
      violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    );
    expect(violations, `${path}: kontrast tekstu WCAG AA`).toEqual([]);
}
