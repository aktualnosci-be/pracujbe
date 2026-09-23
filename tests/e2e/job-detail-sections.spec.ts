import { expect, test } from "@playwright/test";

/**
 * Regresja #205: na desktopie sekcje treści oferty są zawsze rozwinięte — nagłówki nie są
 * przystankami Tab, a klawiatura nie może ukryć treści (wcześniej Enter na `summary`
 * zwijał sekcję, której nie dało się rozwinąć myszą). Na mobile akordeon nadal działa.
 */

const DEMO_JOB_SLUG = "bricklayer-brussels-1002";

test("desktop: klawiatura nie zwija sekcji oferty, nagłówki nie są przystankami Tab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/pl/oferty-pracy/${DEMO_JOB_SLUG}`);
  const main = page.getByRole("main");
  const headingCount = await main.getByRole("heading", { level: 2 }).count();
  expect(headingCount).toBeGreaterThan(3);

  const focusedTags: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, inDetails: !!el.closest("details") } : null;
    });
    if (info) focusedTags.push(info.tag);
    if (info?.tag === "SUMMARY") await page.keyboard.press("Enter");
  }
  expect(focusedTags).not.toContain("SUMMARY");

  // Każda sekcja nadal pokazuje swój nagłówek i treść.
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll("main details")].filter(
      (d) => !(d as HTMLDetailsElement).open,
    ).length,
  );
  expect(hidden).toBe(0);
  await expect(main.getByRole("heading", { level: 2 })).toHaveCount(headingCount);
});

test("mobile: sekcja oferty zwija się i rozwija z klawiatury", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(`/pl/oferty-pracy/${DEMO_JOB_SLUG}`);
  const summary = page.locator("main details summary").first();
  await expect(summary).toBeVisible();
  const details = page.locator("main details").first();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(details).not.toHaveAttribute("open");
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  // W drzewie a11y na mobile jest dokładnie jeden nagłówek sekcji (bez duplikatu desktopowego).
  const name = (await summary.innerText()).trim();
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toHaveCount(1);
});
