import { expect, test } from '@playwright/test';

/**
 * #230 — chip aktywnego filtra z długim słowem bez spacji (złożenie niderlandzkie, wklejony
 * adres) rozpychał dokument w poziomie przy 320 px (WCAG 1.4.10).
 */

const longValues = [
  'vrachtwagenchauffeursopleidingscentrum',
  'https://www.example.be/vacature/1234567890',
  'a'.repeat(120),
];

for (const value of longValues) {
  test(`chip z długim słowem nie przewija strony w poziomie przy 320 px: ${value.slice(0, 24)}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(
      `/nl/oferty-pracy?keyword=${encodeURIComponent(value)}&location=${encodeURIComponent(value)}`,
    );

    const chip = page.getByRole('link', { name: new RegExp(`: ${value}$`) });
    await expect(chip.first()).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);

    // Chip mieści się w szerokości treści, a jego tekst nie jest ucięty.
    const box = await chip.first().boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      dimensions.viewport,
    );
    await expect(chip.first()).toContainText(value);
    await context.close();
  });
}
