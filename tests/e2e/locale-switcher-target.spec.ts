import { expect, test, type Locator } from "@playwright/test";

/**
 * Cel dotykowy przełącznika języka: min. 44 × 44 px (WCAG 2.5.5, zalecenie przy 2.5.8).
 * Desktop — przełącznik w stopce; mobile — w menu otwieranym z nagłówka.
 */

const labels = { pl: "Język", nl: "Taal", fr: "Langue", en: "Language" } as const;
const MIN_TARGET = 44;

async function expectTouchTarget(trigger: Locator): Promise<void> {
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  expect(box, "przełącznik języka musi mieć wymiary").not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(box!.width).toBeGreaterThanOrEqual(MIN_TARGET);
}

for (const [locale, label] of Object.entries(labels)) {
  test(`${locale}: przełącznik języka ma cel ≥ 44 px na desktopie`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}`);
    await expectTouchTarget(page.locator("footer").getByRole("combobox", { name: label }));
  });

  test(`${locale}: przełącznik języka ma cel ≥ 44 px w menu mobilnym`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}`);
    await page.locator("header").getByRole("button", { name: "Menu" }).click();
    await expectTouchTarget(page.getByRole("dialog").getByRole("combobox", { name: label }));
  });
}
